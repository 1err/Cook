"""Cross-replica erasure races on the explicitly disposable PostgreSQL fixture."""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select

from app.api import ai_budget
from app.db import repo_auth, repo_recipes
from app.db.models import AccountMediaCleanupModel, AIUsageCounterModel, RecipeModel, UserModel
from app.db.repo_account_deletion import delete_account
from app.models import Recipe
from test_postgres_integrations import pg_sessions, add_user


@pytest.mark.asyncio
async def test_storage_lock_makes_deletion_wait_then_erases_account_and_owned_recipe(pg_sessions, monkeypatch, tmp_path):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'LOCAL_IMAGE_UPLOAD_DIR', str(tmp_path))
    monkeypatch.setattr(settings, 'S3_BUCKET_NAME', '')
    owner = await add_user(pg_sessions)
    async with pg_sessions() as writer, pg_sessions() as eraser:
        assert await repo_auth.lock_user_for_media_write(writer, owner)
        pending = asyncio.create_task(delete_account(eraser, owner))
        try:
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(pending), timeout=0.15)
            await writer.commit()
            assert await asyncio.wait_for(pending, timeout=3)
            await eraser.commit()
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
    async with pg_sessions() as session:
        assert await session.get(UserModel, owner) is None
        assert not await repo_auth.lock_user_for_media_write(session, owner)
        assert await session.get(AccountMediaCleanupModel, owner) is not None


@pytest.mark.asyncio
async def test_committed_erasure_prevents_late_ai_counter_reservation(pg_sessions, monkeypatch, tmp_path):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'LOCAL_IMAGE_UPLOAD_DIR', str(tmp_path))
    monkeypatch.setattr(settings, 'S3_BUCKET_NAME', '')
    monkeypatch.setattr(ai_budget, 'is_llm_enabled', lambda: True)
    owner = await add_user(pg_sessions)
    async with pg_sessions.begin() as eraser:
        assert await delete_account(eraser, owner)
    async with pg_sessions() as stale_request:
        with pytest.raises(HTTPException) as result:
            await anext(ai_budget.enforce_ai_budget(stale_request, SimpleNamespace(id=owner)))
        assert result.value.status_code == 401
    async with pg_sessions() as session:
        assert (await session.execute(select(AIUsageCounterModel).where(AIUsageCounterModel.scope == f'user:{owner}'))).scalars().all() == []


@pytest.mark.asyncio
async def test_account_erasure_rolls_back_with_cleanup_intent_on_transaction_failure(pg_sessions, monkeypatch, tmp_path):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'LOCAL_IMAGE_UPLOAD_DIR', str(tmp_path))
    monkeypatch.setattr(settings, 'S3_BUCKET_NAME', '')
    owner = await add_user(pg_sessions)
    async with pg_sessions.begin() as session:
        await repo_recipes.save_recipe(session, Recipe(id=str(uuid4()), title='Private soup', ingredients=[]), owner)
    async with pg_sessions() as eraser:
        assert await delete_account(eraser, owner)
        await eraser.rollback()
    async with pg_sessions() as session:
        assert await session.get(UserModel, owner) is not None
        assert await session.get(AccountMediaCleanupModel, owner) is None
        assert len((await session.execute(select(RecipeModel).where(RecipeModel.user_id == owner))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_two_accounts_with_cross_copied_media_can_both_be_erased(pg_sessions, monkeypatch, tmp_path):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'LOCAL_IMAGE_UPLOAD_DIR', str(tmp_path))
    monkeypatch.setattr(settings, 'S3_BUCKET_NAME', '')
    first, second = await asyncio.gather(add_user(pg_sessions), add_user(pg_sessions))
    async with pg_sessions.begin() as session:
        session.add(RecipeModel(id=str(uuid4()), user_id=first, title='First copy', ingredients='[]', thumbnail_url=f'http://api/uploads/recipes/{second}/image.png'))
        session.add(RecipeModel(id=str(uuid4()), user_id=second, title='Second copy', ingredients='[]', thumbnail_url=f'http://api/uploads/recipes/{first}/image.png'))

    async def erase(owner):
        async with pg_sessions.begin() as session:
            return await delete_account(session, owner)
    assert await asyncio.wait_for(asyncio.gather(erase(first), erase(second)), timeout=5) == [True, True]
    async with pg_sessions() as session:
        assert await session.get(UserModel, first) is None
        assert await session.get(UserModel, second) is None


@pytest.mark.asyncio
async def test_photo_discovery_waits_for_current_visibility_before_queuing(pg_sessions, monkeypatch):
    from sqlalchemy import update
    from app.core.config import settings
    from app.db import session as db_session, repo_media_reviews
    from app.db.models import RecipeMediaReviewModel
    monkeypatch.setattr(settings, 'PUBLIC_API_ORIGIN', 'http://api')
    monkeypatch.setattr(db_session, 'async_session_maker', pg_sessions)
    owner = await add_user(pg_sessions)
    recipe_id = str(uuid4())
    async with pg_sessions.begin() as session:
        await session.execute(update(UserModel).where(UserModel.id == owner).values(is_library_public=True))
        session.add(RecipeModel(id=recipe_id, user_id=owner, title='Shared soup', ingredients='[]',
            thumbnail_url=f'http://api/uploads/recipes/{owner}/'+('a'*32)+'.png'))
    async with pg_sessions() as visibility_writer:
        await visibility_writer.execute(update(UserModel).where(UserModel.id == owner).values(is_library_public=False))
        finding = asyncio.create_task(repo_media_reviews.discover_shared_media_reviews())
        try:
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(finding), timeout=0.15)
            await visibility_writer.commit()
            await asyncio.wait_for(finding, timeout=3)
        finally:
            if not finding.done():
                finding.cancel()
                await asyncio.gather(finding, return_exceptions=True)
    async with pg_sessions() as session:
        assert (await session.execute(select(RecipeMediaReviewModel).where(RecipeMediaReviewModel.recipe_id == recipe_id))).scalars().all() == []
