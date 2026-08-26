"""
Async SQLAlchemy engine and session. No load_dotenv; config from core.
Postgres only (DATABASE_URL must be postgresql+asyncpg://...).
"""
import asyncio
from collections.abc import AsyncGenerator
import logging

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
DB_DISPOSE_TIMEOUT_SECONDS = 10.0
logger = logging.getLogger(__name__)


def _engine_dispose_completed(task: asyncio.Task[None], engine: object) -> None:
    global _engine, _engine_dispose_task
    if _engine_dispose_task is not task:
        return
    try:
        task.result()
    except asyncio.CancelledError:
        _engine_dispose_task = None
    except Exception:
        logger.exception("database engine disposal failed")
        _engine_dispose_task = None
    else:
        if _engine is engine:
            _engine = None
        _engine_dispose_task = None


def init_engine() -> None:
    """Create async engine and session factory. Call once at app startup."""
    global _engine, async_session_maker
    if _engine_dispose_task is not None and not _engine_dispose_task.done():
        raise RuntimeError("Cannot initialize the database while disposal is still running.")
    if _engine is not None:
        return
    connect_args: dict = {}
    if settings.DATABASE_SSL:
        connect_args["ssl"] = True

    _engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        connect_args=connect_args if connect_args else {},
    )
    async_session_maker = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )


async def dispose_engine() -> None:
    """Dispose the shared engine once and reset startup-owned DB resources."""
    global _engine_dispose_task, async_session_maker
    engine = _engine
    async_session_maker = None
    if engine is not None:
        task = _engine_dispose_task
        if task is None:
            task = asyncio.create_task(engine.dispose())
            _engine_dispose_task = task
            task.add_done_callback(
                lambda completed, owned_engine=engine: _engine_dispose_completed(
                    completed, owned_engine
                )
            )
        caller_cancelled = False
        try:
            done, _ = await asyncio.wait(
                {task},
                timeout=DB_DISPOSE_TIMEOUT_SECONDS,
            )
        except asyncio.CancelledError:
            caller_cancelled = True
            task.cancel()
            done = set()
        if task not in done and not task.done():
            task.cancel()
            logger.error(
                "database engine disposal outlived shutdown deadline",
                extra={"event": "database_dispose_timeout"},
            )
        elif task.done():
            try:
                task.result()
            except asyncio.CancelledError:
                pass
        if caller_cancelled:
            raise asyncio.CancelledError


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
