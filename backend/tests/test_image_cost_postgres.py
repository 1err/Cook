"""Image admission shares the production money ledger; isolated PostgreSQL only."""
import asyncio
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import Response
from sqlalchemy import delete, select, update

from app.core.ai_cost import Price
from app.db import repo_ai_cost, repo_recipe_images
from app.db.ai_cost_models import AICallLedgerModel, AIMonthlyBudgetModel, AIInflightLeaseModel
from app.db.models import AIUsageCounterModel, RecipeImageGenerationModel
from app.db.upload_budget_models import UploadBudgetModel
from app.services.recipe_image_service import ImageGenerationError
from test_ai_cost_postgres import accounting
from test_postgres_integrations import pg_sessions, add_user, configure_image_tests


@pytest_asyncio.fixture
async def image_accounting(accounting, monkeypatch):
    configure_image_tests(monkeypatch)
    async with accounting.begin() as session:
        await session.execute(delete(AIUsageCounterModel).where(AIUsageCounterModel.scope.like('image:%')))
        await session.execute(delete(UploadBudgetModel))
        await session.execute(delete(RecipeImageGenerationModel))
    return accounting


@pytest.mark.asyncio
async def test_twelve_image_requests_cannot_cross_shared_monthly_money_cap(image_accounting):
    factory = image_accounting
    owner = await add_user(factory)
    async with factory.begin() as session:
        month = (await repo_ai_cost.db_now(session)).date().replace(day=1)
        session.add(AIMonthlyBudgetModel(scope='global', month=month,
            spent_nano=28_970_000_000, reserved_nano=0))

    async def admit():
        async with factory() as session:
            try:
                await repo_recipe_images.begin_generation(session, owner, uuid4(), {'title': 'Tofu'})
                await session.commit()
                return True
            except ImageGenerationError as exc:
                await session.rollback()
                assert exc.code == 'budget_limit'
                return False
    assert sum(await asyncio.gather(*(admit() for _ in range(12)))) == 1
    async with factory() as session:
        money = await session.get(AIMonthlyBudgetModel, ('global', month))
        assert money.spent_nano + money.reserved_nano <= 29_000_000_000
        assert len((await session.execute(select(AICallLedgerModel))).scalars().all()) == 1
        assert len((await session.execute(select(RecipeImageGenerationModel))).scalars().all()) == 1
        assert len((await session.execute(select(AIInflightLeaseModel))).scalars().all()) == 1
        assert all(row.request_count == 1 for row in (await session.execute(
            select(AIUsageCounterModel).where(AIUsageCounterModel.scope.like('image:%')))).scalars())


@pytest.mark.asyncio
async def test_same_image_request_reserves_money_once_across_workers(image_accounting):
    factory = image_accounting
    owner = await add_user(factory)
    request_id = uuid4()
    async def admit():
        async with factory.begin() as session:
            return await repo_recipe_images.begin_generation(session, owner, request_id, {'title': 'Tofu'})
    result = await asyncio.gather(*(admit() for _ in range(12)))
    assert sum(admitted for _, admitted in result) == 1
    assert len({row.ledger_call_id for row, _ in result}) == 1
    async with factory() as session:
        ledger = (await session.execute(select(AICallLedgerModel))).scalars().one()
        assert ledger.request_id == request_id
        assert ledger.operation == 'recipe_image_generation'
        budgets = (await session.execute(select(AIMonthlyBudgetModel))).scalars().all()
        assert all(row.reserved_nano == ledger.reserved_nano and row.spent_nano == 0 for row in budgets)


@pytest.mark.asyncio
async def test_dashboard_reports_known_unknown_pending_and_image_outcomes_separately(image_accounting):
    from app.api.admin_costs import ai_costs
    factory = image_accounting
    owner = await add_user(factory)
    price = Price('gpt-4o-mini', 'fixture', Decimal('.15'), Decimal('.60'))
    statuses = ['completed', 'unknown', 'reserved', 'denied']
    async with factory.begin() as session:
        for status in statuses:
            call_id = uuid4()
            await repo_ai_cost.reserve_call(session, call_id=call_id, request_id=uuid4(), account_id=str(owner),
                operation='extract', price=price, input_bound=1000, output_bound=1000,
                global_cap=29_000_000_000, account_cap=3_000_000_000)
            await session.flush()
            if status == 'completed':
                await repo_ai_cost.reconcile_call(session, call_id, input_tokens=100, output_tokens=20)
            elif status == 'unknown':
                await repo_ai_cost.reconcile_call(session, call_id)
            elif status == 'denied':
                await repo_ai_cost.reconcile_call(session, call_id, denied=True)
        image, _ = await repo_recipe_images.begin_generation(session, owner, uuid4(), {'title': 'Tofu'})
        await session.flush()
        await repo_ai_cost.reconcile_call(session, image.ledger_call_id, input_tokens=100, output_tokens=196)
        # A billed provider success may still fail later storage/user delivery.
        await repo_recipe_images.finish_generation(session, owner, image.request_id, error_code='storage_failed')
    async with factory() as session:
        response = Response()
        report = await ai_costs(response, session)
    assert response.headers['cache-control'] == 'no-store'
    assert report['totals']['calls'] == 5
    assert report['totals']['completed'] == 2
    assert report['totals']['failed'] == report['totals']['pending'] == report['totals']['unknown'] == 1
    assert report['totals']['estimated_usd'] == '0.006407'
    assert report['totals']['reserved_usd'] == '0.0015'
    assert report['totals']['unknown_reserved_usd'] == '0.00075'
    assert report['totals']['unpriced_calls'] == 2
    assert {(row['provider'], row['kind']) for row in report['groups']} == {('openai', 'text'), ('openai', 'image')}
    assert report['images']['failed'] == 1
    assert report['images']['completed'] == 0
    assert report['coverage']['first_recorded_at'] is not None
    assert report['coverage']['complete_history'] is False
