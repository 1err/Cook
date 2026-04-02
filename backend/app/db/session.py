"""
Async SQLAlchemy engine and session. No load_dotenv; config from core.
Postgres only (DATABASE_URL must be postgresql+asyncpg://...).
"""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.db.models import Base

_engine = None
async_session_maker: async_sessionmaker[AsyncSession] | None = None


def init_engine() -> None:
    """Create async engine and session factory. Call once at app startup."""
    global _engine, async_session_maker
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
