"""Opt-in disposable PostgreSQL author persistence and concurrency contracts."""
import asyncio
import os
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, event, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.db import repo_recipe_authors as authors, repo_recipes
from app.db.models import RecipeAuthorModel, RecipeAuthorKeyModel, RecipeModel, UserModel
from app.db.repo_library_search import search_library
from app.models import Recipe

URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not URL, reason="Requires disposable PostgreSQL")]


@pytest.fixture(autouse=True)
def disposable_database_only():
    if URL:
        parsed = make_url(URL)
        assert parsed.drivername == "postgresql+asyncpg"
        assert parsed.host in {"localhost", "127.0.0.1", "::1"}
        assert parsed.database.startswith("chef_authors_preview_") or parsed.database.endswith("_test")


async def test_combined_title_author_alias_search_tags_and_author_filter_across_pages():
    engine = create_async_engine(URL)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            owner, caller = uuid.uuid4(), uuid.uuid4()
            prefix = uuid.uuid4().hex
            session.add_all([UserModel(id=owner, email=f"{owner}@example.test", is_library_public=True),
                             UserModel(id=caller, email=f"{caller}@example.test")])
            await session.flush()
            author = await authors.create_author(session, prefix + " 王刚", ["Chef " + prefix, "100%_Chef"])
            other = await authors.create_author(session, prefix + " Other")
            for suffix, credited, tags in [("a", author.id, ["quick", "vegetarian"]),
                                           ("b", author.id, ["quick", "vegetarian"]),
                                           ("c", other.id, ["quick", "vegetarian"]),
                                           ("d", author.id, ["quick"])]:
                saved = await repo_recipes.save_recipe(session, Recipe(
                    id=prefix + suffix, title="番茄炒蛋 " + suffix, author_id=credited,
                    ingredients=[{"name": "Tomato", "quantity": "1"}], library_tags=tags,
                ), owner)
                assert saved.author.id == credited
                session.add(RecipeModel(id=prefix + "mine" + suffix, user_id=caller, title=saved.title,
                    author_id=credited, ingredients='[{"name":"Tomato","quantity":"1"}]',
                    library_tags='["quick","vegetarian"]', is_public_catalog=False))
                (await session.get(RecipeModel, saved.id)).is_public_catalog = True
            await session.flush()
            for scope in [{"owner_id": owner}, {"catalog": True}, {}]:
                first = await repo_recipes.recipe_page(session, caller, q="  番茄   王刚 ",
                    tags=["quick", "vegetarian"], author_id=author.id, limit=1, **scope)
                assert first.items[0].author == author and first.next_cursor
                second = await repo_recipes.recipe_page(session, caller, q="番茄 王刚",
                    tags=["vegetarian", "quick"], author_id=author.id, limit=1, cursor=first.next_cursor, **scope)
                assert first.items[0].id != second.items[0].id
                for changed in [{"author_id": other.id}, {"author_id": None}]:
                    with pytest.raises(ValueError, match="cursor"):
                        await repo_recipes.recipe_page(session, caller, q="番茄 王刚", tags=["quick", "vegetarian"],
                            limit=1, cursor=first.next_cursor, **changed, **scope)
            literal = await repo_recipes.recipe_page(session, caller, owner_id=owner, q="100%_Chef 番茄", author_id=author.id)
            assert len(literal.items) == 3
            assert not (await repo_recipes.recipe_page(session, caller, owner_id=owner, q="100XXChef")).items
            unicode = await repo_recipes.recipe_page(session, caller, owner_id=owner, q="ＣＨＥＦ " + prefix)
            assert len(unicode.items) == 3
            first = await search_library(session, caller, scope="catalog", q="番茄 王刚", tags=["vegetarian"],
                author_id=author.id, ingredients=["tomato"], include_ingredients=True, limit=1)
            assert first.total_count == 2 and first.items[0].author == author and first.next_cursor
            second = await search_library(session, caller, scope="catalog", q="番茄 王刚", tags=["vegetarian"],
                author_id=author.id, ingredients=["tomato"], include_ingredients=True, limit=1, cursor=first.next_cursor)
            assert second.items[0].id != first.items[0].id and second.next_cursor is None
            with pytest.raises(ValueError, match="cursor"):
                await search_library(session, caller, scope="catalog", q="番茄 王刚", tags=["vegetarian"],
                    author_id=other.id, ingredients=["tomato"], include_ingredients=True, limit=1, cursor=first.next_cursor)
            await session.rollback()
    finally:
        await engine.dispose()


async def test_concurrent_equivalent_creates_return_one_canonical_identity_without_orphans():
    engine = create_async_engine(URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    prefix = uuid.uuid4().hex
    ids = set()
    try:
        async def create(name):
            async with factory() as session:
                author = await authors.create_author(session, name, [prefix + " Alias"])
                await session.commit()
                ids.add(author.id)
                return author
        rows = await asyncio.gather(*(create(name) for name in [prefix + " Chef", prefix + "  CHEF", prefix + " Ｃｈｅｆ"] * 3))
        assert len({row.id for row in rows}) == 1
        async with factory() as session:
            assert await session.scalar(select(func.count()).select_from(RecipeAuthorModel).where(RecipeAuthorModel.name.startswith(prefix))) == 1
            assert await session.scalar(select(func.count()).select_from(RecipeAuthorKeyModel).where(RecipeAuthorKeyModel.author_id == rows[0].id)) == 2
            assert (await authors.create_author(session, prefix + " ALIAS")).id == rows[0].id
            with pytest.raises(authors.AuthorIdentityConflict):
                await authors.create_author(session, prefix + " Another", [prefix + " Alias"])
            await session.rollback()
    finally:
        async with factory() as session:
            await session.execute(delete(RecipeAuthorModel).where(RecipeAuthorModel.id.in_(ids)))
            await session.commit()
        await engine.dispose()


async def test_nullable_author_join_keeps_catalog_row_lock_and_account_deletion_working():
    from app.db.repo_account_deletion import delete_account
    engine = create_async_engine(URL)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            owner, caller = uuid.uuid4(), uuid.uuid4()
            session.add_all([UserModel(id=owner, email=f"{owner}@example.test"),
                             UserModel(id=caller, email=f"{caller}@example.test")])
            await session.flush()
            recipe = await repo_recipes.save_recipe(session, Recipe(id=uuid.uuid4().hex, title="Soup", ingredients=[]), owner)
            published = await repo_recipes.set_recipe_public_catalog(session, recipe.id, owner, True)
            assert published.is_public_catalog and published.author is None
            session.add(RecipeModel(id=uuid.uuid4().hex, user_id=caller, title="Copy", ingredients="[]",
                thumbnail_url=f"http://api/uploads/recipes/{owner}/image.png"))
            await session.flush()
            assert await delete_account(session, owner)
            await session.rollback()
    finally:
        await engine.dispose()


async def test_persisted_credit_switch_omission_and_clear_work_after_new_session_reload():
    engine = create_async_engine(URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    owner, recipe_id, prefix = uuid.uuid4(), uuid.uuid4().hex, uuid.uuid4().hex
    ids = []
    try:
        async with factory.begin() as session:
            session.add(UserModel(id=owner, email=f"{owner}@example.test"))
            await session.flush()
            a = await authors.create_author(session, prefix + " Lin")
            b = await authors.create_author(session, prefix + " Chen")
            ids.extend([a.id, b.id])
            first = await repo_recipes.save_recipe(session, Recipe(id=recipe_id, title="Ｆｕｌｌｗｉｄｔｈ Soup", ingredients=[], author_id=a.id), owner)
            assert first.author == a
            changed = await repo_recipes.save_recipe(session, Recipe(id=recipe_id, title=first.title, ingredients=[], author_id=b.id,
                author={"id": b.id, "name": "Forged", "aliases": ["Wrong"]}), owner)
            assert changed.author == b
        async with factory.begin() as session:
            reloaded = await repo_recipes.get_recipe(session, recipe_id, owner)
            assert reloaded.author == b
            legacy = await repo_recipes.save_recipe(session, Recipe(id=recipe_id, title=reloaded.title, ingredients=[]), owner)
            assert legacy.author == b
            found = await repo_recipes.recipe_page(session, owner, q="ＦＵＬＬＷＩＤＴＨ Chen", author_id=b.id)
            assert [item.id for item in found.items] == [recipe_id]
            cleared = await repo_recipes.save_recipe(session, Recipe(id=recipe_id, title=reloaded.title, ingredients=[], author_id=None), owner)
            assert cleared.author_id is None and cleared.author is None
        async with factory() as session:
            assert (await repo_recipes.get_recipe(session, recipe_id, owner)).author is None
    finally:
        async with factory.begin() as session:
            await session.execute(delete(UserModel).where(UserModel.id == owner))
            await session.execute(delete(RecipeAuthorModel).where(RecipeAuthorModel.id.in_(ids)))
        await engine.dispose()


@pytest.mark.parametrize("concurrent_clear", [False, True])
async def test_title_only_patch_does_not_restore_credit_read_before_concurrent_edit(concurrent_clear):
    from app.api.routes_recipes import RecipeUpdate, recipe_update
    engine = create_async_engine(URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    owner, recipe_id, prefix = uuid.uuid4(), uuid.uuid4().hex, uuid.uuid4().hex
    author_ids = []
    patch_task = None
    try:
        async with factory.begin() as session:
            session.add(UserModel(id=owner, email=f"{owner}@example.test"))
            await session.flush()
            original = await authors.create_author(session, prefix + " Original")
            replacement = await authors.create_author(session, prefix + " Replacement")
            author_ids.extend([original.id, replacement.id])
            await repo_recipes.save_recipe(session, Recipe(id=recipe_id, title="Soup", ingredients=[],
                author_id=original.id), owner)

        async with factory() as writer, factory() as patch_session:
            # Hold the owner lock so PATCH can read old credit, then wait to save.
            await writer.execute(select(UserModel.id).where(UserModel.id == owner).with_for_update())
            patch_waiting = asyncio.Event()

            def owner_lock_started(_conn, _cursor, statement, _params, _context, _many):
                if "FROM users" in statement and "FOR UPDATE" in statement:
                    patch_waiting.set()

            event.listen(engine.sync_engine, "before_cursor_execute", owner_lock_started)
            try:
                patch_task = asyncio.create_task(recipe_update(recipe_id, RecipeUpdate(title="Renamed soup"),
                    patch_session, SimpleNamespace(id=owner)))
                await asyncio.wait_for(patch_waiting.wait(), timeout=3)
                assert not patch_task.done()
                new_author_id = None if concurrent_clear else replacement.id
                await repo_recipes.save_recipe(writer, Recipe(id=recipe_id, title="Soup", ingredients=[],
                    author_id=new_author_id), owner)
                await writer.commit()
                patched = await asyncio.wait_for(patch_task, timeout=3)
                await patch_session.commit()
            finally:
                event.remove(engine.sync_engine, "before_cursor_execute", owner_lock_started)
                if patch_task is not None and not patch_task.done():
                    patch_task.cancel()
                    await asyncio.gather(patch_task, return_exceptions=True)

        assert patched.title == "Renamed soup"
        assert patched.author_id == new_author_id
        assert patched.author == (None if concurrent_clear else replacement)
        async with factory() as session:
            reloaded = await repo_recipes.get_recipe(session, recipe_id, owner)
            assert reloaded.title == "Renamed soup" and reloaded.author_id == new_author_id
    finally:
        async with factory.begin() as session:
            await session.execute(delete(UserModel).where(UserModel.id == owner))
            await session.execute(delete(RecipeAuthorModel).where(RecipeAuthorModel.id.in_(author_ids)))
        await engine.dispose()
