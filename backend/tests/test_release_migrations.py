"""The migration connection must hold the lock across Alembic transactions."""
from contextlib import contextmanager
from importlib.util import find_spec
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import unittest


class Connection:
    dialect = SimpleNamespace(name="postgresql")

    def __init__(self, lock=True):
        self.lock = lock
        self.events = []

    def execute(self, sql, params=None):
        self.events.append((str(sql), params))
        return SimpleNamespace(scalar=lambda: self.lock)

    def commit(self):
        self.events.append(("commit", None))

    def rollback(self):
        self.events.append(("rollback", None))


class MigrationTests(unittest.TestCase):
    def runner(self):
        self.assertIsNotNone(find_spec("app.migrate"), "dedicated migration entrypoint is required")
        from app.migrate import migrate_connection
        return migrate_connection

    def test_lock_and_timeouts_cover_alembic_and_release_after_commit(self):
        run = self.runner()
        connection = Connection()
        config = SimpleNamespace(attributes={})
        def upgrade(cfg, revision):
            self.assertIs(cfg.attributes["connection"], connection)
            self.assertEqual(revision, "head")
            connection.events.append(("upgrade", None))
        with patch("app.migrate.command.upgrade", side_effect=upgrade):
            run(connection, config, lock_wait_seconds=1, statement_timeout_ms=30000, lock_timeout_ms=1000)
        statements = [s for s,p in connection.events]
        self.assertLess(next(i for i,s in enumerate(statements) if "pg_try_advisory_lock" in s), statements.index("upgrade"))
        self.assertGreater(next(i for i,s in enumerate(statements) if "pg_advisory_unlock" in s), statements.index("upgrade"))
        self.assertTrue(any("statement_timeout" in str(p) for s,p in connection.events))
        self.assertNotIn("connection", config.attributes)

    def test_failure_rolls_back_before_unlock_and_propagates(self):
        run = self.runner()
        connection = Connection()
        config = SimpleNamespace(attributes={})
        with patch("app.migrate.command.upgrade", side_effect=RuntimeError("failed")):
            with self.assertRaisesRegex(RuntimeError, "failed"):
                run(connection, config, lock_wait_seconds=1, statement_timeout_ms=30000, lock_timeout_ms=1000)
        statements = [s for s,p in connection.events]
        unlock = next(i for i,s in enumerate(statements) if "pg_advisory_unlock" in s)
        self.assertIn("rollback", statements[:unlock])
        self.assertNotIn("connection", config.attributes)

    def test_lock_wait_is_bounded_and_never_runs_migration(self):
        run = self.runner()
        connection = Connection(lock=False)
        with patch("app.migrate.command.upgrade") as upgrade, patch("app.migrate.time.monotonic", side_effect=[0, 2]):
            with self.assertRaisesRegex(TimeoutError, "migration lock"):
                run(connection, SimpleNamespace(attributes={}), lock_wait_seconds=1, statement_timeout_ms=30000, lock_timeout_ms=1000)
            upgrade.assert_not_called()

    def test_api_image_does_not_run_migrations(self):
        dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text()
        command = next(line for line in dockerfile.splitlines() if line.startswith("CMD "))
        self.assertNotIn("alembic", command)
        self.assertIn("uvicorn", command)


class PostgresMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import os
        from sqlalchemy.engine import make_url
        from sqlalchemy.ext.asyncio import create_async_engine
        url = os.environ.get("TEST_DATABASE_URL")
        if not url:
            self.skipTest("Explicit disposable local PostgreSQL URL required")
        parsed = make_url(url)
        self.assertEqual(parsed.database, "cooking_audit_test")
        self.assertIn(parsed.host, ("localhost", "127.0.0.1", "::1"))
        self.engine = create_async_engine(url, pool_size=2, max_overflow=0)
        self.lock_patch = patch("app.migrate.MIGRATION_LOCK_ID", 484820260999)
        self.lock_patch.start()

    async def asyncTearDown(self):
        if hasattr(self, "engine"):
            await self.engine.dispose()
            self.lock_patch.stop()

    async def test_real_postgres_lock_blocks_second_runner_then_allows_it(self):
        from app.migrate import migrate_connection, MIGRATION_LOCK_ID
        from sqlalchemy import text
        async with self.engine.connect() as owner, self.engine.connect() as contender:
            await owner.execute(text("SELECT pg_advisory_lock(:key)"), {"key":MIGRATION_LOCK_ID})
            await owner.commit()
            try:
                with patch("app.migrate.command.upgrade") as upgrade:
                    with self.assertRaises(TimeoutError):
                        await contender.run_sync(migrate_connection, SimpleNamespace(attributes={}), lock_wait_seconds=0.1)
                    upgrade.assert_not_called()
            finally:
                await owner.execute(text("SELECT pg_advisory_unlock(:key)"), {"key":MIGRATION_LOCK_ID})
                await owner.commit()
            def upgrade(config, revision):
                connection = config.attributes["connection"]
                self.assertEqual(connection.execute(text("SHOW statement_timeout")).scalar(), "5min")
                self.assertEqual(connection.execute(text("SHOW lock_timeout")).scalar(), "10s")
                # Simulate an Alembic revision's transaction boundary: lock lives on.
                connection.commit()
            with patch("app.migrate.command.upgrade", side_effect=upgrade):
                await contender.run_sync(migrate_connection, SimpleNamespace(attributes={}))
            acquired = await owner.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key":MIGRATION_LOCK_ID})
            self.assertTrue(acquired)
            await owner.execute(text("SELECT pg_advisory_unlock(:key)"), {"key":MIGRATION_LOCK_ID})
            await owner.commit()

    async def test_postgres_aborted_transaction_still_releases_session_lock(self):
        from app.migrate import migrate_connection, MIGRATION_LOCK_ID
        from sqlalchemy import text
        from sqlalchemy.exc import DBAPIError
        def broken_upgrade(config, revision):
            config.attributes["connection"].execute(text("SELECT 1 / 0"))
        async with self.engine.connect() as failing, self.engine.connect() as next_release:
            with patch("app.migrate.command.upgrade", side_effect=broken_upgrade):
                with self.assertRaises(DBAPIError):
                    await failing.run_sync(migrate_connection, SimpleNamespace(attributes={}))
            self.assertTrue(await next_release.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key":MIGRATION_LOCK_ID}))
            await next_release.execute(text("SELECT pg_advisory_unlock(:key)"), {"key":MIGRATION_LOCK_ID})
            await next_release.commit()
