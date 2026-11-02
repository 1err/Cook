"""Canonical author identities, authenticated API validation and recipe credits."""
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api import routes_recipes
from app.db import repo_recipes, repo_users
from app.db.models import UserModel, RecipeModel
from app.models import Recipe
from test_recipe_write_security import SqlSession, OWNER_ID, CALLER_ID


def test_recipe_credit_is_optional_but_explicit_credit_survives_validation():
    author_id = str(uuid.uuid4())
    recipe = Recipe(id="credited", title="Soup", ingredients=[], author_id=author_id,
                    author={"id": author_id, "name": "Chef Lin", "aliases": ["阿林"]})
    assert recipe.model_dump().get("author_id") == author_id
    assert recipe.model_dump().get("author") == {"id": author_id, "name": "Chef Lin", "aliases": ["阿林"]}
    assert "author_id" not in Recipe(id="legacy", title="Soup", ingredients=[]).model_fields_set


def test_author_routes_require_authentication_and_bound_input():
    app = FastAPI()
    app.include_router(routes_recipes.router)
    app.dependency_overrides[routes_recipes.get_session] = lambda: AsyncMock()
    with TestClient(app) as client:
        assert client.get("/recipes/authors").status_code == 401
        assert client.post("/recipes/authors", json={"name": "Chef Lin"}).status_code == 401
        app.dependency_overrides[routes_recipes.get_current_user] = lambda: SimpleNamespace(id=CALLER_ID)
        for payload in [{"name": "   "}, {"name": "x" * 81}, {"name": "Lin", "aliases": ["a"] * 9},
                        {"name": "Lin", "aliases": [""]}, {"name": "Lin", "aliases": ["x" * 81]}]:
            assert client.post("/recipes/authors", json=payload).status_code == 422
        for query in ["limit=0", "limit=101", "q=" + "a" * 201]:
            assert client.get("/recipes/authors?" + query).status_code == 422


@pytest.fixture
def author_session():
    from app.db.models import RecipeAuthorModel, RecipeAuthorKeyModel
    engine = create_engine("sqlite:///:memory:")
    for table in [UserModel.__table__, RecipeAuthorModel.__table__, RecipeAuthorKeyModel.__table__, RecipeModel.__table__]:
        table.create(engine)
    from readiness_schema import create_readiness_schema
    create_readiness_schema(engine)
    with Session(engine) as session:
        session.add_all([UserModel(id=OWNER_ID, email="owner@example.test", is_library_public=True),
                         UserModel(id=CALLER_ID, email="caller@example.test")])
        session.flush()
        wrapper = SqlSession(session)
        @asynccontextmanager
        async def nested():
            with session.begin_nested():
                yield
        wrapper.begin_nested = nested
        yield wrapper
    engine.dispose()


@pytest.mark.asyncio
async def test_equivalent_names_and_known_alias_reuse_without_mutating_registry(author_session):
    from app.db import repo_recipe_authors as authors
    first = await authors.create_author(author_session, "  Ｃhef   Lin ", ["阿林", "Straße"])
    assert first.name == "Chef Lin"
    assert first.aliases == ["阿林", "Straße"]
    for name in ["chef lin", "ＣＨＥＦ\u3000LIN", "阿林", "STRASSE"]:
        reused = await authors.create_author(author_session, name, ["untrusted new alias"])
        assert reused == first
    assert [item.id for item in await authors.list_authors(author_session, q="阿林")] == [first.id]
    assert await authors.list_authors(author_session, q="untrusted new alias") == []
    distinct = await authors.create_author(author_session, "Chef Lynn")
    assert distinct.id != first.id


@pytest.mark.asyncio
async def test_alias_collision_never_merges_or_reassigns_existing_identities(author_session):
    from app.db import repo_recipe_authors as authors
    lin = await authors.create_author(author_session, "Lin", ["阿林"])
    chen = await authors.create_author(author_session, "Chen", ["阿陈"])
    for name, aliases in [("Lin", ["阿陈"]), ("New Name", ["阿林"]), ("New", ["阿林", "阿陈"])]:
        with pytest.raises(authors.AuthorIdentityConflict):
            await authors.create_author(author_session, name, aliases)
    assert [a.model_dump() for a in await authors.list_authors(author_session)] == [chen.model_dump(), lin.model_dump()]


@pytest.mark.asyncio
async def test_post_omission_retains_credit_explicit_null_clears_and_nested_metadata_cannot_rename(author_session):
    from app.db import repo_recipe_authors as authors
    author = await authors.create_author(author_session, "Chef Lin", ["阿林"])
    saved = await routes_recipes.recipe_create(Recipe(id="mine", title="Soup", ingredients=[], author_id=author.id),
                                               author_session, SimpleNamespace(id=CALLER_ID))
    assert saved.author == author
    old_client = Recipe(id=saved.id, title="Edited soup", ingredients=[],
                        author={"id": author.id, "name": "Forged", "aliases": ["Bad"]})
    preserved = await routes_recipes.recipe_create(old_client, author_session, SimpleNamespace(id=CALLER_ID))
    assert preserved.author_id == author.id and preserved.author == author
    patched = await routes_recipes.recipe_update(saved.id, routes_recipes.RecipeUpdate(title="Patch"),
                                                author_session, SimpleNamespace(id=CALLER_ID))
    assert patched.author == author
    cleared = await routes_recipes.recipe_update(saved.id, routes_recipes.RecipeUpdate(author_id=None),
                                                author_session, SimpleNamespace(id=CALLER_ID))
    assert cleared.author_id is None and cleared.author is None
    await routes_recipes.recipe_create(Recipe(id=saved.id, title="Soup", ingredients=[], author_id=author.id),
                                       author_session, SimpleNamespace(id=CALLER_ID))
    cleared_post = await routes_recipes.recipe_create(Recipe(id=saved.id, title="Soup", ingredients=[], author_id=None),
                                                     author_session, SimpleNamespace(id=CALLER_ID))
    assert cleared_post.author_id is None and cleared_post.author is None


@pytest.mark.asyncio
async def test_unknown_author_is_422_and_other_owner_credit_cannot_be_edited(author_session):
    author_session.add(RecipeModel(id="source", user_id=OWNER_ID, title="Source", ingredients="[]"))
    await author_session.flush()
    with pytest.raises(HTTPException) as error:
        await routes_recipes.recipe_create(Recipe(id="mine", title="Mine", ingredients=[], author_id=str(uuid.uuid4())),
                                           author_session, SimpleNamespace(id=CALLER_ID))
    assert error.value.status_code == 422
    with pytest.raises(HTTPException) as error:
        await routes_recipes.recipe_update("source", routes_recipes.RecipeUpdate(author_id=None),
                                           author_session, SimpleNamespace(id=CALLER_ID))
    assert error.value.status_code == 404
    assert (await repo_recipes.get_recipe(author_session, "source", OWNER_ID)).title == "Source"


@pytest.mark.asyncio
async def test_authenticated_directory_and_credit_http_requests_persist_canonical_metadata(author_session):
    app = FastAPI()
    app.include_router(routes_recipes.router)
    app.dependency_overrides[routes_recipes.get_session] = lambda: author_session
    app.dependency_overrides[routes_recipes.get_current_user] = lambda: SimpleNamespace(id=CALLER_ID)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/recipes/authors", json={"name": "Chef Lin", "aliases": ["阿林"]})
        assert created.status_code == 200
        author = created.json()
        reused = await client.post("/recipes/authors", json={"name": "阿林", "aliases": ["Extra"]})
        assert reused.json() == author
        assert (await client.get("/recipes/authors?q=阿林&limit=1")).json() == [author]
        assert (await client.post("/recipes/authors", json={"name": "New", "aliases": ["阿林"]})).status_code == 409
        saved = await client.post("/recipes", json={"id": "http", "title": "Soup", "ingredients": [],
            "author_id": author["id"], "author": {**author, "name": "Forged"}})
        assert saved.status_code == 200 and saved.json()["author"] == author
        unknown = await client.patch("/recipes/http", json={"author_id": str(uuid.uuid4())})
        assert unknown.status_code == 422
        assert (await client.get("/recipes/http")).json()["author"] == author
        replacement = (await client.post("/recipes/authors", json={"name": "Chen"})).json()
        changed = await client.patch("/recipes/http", json={"author_id": replacement["id"]})
        assert changed.json()["author"] == replacement
        assert (await client.get("/recipes/http")).json()["author"] == replacement


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["catalog", "friend"])
async def test_both_copy_paths_retain_credit_and_copy_edit_does_not_change_source(author_session, path):
    from app.db import repo_recipe_authors as authors
    author = await authors.create_author(author_session, "Chef Lin", ["阿林"])
    source = await repo_recipes.save_recipe(author_session, Recipe(id="source", title="Soup", ingredients=[], author_id=author.id), OWNER_ID)
    author_session.sync.get(RecipeModel, source.id).is_public_catalog = True
    await author_session.flush()
    if path == "catalog":
        copied = await repo_recipes.copy_public_recipe_to_user(author_session, source.id, CALLER_ID)
    else:
        copied = repo_recipes._row_to_recipe(await repo_users.copy_friend_recipe_to_user(author_session, OWNER_ID, source.id, CALLER_ID))
    assert copied.author_id == author.id and copied.author == author
    await routes_recipes.recipe_update(copied.id, routes_recipes.RecipeUpdate(author_id=None),
                                      author_session, SimpleNamespace(id=CALLER_ID))
    assert (await repo_recipes.get_recipe(author_session, source.id, OWNER_ID)).author == author


@pytest.mark.asyncio
async def test_author_filter_search_and_cursor_scope_are_shared_by_page_and_ingredient_search():
    from app.db.repo_library_search import search_library
    from sqlalchemy.dialects import postgresql
    class EmptyResult:
        def mappings(self): return self
        def all(self): return []
    session = AsyncMock()
    session.execute.return_value = EmptyResult()
    session.scalar.return_value = 0
    author_id = str(uuid.uuid4())
    for function, kwargs in [(repo_recipes.recipe_page, {}), (search_library, {"scope": "all"})]:
        await function(session, CALLER_ID, q="阿林", tags=["quick"], author_id=author_id, **kwargs)
        compiled = session.execute.call_args.args[0].compile(dialect=postgresql.dialect())
        sql = str(compiled)
        assert "recipe_author_keys" in sql and "normalized_name" in sql
        assert "recipes.author_id =" in sql
        assert author_id in compiled.params.values()
        assert ["quick"] in compiled.params.values()
    query = routes_recipes.RecipePageQuery(limit=40, cursor=None, q="", tags=[], author_id=author_id)
    assert query.values["author_id"] == author_id
