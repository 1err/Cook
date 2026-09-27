"""Versioned composition prompts preserve durable legacy artwork retries."""
import copy

import pytest
from sqlalchemy import select

from test_menu_artwork_routes import menu_app, payload, request_data
from test_recipe_image_generation import image_app, client_for, install_provider
from test_menu_designs import DESIGN


@pytest.mark.asyncio
async def test_legacy_omitted_and_null_design_preserve_exact_original_hash(menu_app, monkeypatch):
    from app.db.models import RecipeImageGenerationModel
    provider, calls = await install_provider(monkeypatch, menu_app.service)
    body = payload()
    async with provider, client_for(menu_app) as client:
        first = await client.post('/menus/artwork', json=body)
        replay = await client.post('/menus/artwork', json={**body, 'design': None})
    assert first.status_code == 200 and replay.json() == first.json() and len(calls) == 1
    row = menu_app.database.scalars(select(RecipeImageGenerationModel)).one()
    assert row.request_hash == menu_app.repo.request_hash(request_data(body))
    assert 'central eighty percent' in calls[0]['prompt']


@pytest.mark.asyncio
@pytest.mark.parametrize('placement,phrase', [('header', 'very wide horizontal header'), ('sidebar', '180 by 916'), ('inset', '176 by 176')])
async def test_version_two_generates_visible_slot_art_and_reserves_exact_prompt(menu_app, monkeypatch, placement, phrase):
    from app.db.models import RecipeImageGenerationModel
    from app.db.ai_cost_models import AICallLedgerModel
    from app.core.ai_cost import configured_image_price, estimate_cost_nano, MENU_ARTWORK_OUTPUT_TOKEN_BOUND
    from app.core.config import settings
    from app.services.menu_artwork_service import menu_artwork_input_bound
    design = {**DESIGN, 'artwork_placement': placement}
    provider, calls = await install_provider(monkeypatch, menu_app.service)
    body = payload(design=design)
    async with provider, client_for(menu_app) as client:
        result = await client.post('/menus/artwork', json=body)
    assert result.status_code == 200 and result.json()['status'] == 'completed'
    assert phrase in calls[0]['prompt'] and 'center-cropped' in calls[0]['prompt']
    assert 'central eighty percent' not in calls[0]['prompt'] and 'Do not reserve a large blank page' in calls[0]['prompt']
    assert calls[0]['size'] == '1024x1536' and calls[0]['quality'] == 'low'
    data = {**request_data(body), 'design': design, 'prompt_version': 'menu-artwork-v2', 'layout_version': 'letter-v2'}
    row = menu_app.database.scalars(select(RecipeImageGenerationModel)).one()
    assert row.request_hash == menu_app.repo.request_hash(data)
    ledger = menu_app.database.scalars(select(AICallLedgerModel)).one()
    assert menu_artwork_input_bound(data) == len(calls[0]['prompt'].encode('utf-8')) + 1024
    assert ledger.reserved_nano == estimate_cost_nano(configured_image_price(settings), menu_artwork_input_bound(data), MENU_ARTWORK_OUTPUT_TOKEN_BOUND)


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['palette', 'placement', 'legacy'])
async def test_changed_visual_context_cannot_reuse_paid_artwork_id(menu_app, monkeypatch, change):
    from app.db.models import AIUsageCounterModel
    provider, calls = await install_provider(monkeypatch, menu_app.service)
    body = payload(design=copy.deepcopy(DESIGN))
    async with provider, client_for(menu_app) as client:
        assert (await client.post('/menus/artwork', json=body)).status_code == 200
        if change == 'palette': body['design']['palette']['accent'] = '#112233'
        elif change == 'placement': body['design']['artwork_placement'] = 'sidebar'
        else: body.pop('design')
        result = await client.post('/menus/artwork', json=body)
    assert result.status_code == 409 and result.json()['detail']['code'] == 'request_conflict'
    assert len(calls) == 1 and all(row.request_count == 1 for row in menu_app.database.scalars(select(AIUsageCounterModel)))


@pytest.mark.asyncio
async def test_malformed_design_is_rejected_before_artwork_admission(menu_app):
    from app.db.models import RecipeImageGenerationModel
    async with client_for(menu_app) as client:
        result = await client.post('/menus/artwork', json=payload(design={**DESIGN, 'font_url': 'http://private'}))
    assert result.status_code == 422
    assert not menu_app.database.scalars(select(RecipeImageGenerationModel)).all()
