"""One metered AI design attempt, owned menu gating and validated visual output."""
import asyncio
import json
from contextlib import asynccontextmanager
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from sqlalchemy import select

from test_recipe_image_generation import image_app, client_for

DESIGN = {
    "version": 1, "layout": "photo-grid",
    "palette": {"background": "#EADCA8", "panel": "#FFFAED", "text": "#243523", "accent": "#9B382F", "muted": "#55554B"},
    "typography": {"title": "playful", "body": "sans", "align": "center"},
    "columns": 2, "density": "comfortable", "decorations": "expressive", "section_treatment": "band",
    "photo_frame": "rounded", "artwork_placement": "header", "show_descriptions": True,
    "art_direction": "Playful herb sprigs and original tomato mascots",
}


def test_description_visibility_defaults_on_and_preserves_explicit_false():
    from app.services.menu_design_service import MenuDesign
    legacy = {key: value for key, value in DESIGN.items() if key != 'show_descriptions'}
    assert MenuDesign.model_validate(legacy).show_descriptions is True
    assert MenuDesign.model_validate({**legacy, 'show_descriptions': False}).show_descriptions is False


@pytest.fixture
def design_app(image_app, monkeypatch):
    from app.api import ai_budget, routes_menu_designs
    from app.core import ai_context, llm
    from app.core.config import settings
    from app.db import repo_ai_cost
    from app.db.models import MenuCreationModel
    from app.db.session import get_session
    MenuCreationModel.__table__.create(image_app.database.bind)
    creation_id = uuid4()
    image_app.database.add(MenuCreationModel(user_id=image_app.user_id, request_id=creation_id, created_at=image_app.now[0]))
    image_app.database.commit()
    class Session:
        def add(self, row): image_app.session.add(row)
        async def execute(self, statement):
            if str(statement).startswith('SELECT clock_timestamp()'):
                return SimpleNamespace(scalar_one=lambda: image_app.now[0])
            return await image_app.session.execute(statement)
        async def commit(self): await image_app.session.commit()
        async def rollback(self): await image_app.session.rollback()
        async def close(self): await image_app.session.close()
    session = Session()
    @asynccontextmanager
    async def factory():
        yield session
    monkeypatch.setattr(ai_context, 'session_factory', lambda: factory)
    monkeypatch.setattr(ai_budget, 'acquire_lease', repo_ai_cost.acquire_lease)  # SQLite fixture; real lease races have PostgreSQL coverage.
    monkeypatch.setattr(ai_budget, 'cleanup_lease', ai_context.cleanup_lease)
    monkeypatch.setattr(llm, 'finish_provider_call', ai_context.finish_provider_call)
    for name, value in {'AI_PRICE_MODEL': 'gpt-4o-mini', 'OPENAI_MODEL': 'gpt-4o-mini',
        'AI_PRICE_VERSION': 'test-reviewed', 'AI_INPUT_USD_PER_MILLION_TOKENS': Decimal('.15'),
        'AI_OUTPUT_USD_PER_MILLION_TOKENS': Decimal('.60')}.items():
        monkeypatch.setattr(settings, name, value)
    image_app.app.include_router(routes_menu_designs.router)
    image_app.app.dependency_overrides[get_session] = lambda: session
    image_app.creation_id = creation_id
    return image_app


def body(app, **changes):
    return {'menu_creation_id': str(app.creation_id), 'brief': 'A playful illustrated noodle bar',
            'content': {'item_count': 12, 'section_count': 3, 'photo_count': 12, 'language': 'en'}, **changes}


async def provider_for(app, monkeypatch, *, content=None, hang=False):
    from app.services import menu_design_service
    calls = []
    async def respond(request):
        assert not app.database.in_transaction(), 'Provider work must not hold a transaction'
        calls.append(json.loads(request.content))
        if hang:
            await asyncio.Event().wait()
        return httpx.Response(200, json={'id': 'design-fixture', 'model': 'gpt-4o-mini',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': content if content is not None else json.dumps(DESIGN)}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 300, 'completion_tokens': 250, 'total_tokens': 550}})
    provider = AsyncOpenAI(api_key='fixture-only', max_retries=0, http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    monkeypatch.setattr(menu_design_service, 'get_openai_client', lambda: provider)
    return provider, calls


@pytest.mark.asyncio
async def test_one_design_call_is_bounded_metered_and_does_not_create_another_menu(design_app, monkeypatch):
    from app.db.ai_cost_models import AICallLedgerModel, AIMonthlyBudgetModel
    from app.db.models import MenuCreationModel, AIUsageCounterModel
    from app.core.ai_cost import prompt_token_ceiling, configured_price, estimate_cost_nano
    from app.core.config import settings
    provider, calls = await provider_for(design_app, monkeypatch)
    async with provider, client_for(design_app) as client:
        response = await client.post('/menus/designs', json=body(design_app))
    assert response.status_code == 200 and response.json() == DESIGN
    assert response.headers['cache-control'] == 'no-store'
    assert len(calls) == 1 and calls[0]['response_format'] == {'type': 'json_object'}
    assert len(design_app.database.scalars(select(MenuCreationModel)).all()) == 1
    ledger = design_app.database.scalars(select(AICallLedgerModel)).one()
    assert ledger.operation == 'menu_design' and ledger.status == 'completed'
    assert ledger.reserved_nano == estimate_cost_nano(configured_price(settings), prompt_token_ceiling(calls[0]['messages']), settings.OPENAI_MAX_OUTPUT_TOKENS)
    assert ledger.input_tokens == 300 and ledger.output_tokens == 250
    assert all(row.reserved_nano == 0 for row in design_app.database.scalars(select(AIMonthlyBudgetModel)))
    counters = design_app.database.scalars(select(AIUsageCounterModel)).all()
    assert len(counters) == 4 and not any(row.scope.startswith('menu:') for row in counters)


@pytest.mark.asyncio
async def test_foreign_or_missing_menu_and_unauthenticated_call_never_spend(design_app, monkeypatch):
    from app.api.auth import get_current_user
    from app.db.models import MenuCreationModel, AIUsageCounterModel
    foreign = uuid4()
    design_app.database.add(MenuCreationModel(user_id=uuid4(), request_id=foreign, created_at=design_app.now[0]))
    design_app.database.commit()
    provider, calls = await provider_for(design_app, monkeypatch)
    async with provider, client_for(design_app) as client:
        for request_id in (uuid4(), foreign):
            response = await client.post('/menus/designs', json=body(design_app, menu_creation_id=str(request_id)))
            assert response.status_code == 404
        design_app.app.dependency_overrides.pop(get_current_user)
        assert (await client.post('/menus/designs', json=body(design_app))).status_code == 401
    assert not calls and not design_app.database.scalars(select(AIUsageCounterModel)).all()


@pytest.mark.asyncio
@pytest.mark.parametrize('output', ['not JSON', json.dumps({**DESIGN, 'html': '<script />'}), json.dumps({**DESIGN, 'columns': 99}),
    json.dumps({**DESIGN, 'palette': {**DESIGN['palette'], 'accent': 'url(http://private)'}}), json.dumps({**DESIGN, 'art_direction': 'a' * 601}),
    json.dumps({**DESIGN, 'show_descriptions': 'false'})])
async def test_invalid_model_output_is_not_applied_or_automatically_repaired(design_app, monkeypatch, output):
    from app.db.ai_cost_models import AICallLedgerModel
    provider, calls = await provider_for(design_app, monkeypatch, content=output)
    async with provider, client_for(design_app) as client:
        response = await client.post('/menus/designs', json=body(design_app))
    assert response.status_code == 503 and response.json()['detail']['code'] == 'invalid_design'
    assert len(calls) == 1
    assert design_app.database.scalars(select(AICallLedgerModel)).one().status == 'completed'


@pytest.mark.asyncio
async def test_preferences_and_readable_type_override_model_oversights(design_app, monkeypatch):
    output = {**DESIGN, 'palette': {**DESIGN['palette'], 'text': '#FFFAED', 'muted': '#FFFAED'}}
    provider, calls = await provider_for(design_app, monkeypatch, content=json.dumps(output))
    async with provider, client_for(design_app) as client:
        response = await client.post('/menus/designs', json=body(design_app, preferences={'layout': 'category-board', 'density': 'compact'}))
    assert response.status_code == 200
    assert response.json()['layout'] == 'category-board' and response.json()['density'] == 'compact'
    from app.services.menu_design_service import _contrast
    palette = response.json()['palette']
    assert _contrast(palette['text'], palette['panel']) >= 4.5
    assert _contrast(palette['muted'], palette['panel']) >= 4.5


@pytest.mark.asyncio
@pytest.mark.parametrize('changes', [{'brief': 'x' * 1201}, {'brief': ''}, {'recipe_names': ['private']}, {'preferences': {'model': 'expensive'}}, {'content': {'item_count': True, 'section_count': 1, 'photo_count': 0, 'language': 'en'}}])
async def test_invalid_request_never_uses_ai_allowance(design_app, monkeypatch, changes):
    from app.db.models import AIUsageCounterModel
    provider, calls = await provider_for(design_app, monkeypatch)
    async with provider, client_for(design_app) as client:
        response = await client.post('/menus/designs', json=body(design_app, **changes))
    assert response.status_code == 422 and not calls
    assert not design_app.database.scalars(select(AIUsageCounterModel)).all()


@pytest.mark.asyncio
async def test_whole_operation_timeout_retains_unknown_spend_and_cleans_context(design_app, monkeypatch):
    from app.core.config import settings
    from app.core.ai_context import current_ai_request
    from app.db.ai_cost_models import AICallLedgerModel
    monkeypatch.setattr(settings, 'AI_OPERATION_TIMEOUT_SECONDS', .05)
    provider, calls = await provider_for(design_app, monkeypatch, hang=True)
    async with provider, client_for(design_app) as client:
        response = await client.post('/menus/designs', json=body(design_app))
    assert response.status_code == 503 and len(calls) == 1
    assert current_ai_request.get() is None
    assert design_app.database.scalars(select(AICallLedgerModel)).one().status == 'unknown'


@pytest.mark.asyncio
async def test_missing_text_provider_never_consumes_design_quota(design_app, monkeypatch):
    from app.core.config import settings
    from app.db.models import AIUsageCounterModel
    monkeypatch.setattr(settings, 'OPENAI_API_KEY', '')
    async with client_for(design_app) as client:
        response = await client.post('/menus/designs', json=body(design_app))
    assert response.status_code == 503 and response.json()['detail']['code'] == 'design_unavailable'
    assert not design_app.database.scalars(select(AIUsageCounterModel)).all()


@pytest.mark.asyncio
async def test_whitespace_brief_is_rejected_without_spending(design_app):
    from app.db.models import AIUsageCounterModel
    async with client_for(design_app) as client:
        response = await client.post('/menus/designs', json=body(design_app, brief='   \n  '))
    assert response.status_code == 422
    assert not design_app.database.scalars(select(AIUsageCounterModel)).all()


def test_contrast_repair_is_readable_even_for_mid_gray_panels():
    from app.services.menu_design_service import MenuDesign, readable_design, _contrast
    design = MenuDesign.model_validate({**DESIGN, 'palette': {**DESIGN['palette'], 'panel': '#777777', 'text': '#777777', 'muted': '#777777'}})
    palette = readable_design(design).palette
    assert _contrast(palette.text, palette.panel) >= 4.5
    assert _contrast(palette.muted, palette.panel) >= 4.5


def test_illustrated_design_normalizes_ink_for_background_without_recoloring_surfaces():
    from app.services.menu_design_service import MenuDesign, readable_design, _contrast
    palette = {'background': '#000000', 'panel': '#FFFFFF', 'text': '#000000', 'muted': '#000000', 'accent': '#F0BC55'}
    result = readable_design(MenuDesign.model_validate({**DESIGN, 'layout': 'illustrated-list', 'palette': palette})).palette
    assert _contrast(result.text, result.background) >= 4.5
    assert _contrast(result.muted, result.background) >= 4.5
    assert result.background == palette['background']
    assert result.panel == palette['panel']
    assert result.accent == palette['accent']


def test_readable_colored_text_is_not_replaced_with_black_or_white():
    from app.services.menu_design_service import MenuDesign, readable_design
    palette = {'background': '#D2E5D7', 'panel': '#FFF3CF', 'text': '#49304B', 'muted': '#46583F', 'accent': '#BA514B'}
    result = readable_design(MenuDesign.model_validate({**DESIGN, 'layout': 'photo-grid', 'palette': palette})).palette
    assert result.model_dump() == palette
