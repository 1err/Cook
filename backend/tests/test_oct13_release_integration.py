"""Production source remains compatible with the October 13 client contracts."""
from app.api import auth


def test_current_account_delete_route_is_available_to_readiness_clients():
    assert any(route.path == "/auth/me" and "DELETE" in route.methods for route in auth.router.routes)


import pytest
from sqlalchemy import select, text, update
from app.db.models import RecipeModel, UserModel
from app.models import Recipe
from test_postgres_integrations import pg_sessions, add_user
from test_ai_cost_postgres import accounting


@pytest.mark.asyncio
async def test_paged_discovery_applies_bilateral_blocks(pg_sessions):
    from app.db import repo_content_safety, repo_recipes
    from app.db.repo_library_search import search_library
    owner, viewer = await add_user(pg_sessions), await add_user(pg_sessions)
    async with pg_sessions.begin() as session:
        session.add(RecipeModel(id=str(owner), user_id=owner, title="Private shared soup", ingredients="[]", is_public_catalog=True))
        await session.execute(update(UserModel).where(UserModel.id == owner).values(is_library_public=True))
    async with pg_sessions() as session:
        assert str(owner) in {r.id for r in (await repo_recipes.recipe_page(session, viewer, catalog=True)).items}
    async with pg_sessions.begin() as session:
        await repo_content_safety.block_user(session, viewer, owner)
    async with pg_sessions() as session:
        assert str(owner) not in {r.id for r in (await repo_recipes.recipe_page(session, viewer, catalog=True)).items}
        assert str(owner) not in {r.id for r in (await search_library(session, viewer, scope="catalog")).items}
        assert (await repo_recipes.recipe_page(session, viewer, owner_id=owner)).items == []


@pytest.mark.asyncio
async def test_paged_shared_photos_wait_for_digest_approval(pg_sessions, monkeypatch):
    from app.core.config import settings
    from app.db import repo_recipes
    from app.db.repo_library_search import search_library
    from app.services.media_review_service import recipe_media_digest
    owner, viewer = await add_user(pg_sessions), await add_user(pg_sessions)
    monkeypatch.setattr(settings, "PUBLIC_API_ORIGIN", "http://api")
    url = f"http://api/uploads/recipes/{owner}/" + "a" * 32 + ".png"
    async with pg_sessions.begin() as session:
        session.add(RecipeModel(id=str(owner), user_id=owner, title="Reviewed soup", ingredients="[]", thumbnail_url=url, is_public_catalog=True))
    async with pg_sessions() as session:
        private = next(r for r in (await repo_recipes.recipe_page(session, owner)).items if r.id == str(owner))
        shared = next(r for r in (await repo_recipes.recipe_page(session, viewer, catalog=True)).items if r.id == str(owner))
        searched = next(r for r in (await search_library(session, viewer, scope="catalog")).items if r.id == str(owner))
        assert private.thumbnail_url == url
        assert shared.thumbnail_url is None and searched.thumbnail_url is None
        assert shared.shared_media_status == "pending"
    async with pg_sessions.begin() as session:
        row = await session.get(RecipeModel, str(owner))
        row.approved_media_digest = recipe_media_digest(row)
    async with pg_sessions() as session:
        shared = next(r for r in (await repo_recipes.recipe_page(session, viewer, catalog=True)).items if r.id == str(owner))
        assert shared.thumbnail_url == url and shared.shared_media_status == "approved"


@pytest.mark.asyncio
async def test_paged_shared_text_filter_excludes_legacy_unsafe_rows(pg_sessions):
    from app.db import repo_recipes
    from app.db.repo_library_search import search_library
    owner, viewer = await add_user(pg_sessions), await add_user(pg_sessions)
    async with pg_sessions.begin() as session:
        session.add(RecipeModel(id=str(owner), user_id=owner, title="Ｋｉｌｌ\nyourself", ingredients="[]", is_public_catalog=True))
    async with pg_sessions() as session:
        assert str(owner) not in {r.id for r in (await repo_recipes.recipe_page(session, viewer, catalog=True)).items}
        assert str(owner) not in {r.id for r in (await search_library(session, viewer, scope="catalog")).items}
        assert str(owner) in {r.id for r in (await repo_recipes.recipe_page(session, owner)).items}



def test_migration_runner_checks_committed_heads_before_success():
    from app import migrate
    from types import SimpleNamespace
    from unittest.mock import patch
    expected = SimpleNamespace(get_heads=lambda: ["20261013_media_review"])
    committed = SimpleNamespace(get_current_heads=lambda: ("20261013_media_review",))
    with patch.object(migrate.ScriptDirectory, "from_config", return_value=expected), patch.object(
        migrate.MigrationContext, "configure", return_value=committed):
        assert migrate.verify_committed_heads(object(), object()) == ("20261013_media_review",)
    stale = SimpleNamespace(get_current_heads=lambda: ("20261001_library_visibility",))
    with patch.object(migrate.ScriptDirectory, "from_config", return_value=expected), patch.object(
        migrate.MigrationContext, "configure", return_value=stale):
        with pytest.raises(RuntimeError, match="Committed database migration head"):
            migrate.verify_committed_heads(object(), object())



@pytest.mark.asyncio
async def test_account_erasure_scrubs_private_financial_scope_without_refunding_global_money(accounting, monkeypatch, tmp_path):
    pg_sessions = accounting
    from datetime import date, datetime, timedelta, timezone
    from decimal import Decimal
    from uuid import uuid4
    from app.core.config import settings
    from app.core.ai_cost import Price
    from app.db.ai_cost_models import AIMonthlyBudgetModel, AICallLedgerModel, AIInflightLeaseModel
    from app.db.repo_account_deletion import delete_account
    from app.db.repo_ai_cost import reserve_call, reconcile_call
    from app.db.import_job_models import ImportJobModel
    from app.db.job_models import StoreRequestLeaseModel
    from fastapi import HTTPException
    owner = await add_user(pg_sessions)
    now = datetime.now(timezone.utc)
    call, lease, store_lease = uuid4(), uuid4(), uuid4()
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "")
    monkeypatch.setattr(settings, "LOCAL_IMAGE_UPLOAD_DIR", str(tmp_path))
    async with pg_sessions.begin() as session:
        await reserve_call(session, call_id=call, request_id=uuid4(), account_id=str(owner), operation="test", price=Price("test", "v1", Decimal("1"), Decimal("1")), input_bound=1, output_bound=1, global_cap=100000, account_cap=100000)
        session.add(AIInflightLeaseModel(id=lease, account_id=str(owner), expires_at=now + timedelta(minutes=1)))
        session.add(StoreRequestLeaseModel(id=store_lease, account_id=str(owner), expires_at=now + timedelta(minutes=1)))
        session.add(ImportJobModel(user_id=owner, auth_version=0, payload={"private": "recipe text"}, status="queued", expires_at=now+timedelta(minutes=1)))
    async with pg_sessions() as session:
        global_before = await session.get(AIMonthlyBudgetModel, ("global", now.date().replace(day=1)))
        totals = global_before.reserved_nano, global_before.spent_nano
    async with pg_sessions.begin() as session:
        assert await delete_account(session, owner)
    async with pg_sessions() as session:
        assert await session.get(AIMonthlyBudgetModel, (f"user:{owner}", now.date().replace(day=1))) is None
        ledger = await session.get(AICallLedgerModel, call)
        assert ledger.account_id != str(owner)
        # The in-flight slots still count against the global concurrency caps.
        assert (await session.get(AIInflightLeaseModel, lease)).account_id != str(owner)
        assert (await session.get(StoreRequestLeaseModel, store_lease)).account_id != str(owner)
        assert (await session.execute(select(ImportJobModel).where(ImportJobModel.user_id == owner))).first() is None
        global_after = await session.get(AIMonthlyBudgetModel, ("global", now.date().replace(day=1)))
        assert (global_after.reserved_nano, global_after.spent_nano) == totals
    async with pg_sessions.begin() as session:
        await reconcile_call(session, call, input_tokens=1, output_tokens=1)
    async with pg_sessions() as session:
        global_after = await session.get(AIMonthlyBudgetModel, ("global", now.date().replace(day=1)))
        assert global_after.reserved_nano == totals[0] - 2000
        assert global_after.spent_nano == totals[1] + 2000
    async with pg_sessions() as session:
        with pytest.raises(HTTPException) as caught:
            await reserve_call(session, call_id=uuid4(), request_id=uuid4(), account_id=str(owner), operation="late", price=Price("test", "v1", Decimal("1"), Decimal("1")), input_bound=1, output_bound=1, global_cap=100000, account_cap=100000)
        assert caught.value.status_code == 401



@pytest.mark.asyncio
async def test_image_admission_and_account_erasure_use_consistent_lock_order(accounting, monkeypatch, tmp_path):
    import asyncio
    from uuid import uuid4
    from app.core.config import settings
    from app.db import repo_recipe_images
    from app.db.repo_account_deletion import delete_account
    from test_postgres_integrations import configure_image_tests
    configure_image_tests(monkeypatch)
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "")
    monkeypatch.setattr(settings, "LOCAL_IMAGE_UPLOAD_DIR", str(tmp_path))
    owner = await add_user(accounting)
    inserted, release = asyncio.Event(), asyncio.Event()
    async with accounting() as writer, accounting() as eraser:
        execute = writer.execute
        async def observed(statement, *args, **kwargs):
            result = await execute(statement, *args, **kwargs)
            if str(statement).startswith("INSERT INTO recipe_image_generations"):
                inserted.set()
                await release.wait()
            return result
        monkeypatch.setattr(writer, "execute", observed)
        async def admit():
            result = await repo_recipe_images.begin_generation(writer, owner, uuid4(), {"title": "Soup"})
            await writer.commit()
            return result[1]
        async def erase():
            result = await delete_account(eraser, owner)
            await eraser.commit()
            return result
        admission = asyncio.create_task(admit())
        await asyncio.wait_for(inserted.wait(), timeout=3)
        deletion = asyncio.create_task(erase())
        try:
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(deletion), timeout=0.15)
            release.set()
            assert await asyncio.wait_for(asyncio.gather(admission, deletion), timeout=3) == [True, True]
        finally:
            release.set()
            for task in (admission, deletion):
                if not task.done(): task.cancel()
            await asyncio.gather(admission, deletion, return_exceptions=True)
    async with accounting() as session:
        assert await session.get(UserModel, owner) is None
