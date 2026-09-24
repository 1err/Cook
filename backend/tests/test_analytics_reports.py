import os
from datetime import datetime, timedelta, timezone, date
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.analytics.repository import record_event
from app.analytics.reports import overview, users_page, user_detail
from app.analytics.schema import DateRange
from app.core.config import settings


@pytest_asyncio.fixture
async def analytics_db(monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit disposable PostgreSQL required")
    parsed = make_url(url)
    assert parsed.drivername == "postgresql+asyncpg"
    assert parsed.host in {"127.0.0.1", "localhost", "::1"}
    assert parsed.database == "cooking_audit_test"
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    admin, person, tester = uuid4(), uuid4(), uuid4()
    monkeypatch.setattr(settings, "ADMIN_USER_IDS", str(admin))
    now = datetime.now(timezone.utc)
    async with factory.begin() as s:
        await s.execute(text("TRUNCATE users CASCADE"))
        for uid, email in [
            (admin, "owner@example.com"),
            (person, "person@example.com"),
            (tester, "test@example.com"),
        ]:
            await s.execute(
                text("INSERT INTO users(id,email,created_at) VALUES (:id,:email,:at)"),
                {"id": uid, "email": email, "at": now - timedelta(days=3)},
            )
        await s.execute(
            text("INSERT INTO analytics_profiles(user_id,is_test) VALUES (:id,true)"),
            {"id": tester},
        )
        await s.execute(
            text("UPDATE analytics_state SET started_at=now()-interval '5 days'")
        )
    yield factory, admin, person, tester, now
    await engine.dispose()


@pytest.mark.asyncio
async def test_events_deduplicate_and_profiles_survive_raw_pruning(analytics_db):
    factory, admin, person, tester, now = analytics_db
    event = {
        "id": uuid4(),
        "name": "recipe_saved",
        "user_id": person,
        "occurred_at": now,
    }
    async with factory.begin() as s:
        assert await record_event(s, event)
        assert not await record_event(s, event)
        await s.execute(text("DELETE FROM analytics_events"))
        profile = (
            await s.execute(
                text(
                    "SELECT first_recipe_at FROM analytics_profiles WHERE user_id=:id"
                ),
                {"id": person},
            )
        ).scalar_one()
        assert profile == now


@pytest.mark.asyncio
async def test_overview_excludes_internal_and_counts_real_activity(analytics_db):
    factory, admin, person, tester, now = analytics_db
    visitor, visit = uuid4(), uuid4()
    async with factory.begin() as s:
        for actor in (admin, person, tester):
            await record_event(s, {"id": uuid4(), "name": "login", "user_id": actor})
            await record_event(
                s, {"id": uuid4(), "name": "recipe_saved", "user_id": actor}
            )
        await record_event(
            s,
            {
                "id": uuid4(),
                "name": "page_view",
                "is_client": True,
                "user_id": person,
                "visitor_id": visitor,
                "session_id": visit,
                "path": "/library",
                "source": "newsletter",
                "device": "mobile",
            },
        )
        data = await overview(
            s, DateRange(start=(now - timedelta(days=6)).date(), end=now.date())
        )
        assert data["totals"]["total_users"] == 3
        assert data["totals"]["new_users"] == 1
        assert data["totals"]["active_users"] == 1
        assert data["totals"]["logins"] == 1
        assert data["totals"]["visitors"] == 1
        assert data["totals"]["recipes_saved"] == 1
        assert data["coverage"]["partial"] is True
        assert len(data["series"]) == 7
        assert data["acquisition"]["sources"][0]["label"] == "newsletter"
        all_data = await overview(
            s, DateRange(start=now.date(), end=now.date(), include_internal=True)
        )
        assert all_data["totals"]["logins"] == 3


@pytest.mark.asyncio
async def test_directory_keeps_internal_accounts_and_search_paginates(analytics_db):
    factory, admin, person, tester, now = analytics_db
    period = DateRange(start=(now - timedelta(days=6)).date(), end=now.date())
    async with factory.begin() as s:
        data = await users_page(s, period, query="example.com", limit=2, offset=0)
        assert data["total"] == 3 and len(data["items"]) == 2
        assert (await users_page(s, period, query="%"))["total"] == 0
        detail = await user_detail(s, person, period)
        assert detail["user"]["email"] == "person@example.com"
        assert detail["events"] == []


@pytest.mark.asyncio
async def test_deleted_email_can_register_again_without_old_identity(analytics_db):
    factory, admin, person, tester, now = analytics_db
    async with factory.begin() as s:
        await record_event(s, {"id": uuid4(), "name": "login", "user_id": person})
        await s.execute(text("DELETE FROM users WHERE id=:id"), {"id": person})
        new_id = uuid4()
        await s.execute(
            text("INSERT INTO users(id,email) VALUES (:id,:email)"),
            {"id": new_id, "email": "person@example.com"},
        )
        assert (
            await s.execute(
                text("SELECT count(*) FROM analytics_events WHERE user_id=:id"),
                {"id": person},
            )
        ).scalar() == 0
        assert (
            await s.execute(
                text("SELECT id FROM users WHERE email=:email"),
                {"email": "person@example.com"},
            )
        ).scalar() == new_id
        assert new_id != person
        assert (
            await s.execute(
                text("SELECT count(*) FROM users WHERE id=:id"), {"id": admin}
            )
        ).scalar() == 1


@pytest.mark.asyncio
async def test_retention_rollup_preserves_totals_and_milestones(analytics_db):
    from app.analytics.repository import rollup_and_prune

    factory, admin, person, tester, now = analytics_db
    old = now - timedelta(days=91)
    async with factory.begin() as s:
        await s.execute(text("TRUNCATE analytics_daily"))
        for actor in (admin, person, tester):
            await record_event(
                s,
                {
                    "id": uuid4(),
                    "name": "recipe_saved",
                    "user_id": actor,
                    "occurred_at": old,
                },
            )
        await record_event(
            s, {"id": uuid4(), "name": "login", "user_id": person, "occurred_at": now}
        )
        assert await rollup_and_prune(s) == 3
        assert (
            await s.execute(text("SELECT count(*) FROM analytics_events"))
        ).scalar() == 1
        metrics = (
            await s.execute(text("SELECT metrics FROM analytics_daily"))
        ).scalar_one()
        assert metrics["events"] == 1
        assert (
            await s.execute(
                text(
                    "SELECT first_recipe_at FROM analytics_profiles WHERE user_id=:id"
                ),
                {"id": person},
            )
        ).scalar() == old
        assert await rollup_and_prune(s) == 0
        assert (
            await s.execute(text("SELECT metrics FROM analytics_daily"))
        ).scalar_one() == metrics


@pytest.mark.asyncio
async def test_untracked_history_and_immature_cohorts(analytics_db):
    factory, admin, person, tester, now = analytics_db
    async with factory.begin() as s:
        old = await overview(
            s,
            DateRange(
                start=(now - timedelta(days=20)).date(),
                end=(now - timedelta(days=10)).date(),
            ),
        )
        assert old["coverage"]["unavailable"] is True
        assert all(day["visitors"] is None for day in old["series"])
        current = await overview(
            s, DateRange(start=(now - timedelta(days=6)).date(), end=now.date())
        )
        assert current["coverage"]["unavailable"] is False
        assert current["engagement"]["funnel"]["signed_up"] == 1
        assert current["engagement"]["funnel"]["mature_users"] == 0
        assert current["engagement"]["cohorts"][0]["weeks"][-1] is None


@pytest.mark.asyncio
async def test_account_switch_does_not_hide_authenticated_customer(analytics_db):
    factory, admin, person, tester, now = analytics_db
    visitor, visit = uuid4(), uuid4()
    async with factory.begin() as s:
        for actor in (admin, person):
            await record_event(
                s,
                {
                    "id": uuid4(),
                    "name": "page_view",
                    "is_client": True,
                    "user_id": actor,
                    "visitor_id": visitor,
                    "session_id": visit,
                    "path": "/library",
                },
            )
            await record_event(
                s,
                {
                    "id": uuid4(),
                    "name": "recipe_saved",
                    "user_id": actor,
                    "visitor_id": visitor,
                    "session_id": visit,
                },
            )
        data = await overview(s, DateRange(start=now.date(), end=now.date()))
        assert data["totals"]["active_users"] == 1
        assert data["totals"]["recipes_saved"] == 1
        assert data["totals"]["visitors"] == 1


@pytest.mark.asyncio
async def test_user_history_is_null_when_unavailable(analytics_db):
    factory, admin, person, tester, now = analytics_db
    period = DateRange(
        start=(now - timedelta(days=20)).date(), end=(now - timedelta(days=10)).date()
    )
    async with factory.begin() as s:
        data = await users_page(s, period)
        assert data["items"][0]["logins"] is None
        assert data["coverage"]["unavailable"] is True
        detail = await user_detail(s, person, period)
        assert detail["coverage"]["unavailable"] is True


@pytest.mark.asyncio
async def test_copy_only_reports_new_rows(analytics_db):
    from app.api.routes_recipes import copy_catalog_recipe
    from app.api.routes_users import copy_friend_recipe
    from starlette.requests import Request
    from types import SimpleNamespace

    factory, admin, person, tester, now = analytics_db
    recipe = str(uuid4())
    async with factory.begin() as s:
        await s.execute(
            text("UPDATE users SET is_library_public=true WHERE id=:id"), {"id": admin}
        )
        await s.execute(
            text(
                "INSERT INTO recipes(id,user_id,title,ingredients,is_public_catalog) VALUES (:id,:owner,'Example','[]',true)"
            ),
            {"id": recipe, "owner": admin},
        )
        first = Request({"type": "http", "state": {}})
        await copy_catalog_recipe(
            recipe_id=recipe,
            session=s,
            current_user=SimpleNamespace(id=person),
            request=first,
        )
        assert first.state.analytics_skip is False
        again = Request({"type": "http", "state": {}})
        await copy_catalog_recipe(
            recipe_id=recipe,
            session=s,
            current_user=SimpleNamespace(id=person),
            request=again,
        )
        assert again.state.analytics_skip is True
        own = Request({"type": "http", "state": {}})
        await copy_catalog_recipe(
            recipe_id=recipe,
            session=s,
            current_user=SimpleNamespace(id=admin),
            request=own,
        )
        assert own.state.analytics_skip is True
        friend = Request({"type": "http", "state": {}})
        await copy_friend_recipe(
            user_id=admin,
            recipe_id=recipe,
            session=s,
            current_user=SimpleNamespace(id=tester),
            request=friend,
        )
        assert friend.state.analytics_skip is False
        repeated = Request({"type": "http", "state": {}})
        await copy_friend_recipe(
            user_id=admin,
            recipe_id=recipe,
            session=s,
            current_user=SimpleNamespace(id=tester),
            request=repeated,
        )
        assert repeated.state.analytics_skip is True
