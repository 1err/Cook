"""
Async SQLAlchemy engine and session. No load_dotenv; config from core.
Postgres only (DATABASE_URL must be postgresql+asyncpg://...).
"""
import asyncio
from collections.abc import AsyncGenerator
import logging
import ssl

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.db.models import Base

_engine = None
async_session_maker: async_sessionmaker[AsyncSession] | None = None
_engine_dispose_task: asyncio.Task[None] | None = None
_engine_dispose_owner = None
DB_DISPOSE_TIMEOUT_SECONDS = 10.0
logger = logging.getLogger(__name__)


def _make_session_maker(engine: object) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        engine,  # type: ignore[arg-type]
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )


def _engine_dispose_completed(task: asyncio.Task[None], engine: object) -> None:
    global _engine, _engine_dispose_task, _engine_dispose_owner
    global async_session_maker
    if _engine_dispose_task is not task:
        return
    try:
        task.result()
    except asyncio.CancelledError:
        _engine_dispose_task = None
        _engine_dispose_owner = None
        logger.warning("database engine disposal task was cancelled")
    except Exception as exc:
        logger.error(
            "database engine disposal failed",
            exc_info=(type(exc), exc, exc.__traceback__),
        )
        _engine_dispose_task = None
        _engine_dispose_owner = None
    else:
        if _engine is engine:
            _engine = None
            async_session_maker = None
        _engine_dispose_task = None
        _engine_dispose_owner = None


def init_engine() -> None:
    """Create async engine and session factory. Call once at app startup."""
    global _engine, async_session_maker
    task = _engine_dispose_task
    if task is not None and task.done():
        _engine_dispose_completed(task, _engine_dispose_owner)
    if _engine_dispose_task is not None and not _engine_dispose_task.done():
        raise RuntimeError("Cannot initialize the database while disposal is still running.")
    if _engine is not None:
        if async_session_maker is None:
            async_session_maker = _make_session_maker(_engine)
        return
    connect_args: dict = {"server_settings": {
        "statement_timeout": str(settings.DB_STATEMENT_TIMEOUT_MS),
        "lock_timeout": str(settings.DB_LOCK_TIMEOUT_MS),
        "idle_in_transaction_session_timeout": str(settings.DB_IDLE_TRANSACTION_TIMEOUT_MS),
    }}
    if settings.DATABASE_SSL:
        connect_args["ssl"] = (ssl.create_default_context(cafile=settings.DATABASE_CA_FILE)
                               if settings.DATABASE_CA_FILE else True)

    _engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
        pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
        pool_pre_ping=True,
        connect_args=connect_args,
    )
    async_session_maker = _make_session_maker(_engine)


async def dispose_engine() -> None:
    """Dispose the shared engine once and reset startup-owned DB resources."""
    global _engine_dispose_task, _engine_dispose_owner, async_session_maker
    prior_task = _engine_dispose_task
    if prior_task is not None and prior_task.done():
        _engine_dispose_completed(prior_task, _engine_dispose_owner)
    engine = _engine
    if engine is None:
        async_session_maker = None
        return
    if async_session_maker is None:
        async_session_maker = _make_session_maker(engine)
    task = _engine_dispose_task
    if task is None:
        task = asyncio.create_task(engine.dispose())
        _engine_dispose_task = task
        _engine_dispose_owner = engine
        task.add_done_callback(
            lambda completed, owned_engine=engine: _engine_dispose_completed(
                completed, owned_engine
            )
        )
    try:
        done, _ = await asyncio.wait(
            {task},
            timeout=DB_DISPOSE_TIMEOUT_SECONDS,
        )
    except asyncio.CancelledError:
        # The engine-disposal task is application-owned and must survive its
        # caller's cancellation so engine/factory state cannot become split.
        raise
    if task not in done and not task.done():
        logger.error(
            "database engine disposal outlived shutdown deadline",
            extra={"event": "database_dispose_timeout"},
        )
        return
    try:
        task.result()
    except asyncio.CancelledError as exc:
        _engine_dispose_completed(task, engine)
        raise RuntimeError(
            "Database engine disposal was cancelled before completion."
        ) from exc
    except Exception:
        _engine_dispose_completed(task, engine)
        raise
    else:
        _engine_dispose_completed(task, engine)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: yield an async session; commit on success, rollback on error."""
    if async_session_maker is None:
        init_engine()
    assert async_session_maker is not None
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
