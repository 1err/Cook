"""Opt-in concurrency checks against an explicitly supplied disposable PostgreSQL DB.

Apply Alembic migrations first. Normal test runs skip this module; it never uses
the app's DATABASE_URL or connects to a developer/production database implicitly.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.cooking import CookingStepActionBody
from app.db import repo_ai_usage, repo_cooking, repo_recipes, repo_users
from app.db.models import AIUsageCounterModel, CookingSessionStepModel, RecipeModel, UserModel
from app.models import Recipe


@pytest_asyncio.fixture
async def pg_sessions():
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("Requires an explicitly configured disposable PostgreSQL test database")
    parsed = make_url(database_url)
    assert parsed.drivername == "postgresql+asyncpg"
    assert parsed.database in {"cooking_audit_test", "chef_beta_budget_20260922",
                               "chef_beta_accounts_20260922", "chef_beta_full_20260922"}
    effective_host = str(parsed.query.get("host", parsed.host or ""))
    assert effective_host in {"localhost", "127.0.0.1", "::1"} or effective_host.startswith(
        "/private/tmp/cooking-disposable-db-"
    )
    engine = create_async_engine(database_url, pool_size=12)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    finally:
        await engine.dispose()


async def add_user(factory):
    user_id = uuid4()
    async with factory.begin() as session:
        session.add(UserModel(id=user_id, email=f"{user_id}@example.com"))
    return user_id


@pytest.mark.asyncio
async def test_concurrent_recipe_ids_cannot_transfer_ownership(pg_sessions):
    owners = await asyncio.gather(add_user(pg_sessions), add_user(pg_sessions))
    recipe_id = str(uuid4())

    async def save(owner):
        async with pg_sessions() as session:
            try:
                result = await repo_recipes.save_recipe(
                    session, Recipe(id=recipe_id, title=str(owner), ingredients=[], is_public_catalog=True), owner,
                )
                await session.commit()
                return result
            except repo_recipes.RecipeOwnershipConflict:
                await session.rollback()
                return None

    results = await asyncio.gather(*(save(owner) for owner in owners))
    assert sum(result is not None for result in results) == 1
    async with pg_sessions() as session:
        row = await session.get(RecipeModel, recipe_id)
        assert row is not None
        assert str(row.user_id) == row.title
        assert not row.is_public_catalog


@pytest.mark.asyncio
async def test_expiry_read_cannot_overwrite_concurrent_completion(pg_sessions):
    user_id = await add_user(pg_sessions)
    async with pg_sessions.begin() as session:
        recipe = await repo_recipes.save_recipe(
            session, Recipe(id=str(uuid4()), title="Soup", ingredients=[], steps=[{
                "text": "Simmer", "duration_seconds": 60, "attention_type": "passive",
            }]), user_id,
        )
        active = await repo_cooking.create_session(session, user_id, [recipe.id])
        session_id, step_id = UUID(active.id), UUID(active.dishes[0].steps[0].id)
        await session.execute(update(CookingSessionStepModel).where(CookingSessionStepModel.id == step_id).values(
            state="timer_running", timer_ends_at=datetime.now(timezone.utc)-timedelta(seconds=10),
        ))

    async with pg_sessions() as writer, pg_sessions() as reader:
        await repo_cooking.apply_action(writer, user_id, session_id, step_id, CookingStepActionBody(
            action="complete", mutation_id=uuid4(), device_id="test-writer",
            occurred_at=datetime.now(timezone.utc), expected_revision=1,
        ))
        read_task = asyncio.create_task(repo_cooking.get_active_session(reader, user_id))
        try:
            # Hold the writer transaction while the reader encounters its lock.
            # Without the parent-row read lock, the reader snapshots the old timer
            # and its later flush overwrites this completion after commit.
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(read_task), timeout=0.15)
            await writer.commit()
            observed = await asyncio.wait_for(read_task, timeout=3)
            await reader.commit()
        finally:
            if not read_task.done():
                read_task.cancel()
                await asyncio.gather(read_task, return_exceptions=True)
        assert observed is not None
        assert observed.dishes[0].steps[0].state == "completed"
    async with pg_sessions() as session:
        step = await session.get(CookingSessionStepModel, step_id)
        assert step.state == "completed"


@pytest.mark.asyncio
async def test_postgres_removal_compacts_nonlast_dish(pg_sessions):
    user_id = await add_user(pg_sessions)
    async with pg_sessions.begin() as session:
        recipes = [await repo_recipes.save_recipe(
            session, Recipe(id=str(uuid4()), title=f"Dish {index}", ingredients=[], steps=["Cook"]), user_id,
        ) for index in range(3)]
        active = await repo_cooking.create_session(session, user_id, [recipe.id for recipe in recipes])
    async with pg_sessions.begin() as session:
        remaining = await repo_cooking.remove_dish(
            session, user_id, UUID(active.id), UUID(active.dishes[0].id),
        )
        assert remaining is not None
        assert [dish.position for dish in remaining.dishes] == [0, 1]


@pytest.mark.asyncio
async def test_ai_limits_remain_atomic_under_concurrent_requests(pg_sessions, monkeypatch):
    for setting, limit in (
        ("AI_GLOBAL_REQUESTS_PER_MINUTE", 1000), ("AI_GLOBAL_REQUESTS_PER_DAY", 1000),
        ("AI_USER_REQUESTS_PER_MINUTE", 1000), ("AI_USER_REQUESTS_PER_DAY", 3),
    ):
        monkeypatch.setattr(repo_ai_usage.settings, setting, limit)
    async with pg_sessions.begin() as session:
        await session.execute(delete(AIUsageCounterModel))
    user_id = str(uuid4())

    async def admit():
        async with pg_sessions() as session:
            try:
                await repo_ai_usage.reserve_ai_budget(session, user_id)
                await session.commit()
                return True
            except repo_ai_usage.AIUsageLimitExceeded:
                await session.rollback()
                return False

    outcomes = await asyncio.gather(*(admit() for _ in range(12)))
    assert sum(outcomes) == 3
    async with pg_sessions() as session:
        rows = (await session.execute(select(AIUsageCounterModel))).scalars().all()
        daily = {row.scope: row.request_count for row in rows if row.window_seconds == 86400}
        # A rejected final user/day counter must roll back the earlier global
        # and user/minute increments from the same reservation.
        assert daily == {"global": 3, f"user:{user_id}": 3}


@pytest.mark.asyncio
async def test_global_ai_limit_is_shared_across_accounts(pg_sessions, monkeypatch):
    for setting, limit in (
        ("AI_GLOBAL_REQUESTS_PER_MINUTE", 1000), ("AI_GLOBAL_REQUESTS_PER_DAY", 4),
        ("AI_USER_REQUESTS_PER_MINUTE", 1000), ("AI_USER_REQUESTS_PER_DAY", 1000),
    ):
        monkeypatch.setattr(repo_ai_usage.settings, setting, limit)
    async with pg_sessions.begin() as session:
        await session.execute(delete(AIUsageCounterModel))

    async def admit():
        async with pg_sessions() as session:
            try:
                await repo_ai_usage.reserve_ai_budget(session, str(uuid4()))
                await session.commit()
                return True
            except repo_ai_usage.AIUsageLimitExceeded:
                await session.rollback()
                return False

    assert sum(await asyncio.gather(*(admit() for _ in range(12)))) == 4


async def public_copy_source(factory):
    owner_id, caller_id = await asyncio.gather(add_user(factory), add_user(factory))
    async with factory.begin() as session:
        await session.execute(update(UserModel).where(UserModel.id == owner_id).values(is_library_public=True))
        recipe = await repo_recipes.save_recipe(
            session, Recipe(id=str(uuid4()), title="Shared recipe", ingredients=[]), owner_id,
        )
        await repo_recipes.set_recipe_public_catalog(session, recipe.id, owner_id, True)
    return owner_id, caller_id, recipe.id


@pytest.mark.asyncio
async def test_catalog_and_friend_copies_share_one_idempotency_lock(pg_sessions):
    owner_id, caller_id, recipe_id = await public_copy_source(pg_sessions)

    async def copy(use_catalog):
        async with pg_sessions.begin() as session:
            if use_catalog:
                row = await repo_recipes.copy_public_recipe_to_user(session, recipe_id, caller_id)
            else:
                row = await repo_users.copy_friend_recipe_to_user(session, owner_id, recipe_id, caller_id)
            return row.id

    copies = await asyncio.gather(*(copy(index % 2 == 0) for index in range(12)))
    assert len(set(copies)) == 1
    async with pg_sessions() as session:
        rows = (await session.execute(select(RecipeModel).where(
            RecipeModel.user_id == caller_id, RecipeModel.catalog_source_recipe_id == recipe_id,
        ))).scalars().all()
        assert len(rows) == 1


@pytest.mark.asyncio
async def test_legacy_duplicate_copies_are_preserved_and_return_one_stable_match(pg_sessions):
    owner_id, caller_id, recipe_id = await public_copy_source(pg_sessions)
    copy_ids = sorted([str(uuid4()), str(uuid4())])
    async with pg_sessions.begin() as session:
        for copy_id in copy_ids:
            session.add(RecipeModel(id=copy_id, user_id=caller_id, title="Legacy copy", ingredients="[]",
                                    catalog_source_recipe_id=recipe_id))
    async with pg_sessions.begin() as session:
        catalog = await repo_recipes.copy_public_recipe_to_user(session, recipe_id, caller_id)
        friend = await repo_users.copy_friend_recipe_to_user(session, owner_id, recipe_id, caller_id)
        assert catalog.id == friend.id == copy_ids[0]
        retained = (await session.execute(select(RecipeModel.id).where(RecipeModel.id.in_(copy_ids)))).scalars().all()
        assert sorted(retained) == copy_ids


def configure_image_tests(monkeypatch, **overrides):
    from app.core.config import settings
    from decimal import Decimal
    configuration = {
        "OPENAI_API_KEY": "test-only-key", "AI_IMAGE_GENERATION_ENABLED": True,
        "AI_IMAGE_ACCESS_MODE": "registered", "AI_IMAGE_USER_REQUESTS_PER_MINUTE": 1000,
        "AI_IMAGE_USER_REQUESTS_PER_DAY": 1000, "AI_IMAGE_GLOBAL_REQUESTS_PER_MINUTE": 1000,
        "AI_IMAGE_GLOBAL_REQUESTS_PER_DAY": 1000, **overrides,
        "AI_MONTHLY_BUDGET_USD": Decimal('29'), "AI_ACCOUNT_MONTHLY_BUDGET_USD": Decimal('3'),
        "AI_GLOBAL_MAX_INFLIGHT": 100, "AI_USER_MAX_INFLIGHT": 20,
    }
    for name, value in configuration.items():
        monkeypatch.setattr(settings, name, value)


async def reset_image_counters(factory):
    # This fixture only accepts the explicitly named disposable test database.
    async with factory.begin() as session:
        await session.execute(delete(AIUsageCounterModel).where(AIUsageCounterModel.scope.like("image:%")))
        from app.db.ai_cost_models import AICallLedgerModel, AIMonthlyBudgetModel, AIInflightLeaseModel
        for model in (AICallLedgerModel, AIMonthlyBudgetModel, AIInflightLeaseModel):
            await session.execute(delete(model))


@pytest.mark.asyncio
async def test_concurrent_image_replays_are_admitted_and_charged_once(pg_sessions, monkeypatch):
    from app.db import repo_recipe_images
    from app.db.models import RecipeImageGenerationModel
    configure_image_tests(monkeypatch)
    await reset_image_counters(pg_sessions)
    owner = await add_user(pg_sessions)
    request_id = uuid4()

    async def reserve():
        async with pg_sessions.begin() as session:
            row, admitted = await repo_recipe_images.begin_generation(
                session, owner, request_id, {"title": "Tofu casserole"})
            return row.status, admitted

    responses = await asyncio.gather(*(reserve() for _ in range(12)))
    assert sum(admitted for _, admitted in responses) == 1
    assert all(status == "pending" for status, _ in responses)
    async with pg_sessions() as session:
        rows = (await session.execute(select(RecipeImageGenerationModel).where(
            RecipeImageGenerationModel.user_id == owner))).scalars().all()
        counters = (await session.execute(select(AIUsageCounterModel).where(
            AIUsageCounterModel.scope.like("image:%")))).scalars().all()
        assert len(rows) == 1
        assert len(counters) == 4
        assert all(row.request_count == 1 for row in counters)


@pytest.mark.asyncio
async def test_concurrent_image_daily_limit_rolls_back_all_rejected_charges(pg_sessions, monkeypatch):
    from app.db import repo_recipe_images
    from app.db.models import RecipeImageGenerationModel
    from app.services.recipe_image_service import ImageGenerationError
    configure_image_tests(monkeypatch, AI_IMAGE_USER_REQUESTS_PER_DAY=3)
    await reset_image_counters(pg_sessions)
    owner = await add_user(pg_sessions)

    async def reserve():
        async with pg_sessions() as session:
            try:
                await repo_recipe_images.begin_generation(session, owner, uuid4(), {"title": "Tofu"})
                await session.commit()
                return True
            except ImageGenerationError as exc:
                await session.rollback()
                assert exc.code == "daily_limit"
                return False

    assert sum(await asyncio.gather(*(reserve() for _ in range(12)))) == 3
    async with pg_sessions() as session:
        rows = (await session.execute(select(RecipeImageGenerationModel).where(
            RecipeImageGenerationModel.user_id == owner))).scalars().all()
        counters = (await session.execute(select(AIUsageCounterModel).where(
            AIUsageCounterModel.scope.like("image:%")))).scalars().all()
        assert len(rows) == 3
        assert len(counters) == 4
        assert all(row.request_count == 3 for row in counters)


@pytest.mark.asyncio
async def test_image_global_limit_is_shared_across_accounts(pg_sessions, monkeypatch):
    from app.db import repo_recipe_images
    from app.services.recipe_image_service import ImageGenerationError
    configure_image_tests(monkeypatch, AI_IMAGE_GLOBAL_REQUESTS_PER_DAY=4)
    await reset_image_counters(pg_sessions)
    owners = await asyncio.gather(*(add_user(pg_sessions) for _ in range(12)))

    async def reserve(owner):
        async with pg_sessions() as session:
            try:
                await repo_recipe_images.begin_generation(session, owner, uuid4(), {"title": "Tofu"})
                await session.commit()
                return True
            except ImageGenerationError as exc:
                await session.rollback()
                assert exc.code == "global_limit"
                return False

    assert sum(await asyncio.gather(*(reserve(owner) for owner in owners))) == 4


@pytest.mark.asyncio
async def test_image_entitlements_use_database_time_and_expired_grants_deny(pg_sessions, monkeypatch):
    from app.db import repo_recipe_images
    from app.db.models import FeatureEntitlementModel
    from app.services.recipe_image_service import ImageGenerationError
    configure_image_tests(monkeypatch, AI_IMAGE_ACCESS_MODE="members")
    await reset_image_counters(pg_sessions)
    owner = await add_user(pg_sessions)
    async with pg_sessions.begin() as session:
        now = await repo_recipe_images.database_now(session)
        session.add(FeatureEntitlementModel(user_id=owner, feature_key="recipe_image_generation",
            expires_at=now - timedelta(seconds=1)))
    async with pg_sessions() as session:
        with pytest.raises(ImageGenerationError, match="active membership"):
            await repo_recipe_images.begin_generation(session, owner, uuid4(), {"title": "Tofu"})
        await session.rollback()
        await session.execute(update(FeatureEntitlementModel).where(
            FeatureEntitlementModel.user_id == owner).values(expires_at=None))
        await session.commit()
        _, admitted = await repo_recipe_images.begin_generation(session, owner, uuid4(), {"title": "Tofu"})
        await session.commit()
        assert admitted is True


@pytest.mark.asyncio
async def test_image_stale_status_reader_cannot_overwrite_concurrent_completion(pg_sessions, monkeypatch):
    from app.db import repo_recipe_images
    from app.db.models import RecipeImageGenerationModel
    configure_image_tests(monkeypatch)
    owner = await add_user(pg_sessions)
    request_id = uuid4()
    async with pg_sessions.begin() as session:
        now = await repo_recipe_images.database_now(session)
        session.add(RecipeImageGenerationModel(user_id=owner, request_id=request_id, request_hash="a" * 64,
            status="pending", created_at=now - timedelta(minutes=3), deadline_at=now - timedelta(minutes=1)))

    async with pg_sessions() as writer, pg_sessions() as reader:
        await writer.execute(update(RecipeImageGenerationModel).where(
            RecipeImageGenerationModel.user_id == owner,
            RecipeImageGenerationModel.request_id == request_id,
        ).values(status="completed", file_url="https://test.invalid/finished.png"))
        reading = asyncio.create_task(repo_recipe_images.find_request(reader, owner, request_id))
        try:
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(reading), timeout=0.1)
            await writer.commit()
            result = await asyncio.wait_for(reading, timeout=3)
            await reader.commit()
            assert result.status == "completed"
            assert result.file_url == "https://test.invalid/finished.png"
        finally:
            if not reading.done():
                reading.cancel()
                await asyncio.gather(reading, return_exceptions=True)
