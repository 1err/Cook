"""Exercise both release histories in private schemas of an opt-in local test DB."""
import os
from uuid import uuid4

from alembic import command
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.migrate import migrate_connection, migration_config


@pytest.mark.asyncio
@pytest.mark.parametrize("starting_revision", [
    None, "20260924_analytics", "20260922_account_lifecycle",
])
async def test_release_upgrade_preserves_both_histories(starting_revision):
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit disposable PostgreSQL required")
    parsed = make_url(url)
    assert parsed.drivername == "postgresql+asyncpg"
    assert parsed.host in {"127.0.0.1", "localhost", "::1"}
    assert parsed.database == "cooking_audit_test"
    schema = "release_test_" + uuid4().hex
    engine = create_async_engine(url, poolclass=NullPool)
    user_id, event_id = uuid4(), uuid4()

    def config_for_test():
        config = migration_config()
        # Alembic CLI logging must not replace pytest's handlers or disable the
        # app loggers while an in-process migration exercises real DDL.
        config.config_file_name = None
        return config

    def upgrade(connection, revision):
        config = config_for_test()
        config.attributes["connection"] = connection
        command.upgrade(config, revision)
        connection.commit()

    try:
        async with engine.connect() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            await connection.execute(text(f'SET search_path TO "{schema}"'))
            await connection.commit()
            if starting_revision:
                await connection.run_sync(upgrade, starting_revision)
                await connection.execute(text(
                    "INSERT INTO users(id,email) VALUES (:id,'upgrade-test@example.com')"
                ), {"id": user_id})
                if starting_revision == "20260924_analytics":
                    await connection.execute(text(
                        "INSERT INTO analytics_profiles(user_id,is_test) VALUES (:id,true)"
                    ), {"id": user_id})
                    await connection.execute(text(
                        "INSERT INTO analytics_events(id,name,user_id,platform) "
                        "VALUES (:event,'login',:id,'web')"
                    ), {"event": event_id, "id": user_id})
                else:
                    await connection.execute(text(
                        "UPDATE users SET email_verified=true,auth_version=3 WHERE id=:id"
                    ), {"id": user_id})
                await connection.commit()

            await connection.run_sync(migrate_connection, config_for_test())
            versions = (await connection.execute(text("SELECT version_num FROM alembic_version"))).scalars().all()
            assert len(versions) == 1, "The production migration command requires one deployable head"
            for table in ("analytics_profiles", "analytics_events", "account_action_tokens", "owned_images"):
                assert (await connection.execute(text("SELECT to_regclass(:table)"), {"table": table})).scalar()
            if starting_revision:
                row = (await connection.execute(text(
                    "SELECT email,email_verified,auth_version FROM users WHERE id=:id"
                ), {"id": user_id})).one()
                assert row.email == "upgrade-test@example.com"
                assert row.email_verified is (starting_revision == "20260922_account_lifecycle")
                assert row.auth_version == (3 if starting_revision == "20260922_account_lifecycle" else 0)
                if starting_revision == "20260924_analytics":
                    assert (await connection.execute(text(
                        "SELECT is_test FROM analytics_profiles WHERE user_id=:id"
                    ), {"id": user_id})).scalar() is True
                    assert (await connection.execute(text(
                        "SELECT name FROM analytics_events WHERE id=:event"
                    ), {"event": event_id})).scalar() == "login"
            await connection.commit()
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()
