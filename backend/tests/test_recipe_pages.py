"""Bounded page contracts: privacy, projection, cursor ownership and ordering."""
import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.db import repo_recipes


@pytest.mark.parametrize('limit', [0, 101, -1])
@pytest.mark.asyncio
async def test_repository_rejects_unbounded_page(limit):
    with pytest.raises(ValueError):
        await repo_recipes.recipe_page(AsyncMock(), uuid.uuid4(), limit=limit)


def test_cursor_cannot_cross_owner_filter_or_be_tampered():
    scope = ['mine', 'owner', '', []]
    token = repo_recipes._encode_page_cursor(scope, 'same title', 'b')
    assert repo_recipes._decode_page_cursor(token, scope) == ('same title', 'b')
    for other in [['mine', 'other', '', []], ['catalog', 'owner', '', []], ['mine', 'owner', 'x', []]]:
        with pytest.raises(ValueError):
            repo_recipes._decode_page_cursor(token, other)
    with pytest.raises(ValueError):
        repo_recipes._decode_page_cursor(token[:-5] + 'AAAAA', scope)


@pytest.mark.asyncio
async def test_page_query_projects_summary_and_limits_with_stable_keyset():
    class Result:
        def mappings(self): return self
        def all(self): return []
    session = AsyncMock()
    session.execute.return_value = Result()
    caller = uuid.uuid4()
    token = repo_recipes._encode_page_cursor(['mine', str(caller), '', []], 'same', 'b')
    page = await repo_recipes.recipe_page(session, caller, limit=2, cursor=token)
    query = session.execute.call_args.args[0]
    sql = str(query.compile(dialect=postgresql.dialect(), compile_kwargs={'literal_binds': True}))
    projection = sql.split('FROM recipes')[0]
    assert 'raw_extraction_text' not in sql
    assert 'recipes.ingredients,' not in projection
    assert 'recipes.steps,' not in projection
    assert 'LIMIT 3' in sql
    assert 'recipes.user_id =' in sql
    assert '(left(lower(recipes.title), 256), lower(recipes.title), recipes.id) >' in sql
    assert 'ORDER BY left(lower(recipes.title), 256), lower(recipes.title), recipes.id' in sql
    assert page.items == [] and page.next_cursor is None


@pytest.mark.asyncio
async def test_equal_titles_generate_last_returned_cursor_and_lookahead_not_returned():
    caller = uuid.uuid4()
    rows = [dict(id=id, title='Same', sort_title='same', source_url=None, thumbnail_url=None,
                 library_tags='[]', library_category=None, is_public_catalog=False,
                 catalog_source_recipe_id=None, total_time_minutes=None, ingredient_count=0,
                 step_count=0, already_saved=True) for id in ['a', 'b', 'c']]
    class Result:
        def mappings(self): return self
        def all(self): return rows
    session = AsyncMock()
    session.execute.return_value = Result()
    page = await repo_recipes.recipe_page(session, caller, limit=2)
    assert [r.id for r in page.items] == ['a', 'b']
    assert repo_recipes._decode_page_cursor(page.next_cursor, ['mine', str(caller), '', []]) == ('same', 'b')
    assert not {'ingredients', 'steps', 'raw_extraction_text'} & page.items[0].model_dump().keys()


@pytest.mark.asyncio
async def test_page_returns_passive_timing_without_inventing_hands_on_from_total():
    # A 490-minute total cannot validate the ten fallback minutes left after chilling.
    row = dict(id='timed', title='Youtiao', sort_title='youtiao', source_url=None,
               thumbnail_url=None, library_tags='[]', library_category=None,
               is_public_catalog=False, catalog_source_recipe_id=None,
               total_time_minutes=490, ingredient_count=1, step_count=2,
               already_saved=True, timing_steps=[
                   {'duration_seconds': 28800, 'duration_source': 'stated', 'attention_type': 'passive'},
                   {'duration_seconds': 600, 'duration_source': 'fallback', 'attention_type': 'hands_on'},
               ])

    class Result:
        def mappings(self): return self
        def all(self): return [row]

    session = AsyncMock()
    session.execute.return_value = Result()
    page = await repo_recipes.recipe_page(session, uuid.uuid4())
    payload = page.model_dump()['items'][0]
    assert payload.get('timing_summary') == {
        'hands_on_minutes': None, 'passive_minutes': 480, 'is_estimate': False,
    }
    assert payload['total_time_minutes'] == 490
    assert not {'timing_steps', 'steps', 'text', 'raw_extraction_text'} & payload.keys()


@pytest.mark.asyncio
async def test_friend_page_query_rechecks_public_sharing_and_copy_state_scoped_to_caller():
    class Result:
        def mappings(self): return self
        def all(self): return []
    session = AsyncMock()
    session.execute.return_value = Result()
    caller, owner = uuid.uuid4(), uuid.uuid4()
    await repo_recipes.recipe_page(session, caller, owner_id=owner, q='100%_Soup', tags=['quick', 'vegetarian'])
    query = session.execute.call_args.args[0]
    compiled = query.compile(dialect=postgresql.dialect())
    sql = str(compiled)
    assert 'users.is_library_public IS true' in sql
    assert 'recipes.user_id =' in sql
    assert 'recipes_1.user_id =' in sql
    assert 'recipes_1.catalog_source_recipe_id = recipes.id' in sql
    assert "ESCAPE '/'" in sql
    assert '100/%/_soup' in compiled.params.values()
    assert str(owner) in [str(x) for x in compiled.params.values()]
    assert str(caller) in [str(x) for x in compiled.params.values()]
    assert ['quick'] in compiled.params.values() and ['vegetarian'] in compiled.params.values()


def test_http_rejects_large_pages_bad_cursor_and_tags_and_documents_legacy(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api import routes_recipes
    from app.api.auth import get_current_user
    from app.db.session import get_session
    from types import SimpleNamespace
    app = FastAPI()
    app.include_router(routes_recipes.router)
    caller = uuid.uuid4()
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=caller)
    app.dependency_overrides[get_session] = lambda: AsyncMock()
    with TestClient(app) as client:
        for query in ['limit=101', 'limit=0', 'cursor=broken', 'tags=not-a-tag', 'q=' + 'a'*201]:
            assert client.get('/recipes/page?' + query).status_code == 422
    paths = app.openapi()['paths']
    assert paths['/recipes']['get']['deprecated'] is True
    assert paths['/recipes/catalog']['get']['deprecated'] is True


@pytest.mark.asyncio
async def test_friend_page_and_detail_reject_private_and_self_even_with_valid_cursor(monkeypatch):
    from types import SimpleNamespace
    from app.api import routes_users
    from app.api.recipe_pages import RecipePageQuery
    caller, owner = uuid.uuid4(), uuid.uuid4()
    session = AsyncMock()
    monkeypatch.setattr(routes_users.repo_users, 'get_user_by_id', AsyncMock(return_value=SimpleNamespace(is_library_public=False)))
    query = RecipePageQuery(limit=40, cursor=None, q='', tags=[])
    for target in [caller, owner]:
        with pytest.raises(HTTPException) as caught:
            await routes_users.friend_library_page(target, query, session, SimpleNamespace(id=caller))
        assert caught.value.status_code == 404
        with pytest.raises(HTTPException) as caught:
            await routes_users.friend_recipe_detail(target, 'secret', session, SimpleNamespace(id=caller))
        assert caught.value.status_code == 404
    session.execute.assert_not_called()


def test_maximum_unicode_cursor_stays_within_http_bound():
    scope = ['friend:'+str(uuid.uuid4()), str(uuid.uuid4()), '😀'*200, ['vegetarian','mediterranean']]
    token = repo_recipes._encode_page_cursor(scope, '😀'*1024, '😀'*255)
    assert len(token) < 8192
    assert repo_recipes._decode_page_cursor(token, scope) == ('😀'*1024, '😀'*255)
