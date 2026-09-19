"""One release migration job, serialized across processes by PostgreSQL.

Run ``python -m app.migrate`` from the backend image. The session advisory lock
survives Alembic's commits (including autocommit migration blocks). The same
connection executes migrations, so its database timeouts cover the real DDL.
Schema changes must remain compatible with the old API during rolling releases.
"""
import asyncio
from pathlib import Path
import ssl
import time

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

# Stable application-specific signed bigint; never derive from Python hash().
MIGRATION_LOCK_ID = 484820260918


def migrate_connection(connection, config, *, lock_wait_seconds=60,
                       statement_timeout_ms=300000, lock_timeout_ms=10000):
    """Synchronous body also usable through AsyncConnection.run_sync."""
    if connection.dialect.name != "postgresql":
        raise ValueError("Release migrations require PostgreSQL")
    if not (0 < lock_wait_seconds <= 300 and 0 < lock_timeout_ms <= 300000
            and 0 < statement_timeout_ms <= 900000):
        raise ValueError("Migration timeouts must be positive and bounded")
    acquired = False
    try:
        for name, value in (("statement_timeout", statement_timeout_ms),
                            ("lock_timeout", lock_timeout_ms)):
            connection.execute(text("SELECT set_config(:name, :value, false)"),
                               {"name": name, "value": str(value)})
        connection.commit()
        deadline = time.monotonic() + lock_wait_seconds
        while True:
            acquired = bool(connection.execute(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": MIGRATION_LOCK_ID}).scalar())
            # Leave no external transaction: Alembic owns transaction boundaries.
            connection.commit()
            if acquired:
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Timed out waiting for the release migration lock")
            # PostgreSQL sleep yields through run_sync for the async driver; a
            # Python sleep would block the event loop while another release runs.
            connection.execute(text("SELECT pg_sleep(:delay)"),
                               {"delay": min(0.2, remaining)})
            connection.commit()
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        config.attributes.pop("connection", None)
        if acquired:
            try:
                connection.execute(text("SELECT pg_advisory_unlock(:key)"),
                                   {"key": MIGRATION_LOCK_ID})
                connection.commit()
            except BaseException:
                # Closing a failed connection also releases its session locks.
                connection.invalidate()
                raise


def migration_config():
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    return config


async def _run_async(url, config, connect_args):
    engine = create_async_engine(url, poolclass=NullPool, connect_args=connect_args)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(migrate_connection, config)
    finally:
        await engine.dispose()


def main():
    # Load settings only for CLI use; tests can exercise the lock without app init.
    from app.core.config import settings
    url = make_url(settings.DATABASE_URL)
    config = migration_config()
    if url.get_dialect().is_async:
        connect_args = {"timeout": 15, "command_timeout": 310}
        if settings.DATABASE_SSL:
            connect_args["ssl"] = (ssl.create_default_context(cafile=settings.DATABASE_CA_FILE)
                                   if settings.DATABASE_CA_FILE else True)
        asyncio.run(_run_async(url, config, connect_args))
    else:
        connect_args = {"connect_timeout": 15}
        if settings.DATABASE_SSL:
            connect_args["sslmode"] = "verify-full" if settings.DATABASE_CA_FILE else "require"
            if settings.DATABASE_CA_FILE:
                connect_args["sslrootcert"] = settings.DATABASE_CA_FILE
        engine = create_engine(url, poolclass=NullPool, connect_args=connect_args)
        try:
            with engine.connect() as connection:
                migrate_connection(connection, config)
        finally:
            engine.dispose()


if __name__ == "__main__":
    main()
