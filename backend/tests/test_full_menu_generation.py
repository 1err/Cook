"""Whole-menu images retain durable retries, ownership, and atomic daily admission."""
import copy
import hashlib
import json
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from test_menu_artwork_routes import menu_app
from test_recipe_image_generation import image_app, client_for, install_provider


@pytest.fixture
def full_menu_app(menu_app, monkeypatch):
    from app.api import routes_menu_creations
    from app.core.config import settings
    from app.db import repo_menu_creations
    from app.db.models import MenuCreationModel, RecipeModel
    for model in (MenuCreationModel, RecipeModel):
        model.__table__.create(menu_app.database.bind)
    menu_app.app.include_router(routes_menu_creations.router)
    monkeypatch.setattr(repo_menu_creations, 'database_now', menu_app.repo.database_now)
    monkeypatch.setattr(settings, 'AI_IMAGE_USER_REQUESTS_PER_MINUTE', 20)
    menu_app.database.add_all([
        RecipeModel(id='tofu', user_id=menu_app.user_id, title='豆腐茄子煲', ingredients='["private ingredient"]',
                    description='private description', source_url='https://private.invalid/recipe'),
        RecipeModel(id='soup', user_id=menu_app.user_id, title='番茄牛肉汤', ingredients='[]'),
    ])
    menu_app.database.commit()
    return menu_app


def body(**changes):
    return {'request_id': str(uuid4()), 'mode': 'full-menu-v1', 'title': '我家的小菜单',
            'brief': 'Cute hand-drawn vegetables, warm paper, little tomatoes.',
            'recipes': [{'recipe_id': 'tofu', 'name': '豆腐茄子煲'}, {'recipe_id': 'soup', 'name': '番茄牛肉汤'}],
            **changes}


def assert_unadmitted(app):
    from app.db.models import AIUsageCounterModel, MenuCreationModel, RecipeImageGenerationModel
    from app.db.ai_cost_models import AICallLedgerModel
    for model in (AIUsageCounterModel, MenuCreationModel, RecipeImageGenerationModel, AICallLedgerModel):
        assert not app.database.scalars(select(model)).all()


@pytest.mark.asyncio
async def test_whole_menu_uses_exact_snapshots_with_one_atomic_creation_and_export(full_menu_app, monkeypatch):
    from app.db.models import AIUsageCounterModel, MenuCreationModel, RecipeImageGenerationModel
    from app.db.ai_cost_models import AICallLedgerModel
    from app.core.ai_cost import configured_image_price, estimate_cost_nano, MENU_ARTWORK_OUTPUT_TOKEN_BOUND
    from app.core.config import settings
    app = full_menu_app
    provider, calls = await install_provider(monkeypatch, app.service)
    payload = body()
    async with provider, client_for(app) as client:
        first = await client.post('/menus/artwork', json=payload)
        assert first.status_code == 200, first.text
        assert first.json()['status'] == 'completed'
        replay = await client.post('/menus/artwork', json=payload)
        status = await client.get('/menus/artwork/' + payload['request_id'])
        exported = await client.get('/menus/artwork/' + payload['request_id'] + '/file')
        assert first.json() == replay.json() == status.json()
        assert exported.status_code == 200 and exported.content == b'\x89PNG\r\n\x1a\nfixture'
        assert (await client.get('/menus/access')).json()['remaining'] == 0
    assert len(calls) == 1
    prompt = calls[0]['prompt']
    quoted = json.loads(prompt.split('\nMenu data:\n', 1)[1])
    assert quoted == {'title': '我家的小菜单', 'brief': payload['brief'], 'dishes': ['豆腐茄子煲', '番茄牛肉汤']}
    assert 'private ingredient' not in prompt and 'private description' not in prompt and 'private.invalid' not in prompt
    assert 'exactly once' in prompt and 'original language' in prompt and 'complete' in prompt
    assert 'No text' not in prompt and 'blank center' not in prompt
    assert (calls[0]['size'], calls[0]['quality'], calls[0]['n']) == ('1024x1536', 'low', 1)
    creation = app.database.scalars(select(MenuCreationModel)).one()
    row = app.database.scalars(select(RecipeImageGenerationModel)).one()
    assert creation.request_id == row.request_id == UUID(payload['request_id'])
    assert (row.deadline_at - row.created_at).total_seconds() == 255
    expected_data = {key: value for key, value in payload.items() if key != 'request_id'}
    expected_data.update(prompt_version='menu-artwork-v3', layout_version='portrait-full-v1')
    expected_hash = hashlib.sha256(json.dumps(expected_data, sort_keys=True, ensure_ascii=False,
                                             separators=(',', ':')).encode()).hexdigest()
    assert row.request_hash == expected_hash and row.purpose == 'menu_artwork'
    counters = app.database.scalars(select(AIUsageCounterModel)).all()
    assert len(counters) == 5 and all(counter.request_count == 1 for counter in counters)
    ledger = app.database.scalars(select(AICallLedgerModel)).one()
    assert ledger.reserved_nano == estimate_cost_nano(configured_image_price(settings),
                                                     len(prompt.encode()) + 1024, MENU_ARTWORK_OUTPUT_TOKEN_BOUND)


@pytest.mark.asyncio
async def test_next_whole_menu_is_blocked_without_reserving_image_allowance(full_menu_app, monkeypatch):
    from app.db.models import AIUsageCounterModel, MenuCreationModel, RecipeImageGenerationModel
    app = full_menu_app
    provider, calls = await install_provider(monkeypatch, app.service)
    async with provider, client_for(app) as client:
        assert (await client.post('/menus/artwork', json=body())).status_code == 200
        blocked = await client.post('/menus/artwork', json=body(title='Another menu'))
    assert blocked.status_code == 429 and blocked.json()['detail']['code'] == 'menu_daily_limit'
    assert blocked.headers['cache-control'] == 'no-store' and int(blocked.headers['retry-after']) == 43200
    assert len(calls) == 1
    assert len(app.database.scalars(select(MenuCreationModel)).all()) == 1
    assert len(app.database.scalars(select(RecipeImageGenerationModel)).all()) == 1
    assert all(counter.request_count == 1 for counter in app.database.scalars(select(AIUsageCounterModel)))


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['rename', 'delete'])
async def test_exact_replay_survives_changed_or_deleted_library_recipe(full_menu_app, monkeypatch, change):
    from app.db.models import RecipeModel
    app = full_menu_app
    provider, calls = await install_provider(monkeypatch, app.service)
    payload = body()
    async with provider, client_for(app) as client:
        first = await client.post('/menus/artwork', json=payload)
        assert first.status_code == 200
        recipe = app.database.get(RecipeModel, 'tofu')
        if change == 'rename': recipe.title = 'New recipe title'
        else: app.database.delete(recipe)
        app.database.commit()
        app.now[0] += timedelta(days=1)
        assert (await client.post('/menus/artwork', json=payload)).json() == first.json()
        assert (await client.get('/menus/access')).json()['remaining'] == 1
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['title', 'brief', 'name', 'order', 'legacy'])
async def test_changed_whole_menu_request_cannot_reuse_paid_id(full_menu_app, monkeypatch, change):
    app = full_menu_app
    provider, calls = await install_provider(monkeypatch, app.service)
    payload = body()
    async with provider, client_for(app) as client:
        assert (await client.post('/menus/artwork', json=payload)).status_code == 200
        changed = copy.deepcopy(payload)
        if change in {'title', 'brief'}: changed[change] = 'Changed'
        elif change == 'name': changed['recipes'][0]['name'] = 'Different dish'
        elif change == 'order': changed['recipes'].reverse()
        else: changed = {'request_id': payload['request_id'], 'style_id': 'cozy-cafe'}
        result = await client.post('/menus/artwork', json=changed)
    assert result.status_code == 409 and result.json()['detail']['code'] == 'request_conflict'
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('recipes,status,code', [
    ([{'recipe_id': 'missing', 'name': 'Missing'}], 404, 'recipe_not_found'),
    ([{'recipe_id': 'foreign', 'name': 'Foreign dish'}], 404, 'recipe_not_found'),
    ([{'recipe_id': 'tofu', 'name': 'Stale title'}], 409, 'recipe_changed'),
])
async def test_missing_foreign_or_stale_recipe_never_admits(full_menu_app, monkeypatch, recipes, status, code):
    from app.db.models import RecipeModel, UserModel
    app = full_menu_app
    other = uuid4()
    app.database.add(UserModel(id=other, email='other@example.com'))
    app.database.add(RecipeModel(id='foreign', user_id=other, title='Foreign dish', ingredients='[]'))
    app.database.commit()
    provider, calls = await install_provider(monkeypatch, app.service)
    async with provider, client_for(app) as client:
        response = await client.post('/menus/artwork', json=body(recipes=recipes))
    assert response.status_code == status and response.json()['detail']['code'] == code
    assert not calls
    assert_unadmitted(app)


@pytest.mark.asyncio
@pytest.mark.parametrize('changes', [
    {'recipes': []}, {'recipes': [{'recipe_id': 'tofu', 'name': '豆腐茄子煲'}] * 2},
    {'recipes': [{'recipe_id': str(index), 'name': 'Dish'} for index in range(25)]},
    {'recipes': [{'recipe_id': '', 'name': 'Dish'}]}, {'recipes': [{'recipe_id': 'tofu', 'name': ' '}]},
    {'recipes': [{'recipe_id': 'tofu', 'name': 'a' * 1025}]},
    {'recipes': [{'recipe_id': 'tofu', 'name': 'Dish', 'url': 'https://private.invalid'}]},
    {'title': 'a' * 121}, {'title': None}, {'brief': 'a' * 1201}, {'brief': None},
    {'style_id': 'cozy-cafe'}, {'design': {}}, {'mode': 'full-menu-v2'}, {'model': 'expensive'},
])
async def test_invalid_full_menu_payload_cannot_spend_or_omit_dishes(full_menu_app, changes):
    async with client_for(full_menu_app) as client:
        result = await client.post('/menus/artwork', json=body(**changes))
    assert result.status_code == 422
    assert_unadmitted(full_menu_app)


@pytest.mark.asyncio
async def test_image_denial_rolls_back_menu_creation_and_all_counters(full_menu_app, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'AI_ACCOUNT_MONTHLY_BUDGET_USD', 0)
    provider, calls = await install_provider(monkeypatch, full_menu_app.service)
    async with provider, client_for(full_menu_app) as client:
        result = await client.post('/menus/artwork', json=body())
    assert result.status_code == 429 and result.json()['detail']['code'] == 'budget_limit'
    assert not calls
    assert_unadmitted(full_menu_app)


@pytest.mark.asyncio
async def test_admin_is_exempt_from_menu_limit_but_uses_shared_image_budget(full_menu_app, monkeypatch):
    from app.core.config import settings
    from app.db.models import AIUsageCounterModel
    app = full_menu_app
    monkeypatch.setattr(settings, 'ADMIN_USER_IDS', str(app.user_id))
    provider, calls = await install_provider(monkeypatch, app.service)
    async with provider, client_for(app) as client:
        for _ in range(2):
            assert (await client.post('/menus/artwork', json=body())).status_code == 200
    assert len(calls) == 2
    counters = app.database.scalars(select(AIUsageCounterModel)).all()
    assert len(counters) == 4 and all(row.request_count == 2 for row in counters)


@pytest.mark.asyncio
async def test_optional_title_and_brief_default_without_blocking_generation(full_menu_app, monkeypatch):
    app = full_menu_app
    provider, calls = await install_provider(monkeypatch, app.service)
    payload = body(); payload.pop('title'); payload.pop('brief')
    async with provider, client_for(app) as client:
        result = await client.post('/menus/artwork', json=payload)
    assert result.status_code == 200
    quoted = json.loads(calls[0]['prompt'].split('\nMenu data:\n', 1)[1])
    assert quoted['title'] == quoted['brief'] == ''


@pytest.mark.asyncio
async def test_all_twenty_four_selected_recipes_reach_the_provider_without_truncation(full_menu_app, monkeypatch):
    from app.db.models import RecipeModel
    app = full_menu_app
    selected = [{'recipe_id': f'dish-{index}', 'name': f'Dish {index}'} for index in range(24)]
    app.database.add_all([RecipeModel(id=recipe['recipe_id'], user_id=app.user_id,
        title=recipe['name'], ingredients='[]') for recipe in selected])
    app.database.commit()
    provider, calls = await install_provider(monkeypatch, app.service)
    async with provider, client_for(app) as client:
        result = await client.post('/menus/artwork', json=body(recipes=selected))
    assert result.status_code == 200 and result.json()['status'] == 'completed'
    quoted = json.loads(calls[0]['prompt'].split('\nMenu data:\n', 1)[1])
    assert quoted['dishes'] == [f'Dish {index}' for index in range(24)]


@pytest.mark.asyncio
async def test_failed_full_menu_attempt_replays_without_another_provider_call(full_menu_app, monkeypatch):
    app = full_menu_app
    provider, calls = await install_provider(monkeypatch, app.service, status=500,
        content={'error': {'message': 'private sk-secret', 'type': 'server_error'}})
    payload = body()
    async with provider, client_for(app) as client:
        first = await client.post('/menus/artwork', json=payload)
        assert first.status_code == 200 and first.json()['status'] == 'failed'
        assert (await client.post('/menus/artwork', json=payload)).json() == first.json()
        assert (await client.get('/menus/access')).json()['remaining'] == 0
    assert len(calls) == 1 and 'sk-secret' not in first.text


@pytest.mark.asyncio
async def test_full_menu_deadlines_extend_only_the_new_mode(full_menu_app, monkeypatch):
    from types import SimpleNamespace
    from app.db import repo_ai_cost
    import base64
    app = full_menu_app
    leases, provider_options = [], []
    async def lease(*args, **kwargs):
        leases.append(kwargs['ttl'])
    monkeypatch.setattr(repo_ai_cost, 'acquire_lease', lease)
    async def generate(**kwargs):
        provider_options.append(kwargs)
        return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode())],
                               usage={'input_tokens': 5, 'output_tokens': 5}, _request_id='fixture')
    monkeypatch.setattr(app.service, 'get_openai_client', lambda: SimpleNamespace(images=SimpleNamespace(generate=generate)))
    async with client_for(app) as client:
        assert (await client.post('/menus/artwork', json=body())).status_code == 200
        assert (await client.post('/menus/artwork', json={'request_id': str(uuid4()), 'style_id': 'cozy-cafe'})).status_code == 200
    from app.core.config import settings
    assert leases == [255, settings.OPENAI_IMAGE_TIMEOUT_SECONDS + 75]
    assert [options['timeout'] for options in provider_options] == [180, settings.OPENAI_IMAGE_TIMEOUT_SECONDS]
