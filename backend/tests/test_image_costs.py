from datetime import timedelta
from decimal import Decimal
import importlib.util
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI

from test_recipe_image_generation import image_app, client_for, install_provider, payload


@pytest.mark.asyncio
async def test_admin_sees_one_hundred_daily_images_and_regular_account_three(image_app, monkeypatch):
    from app.core.config import settings
    async with client_for(image_app) as client:
        regular = (await client.get('/recipes/image-generation/access')).json()
        monkeypatch.setattr(settings, 'ADMIN_USER_IDS', str(image_app.user_id))
        admin = (await client.get('/recipes/image-generation/access')).json()
    assert regular['daily_limit'] == regular['remaining'] == 3
    assert admin['daily_limit'] == admin['remaining'] == 100


def test_cost_totals_do_not_report_unknown_reservations_as_zero_spend():
    assert importlib.util.find_spec('app.api.admin_costs') is not None, 'Cost reporting is missing'
    from app.api.admin_costs import summarize_calls
    rows = [
        SimpleNamespace(status='completed', actual_nano=7_000_000, reserved_nano=50_000_000,
                        input_tokens=100, output_tokens=200),
        SimpleNamespace(status='unknown', actual_nano=None, reserved_nano=40_000_000,
                        input_tokens=None, output_tokens=None),
        SimpleNamespace(status='reserved', actual_nano=None, reserved_nano=30_000_000,
                        input_tokens=None, output_tokens=None),
        SimpleNamespace(status='denied', actual_nano=0, reserved_nano=10_000_000,
                        input_tokens=None, output_tokens=None),
    ]
    result = summarize_calls(rows)
    assert result == {'calls': 4, 'completed': 1, 'failed': 1, 'pending': 1, 'unknown': 1,
        'input_tokens': 100, 'output_tokens': 200, 'estimated_usd': '0.007',
        'reserved_usd': '0.07', 'unknown_reserved_usd': '0.04', 'unpriced_calls': 2}


@pytest.mark.asyncio
async def test_cost_dashboard_denies_non_admin_and_unauthenticated(monkeypatch):
    assert importlib.util.find_spec('app.api.admin_costs') is not None, 'Cost reporting is missing'
    from app.api.admin_costs import router
    from app.api.auth import get_current_user
    from app.core.config import settings
    from app.db.session import get_session
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_session] = lambda: SimpleNamespace()
    monkeypatch.setattr(settings, 'ADMIN_USER_IDS', '')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://api') as client:
        assert (await client.get('/admin/ai-costs')).status_code == 401
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=uuid4())
        assert (await client.get('/admin/ai-costs')).status_code == 403


def test_reviewed_image_price_rejects_other_models_and_includes_output_at_standard_rate():
    from app.core import ai_cost
    assert hasattr(ai_cost, 'configured_image_price'), 'Image pricing is missing'
    price = ai_cost.configured_image_price(SimpleNamespace(OPENAI_IMAGE_MODEL='gpt-image-2'))
    assert ai_cost.estimate_cost_nano(price, 100, 196) == 6_380_000
    with pytest.raises(ValueError):
        ai_cost.configured_image_price(SimpleNamespace(OPENAI_IMAGE_MODEL='gpt-image-unknown'))


@pytest.mark.asyncio
async def test_successful_image_records_reported_usage_at_reviewed_prices(image_app, monkeypatch):
    from sqlalchemy import select
    from app.db.ai_cost_models import AICallLedgerModel, AIMonthlyBudgetModel
    provider, calls = await install_provider(monkeypatch, image_app.service)
    async with provider, client_for(image_app) as client:
        result = await client.post('/recipes/generate-image', json=payload())
    assert result.json()['status'] == 'completed'
    ledger = image_app.database.scalars(select(AICallLedgerModel)).one()
    assert ledger.status == 'completed'
    assert ledger.operation == 'recipe_image_generation'
    assert (ledger.input_tokens, ledger.output_tokens, ledger.actual_nano) == (100, 196, 6_380_000)
    budgets = image_app.database.scalars(select(AIMonthlyBudgetModel)).all()
    assert len(budgets) == 2
    assert all(row.spent_nano == 6_380_000 and row.reserved_nano == 0 for row in budgets)


@pytest.mark.asyncio
@pytest.mark.parametrize('status,ledger_status,retained', [(429, 'denied', False), (500, 'unknown', True)])
async def test_provider_failure_refunds_only_definitive_denial(image_app, monkeypatch, status, ledger_status, retained):
    from sqlalchemy import select
    from app.db.ai_cost_models import AICallLedgerModel, AIMonthlyBudgetModel
    provider, calls = await install_provider(monkeypatch, image_app.service, status=status,
        content={'error': {'message': 'provider unavailable', 'type': 'server_error'}})
    async with provider, client_for(image_app) as client:
        result = await client.post('/recipes/generate-image', json=payload())
    assert result.json()['status'] == 'failed'
    ledger = image_app.database.scalars(select(AICallLedgerModel)).one()
    assert ledger.status == ledger_status
    budgets = image_app.database.scalars(select(AIMonthlyBudgetModel)).all()
    assert all((row.reserved_nano > 0) == retained and row.spent_nano == 0 for row in budgets)


@pytest.mark.asyncio
async def test_admin_can_use_shared_account_allocation_but_not_cross_global_cap(image_app, monkeypatch):
    from sqlalchemy import select, update
    from app.core.config import settings
    from app.db.ai_cost_models import AIMonthlyBudgetModel
    from app.db.models import RecipeImageGenerationModel
    month = image_app.now[0].date().replace(day=1)
    image_app.database.add(AIMonthlyBudgetModel(scope=f'user:{image_app.user_id}', month=month,
        reserved_nano=0, spent_nano=2_999_999_999))
    image_app.database.commit()
    provider, calls = await install_provider(monkeypatch, image_app.service)
    async with provider, client_for(image_app) as client:
        regular = await client.post('/recipes/generate-image', json=payload())
        assert regular.status_code == 429
        assert regular.json()['detail']['code'] == 'budget_limit'
        assert not image_app.database.scalars(select(RecipeImageGenerationModel)).all()
        image_app.database.close()
        monkeypatch.setattr(settings, 'ADMIN_USER_IDS', str(image_app.user_id))
        admin = await client.post('/recipes/generate-image', json=payload())
        assert admin.json()['status'] == 'completed'
        image_app.now[0] += timedelta(minutes=1)
        image_app.database.execute(update(AIMonthlyBudgetModel).where(AIMonthlyBudgetModel.scope == 'global').values(
            spent_nano=28_999_999_999))
        image_app.database.commit()
        capped = await client.post('/recipes/generate-image', json=payload())
    assert capped.status_code == 429
    assert capped.json()['detail']['code'] == 'budget_limit'
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_admin_hundredth_image_is_admitted_and_hundred_first_is_denied(image_app, monkeypatch):
    from datetime import timedelta
    from app.core.config import settings
    from app.db.models import AIUsageCounterModel
    monkeypatch.setattr(settings, 'ADMIN_USER_IDS', str(image_app.user_id))
    timestamp = int(image_app.now[0].timestamp())
    image_app.database.add(AIUsageCounterModel(scope=f'image:user:{image_app.user_id}', window_seconds=86400,
        window_start=timestamp-timestamp % 86400, request_count=99))
    image_app.database.commit()
    provider, calls = await install_provider(monkeypatch, image_app.service)
    async with provider, client_for(image_app) as client:
        assert (await client.post('/recipes/generate-image', json=payload())).json()['status'] == 'completed'
        image_app.now[0] += timedelta(minutes=1)
        limited = await client.post('/recipes/generate-image', json=payload())
    assert limited.status_code == 429
    assert limited.json()['detail']['code'] == 'daily_limit'
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_full_storage_is_rejected_before_provider_or_money_admission(image_app, monkeypatch):
    from sqlalchemy import select
    from app.core.config import settings
    from app.db.ai_cost_models import AICallLedgerModel
    from app.db.upload_budget_models import UploadBudgetModel
    image_app.database.add(UploadBudgetModel(scope=f'user:{image_app.user_id}',
        object_count=settings.UPLOAD_ACCOUNT_TOTAL_COUNT, byte_count=1))
    image_app.database.commit()
    provider, calls = await install_provider(monkeypatch, image_app.service)
    async with provider, client_for(image_app) as client:
        response = await client.post('/recipes/generate-image', json=payload())
    assert response.status_code == 429
    assert response.json()['detail']['code'] == 'storage_limit'
    assert not calls
    assert not image_app.database.scalars(select(AICallLedgerModel)).all()


@pytest.mark.asyncio
async def test_expired_admission_cannot_start_a_provider_call(image_app, monkeypatch):
    import time
    from app.core.config import settings
    original = image_app.repo.begin_generation
    async def delayed_admission(*args, **kwargs):
        result = await original(*args, **kwargs)
        # Models a dependency that blocks or swallows cancellation before commit.
        time.sleep(0.03)
        return result
    monkeypatch.setattr(image_app.repo, 'begin_generation', delayed_admission)
    monkeypatch.setattr(settings, 'AI_OPERATION_TIMEOUT_SECONDS', 0.01)
    provider, calls = await install_provider(monkeypatch, image_app.service)
    async with provider, client_for(image_app) as client:
        response = await client.post('/recipes/generate-image', json=payload())
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'generation_timeout'
    assert not calls
