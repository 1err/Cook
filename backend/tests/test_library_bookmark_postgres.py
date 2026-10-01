"""Bookmark persistence, pagination and account-lock contracts on a disposable DB."""
import asyncio
import json
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from app.db import repo_recipes
from app.db.models import RecipeModel, UserModel, MealPlanModel
from test_postgres_integrations import pg_sessions


@pytest.mark.asyncio
async def test_bookmark_visibility_persists_in_all_pages_without_losing_edits_or_plans(pg_sessions):
    owner, caller, source = uuid4(), uuid4(), uuid4().hex
    try:
        async with pg_sessions.begin() as session:
            session.add_all([UserModel(id=id, email=f'{id}@example.test', is_library_public=True) for id in [owner, caller]])
            await session.flush()
            session.add(RecipeModel(id=source, user_id=owner, title=source, ingredients='[]', is_public_catalog=True))
        async with pg_sessions.begin() as session:
            saved = await repo_recipes.copy_public_recipe_to_user(session, source, caller)
            row = await session.get(RecipeModel, saved.id)
            row.title = 'My edited soup'
            row.raw_extraction_text = 'Keep my private notes'
            plan = MealPlanModel(user_id=caller, date='2026-10-01', recipe_ids=json.dumps({'dinner':[saved.id]}))
            session.add(plan)
        async with pg_sessions.begin() as session:
            assert await repo_recipes.unsave_public_recipe(session, source, caller)
            assert await repo_recipes.unsave_public_recipe(session, source, owner)
        # A new session represents a reload or another device, not an ORM cache.
        async with pg_sessions.begin() as session:
            for user in [owner, caller]:
                assert not (await repo_recipes.recipe_page(session, user)).items
            assert not (await repo_recipes.recipe_page(session, caller, owner_id=owner)).items
            assert not (await repo_recipes.recipe_page(session, owner, owner_id=caller)).items
            for user in [owner, caller]:
                catalog = await repo_recipes.recipe_page(session, user, catalog=True, q=source)
                assert len(catalog.items) == 1 and not catalog.items[0].already_saved
            planned = await repo_recipes.get_recipes_by_ids(session, [saved.id], caller)
            assert planned[0].title == 'My edited soup' and planned[0].raw_extraction_text == 'Keep my private notes'
            assert (await session.execute(select(MealPlanModel.recipe_ids).where(MealPlanModel.user_id == caller))).scalar_one() == plan.recipe_ids
            restored = await repo_recipes.copy_public_recipe_to_user(session, source, caller)
            assert restored.id == saved.id and restored.title == 'My edited soup'
            catalog = await repo_recipes.recipe_page(session, caller, catalog=True, q=source)
            assert catalog.items[0].already_saved
            assert len((await repo_recipes.recipe_page(session, caller)).items) == 1
            assert len((await repo_recipes.recipe_page(session, owner, owner_id=caller)).items) == 1
    finally:
        async with pg_sessions.begin() as session:
            await session.execute(delete(UserModel).where(UserModel.id.in_([owner, caller])))


@pytest.mark.asyncio
@pytest.mark.parametrize('first_action', ['save', 'remove'])
async def test_concurrent_save_remove_obey_account_lock_and_keep_one_copy(pg_sessions, first_action):
    owner, caller, source = uuid4(), uuid4(), uuid4().hex
    try:
        async with pg_sessions.begin() as session:
            session.add_all([UserModel(id=id, email=f'{id}@example.test') for id in [owner, caller]])
            await session.flush()
            session.add(RecipeModel(id=source, user_id=owner, title='Source', ingredients='[]', is_public_catalog=True))
        async with pg_sessions.begin() as session:
            copied = await repo_recipes.copy_public_recipe_to_user(session, source, caller)
        async def save(session): return await repo_recipes.copy_public_recipe_to_user(session, source, caller)
        async def remove(session): return await repo_recipes.unsave_public_recipe(session, source, caller)
        first, second = (save, remove) if first_action == 'save' else (remove, save)
        async with pg_sessions() as writer, pg_sessions() as contender:
            await first(writer)
            task = asyncio.create_task(second(contender))
            try:
                with pytest.raises(asyncio.TimeoutError):
                    await asyncio.wait_for(asyncio.shield(task), timeout=.15)
                await writer.commit()
                await asyncio.wait_for(task, timeout=3)
                await contender.commit()
            finally:
                if not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
        async with pg_sessions() as session:
            rows = (await session.execute(select(RecipeModel).where(RecipeModel.user_id == caller))).scalars().all()
            assert len(rows) == 1 and rows[0].id == copied.id
            assert rows[0].is_library_hidden == (first_action == 'save')
            assert not (await session.get(RecipeModel, source)).is_library_hidden
    finally:
        async with pg_sessions.begin() as session:
            await session.execute(delete(UserModel).where(UserModel.id.in_([owner, caller])))
