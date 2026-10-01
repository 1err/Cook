"""Real PostgreSQL contracts for ingredient matching, scopes and cursor isolation."""
import json
import os
import uuid
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.db.models import RecipeModel, UserModel
from app.db.repo_library_search import search_library
from app.services.ingredient_search import canonical_ingredient

@pytest.mark.parametrize("raw, expected", [
    ("鸡胸肉", "chicken"), ("Chicken thighs", "chicken"),
    ("chopped garlic", "garlic"), ("蒜末", "garlic"),
    ("鸡汤", "chicken stock"), ("chicken broth", "chicken stock"),
    ("sweet potato", "sweet potato"), ("potato starch", "potato starch"),
    ("POTATO", "potato"), ("  Ｃｈｉｃｋｅｎ  ", "chicken"),
    ("chicken (stock)", "chicken (stock)"), ("potato (starch)", "potato (starch)"),
    ("strawberry", "strawberry"), ("ginger (sliced)", "ginger"),
])
def test_aliases_do_not_confuse_meat_stock_or_starches(raw, expected):
    assert canonical_ingredient(raw) == expected

URL = os.environ.get("TEST_DATABASE_URL", "")
@pytest.mark.asyncio
@pytest.mark.skipif(not URL, reason="Requires disposable PostgreSQL")
async def test_filtering_precedes_pagination_and_removal_never_leaks_other_users():
    engine=create_async_engine(URL)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as s:
            me, public, private = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
            s.add_all([UserModel(id=id,email=f"{id}@example.test") for id in [me,public,private]])
            await s.flush()
            prefix=uuid.uuid4().hex
            def row(id,owner,names,**kw):
                return RecipeModel(id=prefix+id,user_id=owner,title=prefix+id,
                    ingredients=json.dumps([{"name":n,"quantity":"PRIVATE AMOUNT"} for n in names]),
                    raw_extraction_text="PRIVATE IMPORT",steps='[{"text":"PRIVATE INSTRUCTION"}]',**kw)
            s.add_all([
                row("a", public, ["鸡胸肉","土豆","蒜末","蒜瓣","食用油"],is_public_catalog=True),
                row("b", me, ["chicken thighs","potato","salt"]),
                row("c", public, ["chicken broth","potato"],is_public_catalog=True),
                row("d", public, ["chicken","sweet potato","potato starch"],is_public_catalog=True),
                row("e", private, ["chicken","potato"]),
                row("f", me, ["chicken","potato"],is_library_hidden=True),
                row("g", public, ["chicken (stock)","potato (starch)"],is_public_catalog=True),
            ])
            await s.flush()
            first=await search_library(s,me,q=prefix,ingredients=["chicken","土豆"],match="all",limit=1)
            assert first.total_count == 2 and len(first.items)==1 and first.next_cursor
            assert first.items[0].id==prefix+"b"  # one other ingredient, before the public three
            second=await search_library(s,me,q=prefix,ingredients=["鸡肉","potato"],match="all",limit=1,cursor=first.next_cursor)
            assert [r.id for r in second.items]==[prefix+"a"] and not second.next_cursor
            assert second.items[0].remaining_ingredients==["garlic","oil"]
            assert second.items[0].matched_ingredients==["chicken","potato"]
            assert not second.items[0].is_owned and first.items[0].is_owned
            # garlic aliases collapse, so this row actually has only two other ingredients.
            assert second.total_count == 2
            any_page=await search_library(s,me,q=prefix,ingredients=["chicken","potato"],match="any")
            assert {r.id for r in any_page.items}=={prefix+x for x in "abcd"}
            meat=await search_library(s,me,q=prefix,ingredients=["chicken"])
            assert {r.id for r in meat.items}=={prefix+x for x in "abd"}
            assert [r.id for r in (await search_library(s,me,q=prefix,ingredients=["chicken","potato"],scope="mine")).items]==[prefix+"b"]
            assert [r.id for r in (await search_library(s,me,q=prefix,ingredients=["chicken","potato"],scope="catalog")).items]==[prefix+"a"]
            for changes in [dict(match="any"), dict(scope="mine"),dict(ingredients=["potato"]),dict(q="other")]:
                args=dict(q=prefix,ingredients=["chicken","potato"],cursor=first.next_cursor);args.update(changes)
                with pytest.raises(ValueError):await search_library(s,me,**args)
            with pytest.raises(ValueError):await search_library(s,private,q=prefix,ingredients=["chicken","potato"],cursor=first.next_cursor)
            assert not (await search_library(s,me,q=prefix,ingredients=["chicken","strawberry"])).items
            payload=any_page.model_dump_json()
            assert "PRIVATE" not in payload and "quantity" not in payload and "raw_extraction_text" not in payload
            await s.rollback()
    finally:await engine.dispose()

@pytest.mark.asyncio
@pytest.mark.skipif(not URL, reason="Requires disposable PostgreSQL")
async def test_all_collection_prefers_visible_personal_copy_and_counts_all_pages():
    engine=create_async_engine(URL)
    try:
        async with async_sessionmaker(engine,expire_on_commit=False)() as s:
            me,owner=uuid.uuid4(),uuid.uuid4();prefix=uuid.uuid4().hex
            s.add_all([UserModel(id=id,email=f"{id}@example.test") for id in [me,owner]])
            await s.flush()
            source=RecipeModel(id=prefix+"source",user_id=owner,title=prefix+" Soup",ingredients='[{"name":"chicken"}]',is_public_catalog=True)
            copied=RecipeModel(id=prefix+"copy",user_id=me,title=prefix+" ZZZ soup",ingredients='[{"name":"chicken"}]',catalog_source_recipe_id=source.id)
            s.add_all([source,copied]+[RecipeModel(id=prefix+str(i),user_id=owner,title=prefix+" A"+str(i),ingredients='[{"name":"egg"}]',is_public_catalog=True) for i in range(45)])
            await s.flush()
            first=await search_library(s,me,q=prefix,limit=40)
            assert first.total_count==46 and len(first.items)==40 and first.next_cursor
            assert copied.id not in {r.id for r in first.items}
            second=await search_library(s,me,q=prefix,limit=40,cursor=first.next_cursor)
            assert second.total_count==46 and len(second.items)==6 and not second.next_cursor
            assert len({r.id for r in first.items+second.items})==46
            chicken=await search_library(s,me,q=prefix,ingredients=["chicken"])
            assert [r.id for r in chicken.items]==[copied.id]
            copied.is_library_hidden=True;await s.flush()
            chicken=await search_library(s,me,q=prefix,ingredients=["chicken"])
            assert [r.id for r in chicken.items]==[source.id] and not chicken.items[0].already_saved
            await s.rollback()
    finally:await engine.dispose()


def test_http_bounds_and_auth_apply_to_search_and_options():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from app.api import routes_recipes
    from app.api.auth import get_current_user
    from app.db.session import get_session
    app=FastAPI();app.include_router(routes_recipes.router)
    with TestClient(app) as client:
        assert client.get("/recipes/search/page").status_code==401
        assert client.get("/recipes/ingredient-options").status_code==401
    app.dependency_overrides[get_current_user]=lambda:SimpleNamespace(id=uuid.uuid4())
    app.dependency_overrides[get_session]=lambda:AsyncMock()
    with TestClient(app) as client:
        for query in ["scope=friend", "match=none", "limit=101", "ingredients=", "ingredients="+"a"*101, "&".join(["ingredients=chicken"]*21)]:
            assert client.get("/recipes/search/page?"+query).status_code==422
        options=client.get("/recipes/ingredient-options").json()
        assert next(item for item in options if item["id"]=="chicken")["zh"]=="鸡肉"
