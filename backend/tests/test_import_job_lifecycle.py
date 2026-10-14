"""Run queue, admission, worker, and API against an isolated disposable schema."""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.schema import CreateSchema, DropSchema

from app.api import ai_budget, routes_imports
from app.api.auth import get_current_user
from app.core.ai_context import current_ai_request
from app.db import repo_ai_cost, repo_import_jobs as jobs
from app.db.ai_cost_models import AICallLedgerModel, AIInflightLeaseModel, AIMonthlyBudgetModel
from app.db.import_job_models import ImportJobModel as Job
from app.db.models import UserModel, AIUsageCounterModel
from app.db.account_models import DeletedAccountModel
from app.db.repo_ai_usage import AIUsageLimitExceeded
from app.db.session import get_session
from app.jobs import recipe_imports as worker
from app.models import Recipe


@pytest_asyncio.fixture
async def lifecycle(monkeypatch):
    url = os.environ.get('TEST_DATABASE_URL')
    if not url:
        pytest.skip('Disposable PostgreSQL required')
    parsed = make_url(url)
    assert parsed.drivername == 'postgresql+asyncpg'
    assert parsed.host in {'localhost', '127.0.0.1'} and parsed.database == 'cooking_audit_test'
    schema = f'import_lifecycle_{uuid4().hex}'
    engine = create_async_engine(url, execution_options={'schema_translate_map': {None: schema}})
    try:
        async with engine.begin() as connection:
            await connection.execute(CreateSchema(schema))
            for model in [UserModel, DeletedAccountModel, AIUsageCounterModel, AIInflightLeaseModel, AIMonthlyBudgetModel, AICallLedgerModel, Job]:
                await connection.run_sync(model.__table__.create)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        monkeypatch.setattr(worker.database, 'async_session_maker', maker)
        monkeypatch.setattr(ai_budget, 'is_llm_enabled', lambda: True)
        monkeypatch.setattr(ai_budget.settings, 'AI_GLOBAL_MAX_INFLIGHT', 1)
        monkeypatch.setattr(ai_budget.settings, 'AI_USER_MAX_INFLIGHT', 1)
        monkeypatch.setattr(routes_imports.settings, 'ABUSE_LIMITS_ENABLED', False)
        async with maker.begin() as session:
            owner = UserModel(id=uuid4(), email=f'{uuid4()}@example.com')
            session.add(owner)
        app = FastAPI()
        app.include_router(routes_imports.router)
        app.dependency_overrides[get_current_user] = lambda: owner
        async def session_dependency():
            async with maker() as session:
                yield session
        app.dependency_overrides[get_session] = session_dependency
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            yield maker, owner, client
    finally:
        async with engine.begin() as connection:
            await connection.execute(DropSchema(schema, cascade=True, if_exists=True))
        await engine.dispose()


async def new_claim(maker, owner, *, media=False):
    async with maker.begin() as session:
        created = await jobs.create_job(session, owner,
            {'mode': 'media' if media else 'text', 'transcript': 'Slice tofu.',
             'url': 'https://www.youtube.com/watch?v=A6bByqI_TH8'},
            media_data=b'private-media' if media else None, media_type='video/mp4' if media else None)
    async with maker.begin() as session:
        claimed = await jobs.claim_job(session, lease_seconds=100)
        assert claimed.id == created.id
    return claimed


async def occupy_slot(maker):
    lease_id = uuid4()
    async with maker.begin() as session:
        await repo_ai_cost.acquire_lease(session, 'other-account', lease_id,
            global_limit=1, account_limit=1, ttl=100)
    return lease_id


@pytest.mark.asyncio
async def test_concurrency_requeues_without_spending_allowance_then_completes(lifecycle, monkeypatch):
    maker, owner, client = lifecycle
    claimed = await new_claim(maker, owner, media=True)
    original_expiry = claimed.expires_at
    lease_id = await occupy_slot(maker)
    perform = AsyncMock(return_value=Recipe(id='draft', title='Tofu', ingredients=[], steps=['Slice tofu.']))
    monkeypatch.setattr(worker, 'perform_import', perform)

    await worker.process_job(claimed)

    async with maker() as session:
        queued = await jobs.get_job(session, claimed.id, owner.id)
        assert queued.status == 'queued'
        assert queued.payload == claimed.payload and queued.media_data == b'private-media'
        assert queued.media_type == 'video/mp4' and queued.expires_at == original_expiry
        assert queued.lease_until > datetime.now(timezone.utc)
        assert await session.scalar(select(func.count()).select_from(AIUsageCounterModel)) == 0
        assert await session.scalar(select(func.count()).select_from(AIInflightLeaseModel)) == 1
    perform.assert_not_awaited()
    assert (await client.get(f'/recipes/import-jobs/{claimed.id}')).json()['status'] == 'queued'
    async with maker.begin() as session:
        assert await jobs.claim_job(session, lease_seconds=100) is None
        await session.execute(update(Job).where(Job.id == claimed.id).values(lease_until=func.now()-timedelta(seconds=1)))
    async with maker.begin() as session:
        retried = await jobs.claim_job(session, lease_seconds=100)
    await worker.process_job(retried)
    async with maker() as session:
        assert await session.scalar(select(func.count()).select_from(AIUsageCounterModel)) == 0
    async with maker.begin() as session:
        await repo_ai_cost.release_lease(session, lease_id)
        await session.execute(update(Job).where(Job.id == claimed.id).values(lease_until=func.now()-timedelta(seconds=1)))
    async with maker.begin() as session:
        ready = await jobs.claim_job(session, lease_seconds=100)
    await worker.process_job(ready)
    final = (await client.get(f'/recipes/import-jobs/{claimed.id}')).json()
    assert final['status'] == 'completed' and final['recipe']['title'] == 'Tofu'
    assert perform.await_count == 1
    async with maker() as session:
        finished = await jobs.get_job(session, claimed.id, owner.id)
        assert finished.payload == {} and finished.media_data is None
        counts = (await session.scalars(select(AIUsageCounterModel.request_count))).all()
        assert counts == [1, 1, 1, 1]
        assert await session.scalar(select(func.count()).select_from(AIInflightLeaseModel)) == 0


@pytest.mark.asyncio
async def test_cancel_deferred_job_clears_payload_and_cannot_be_requeued(lifecycle):
    maker, owner, client = lifecycle
    claimed = await new_claim(maker, owner, media=True)
    await occupy_slot(maker)
    await worker.process_job(claimed)
    cancelled = await client.delete(f'/recipes/import-jobs/{claimed.id}')
    assert cancelled.status_code == 200 and cancelled.json()['status'] == 'cancelled'
    async with maker.begin() as session:
        await jobs.requeue_job(session, claimed, retry_seconds=1)
        assert await jobs.claim_job(session, lease_seconds=100) is None
    async with maker() as session:
        row = await jobs.get_job(session, claimed.id, owner.id)
        assert row.status == 'cancelled' and row.payload == {} and row.media_data is None


@pytest.mark.asyncio
async def test_request_quota_denial_is_terminal_and_never_calls_provider(lifecycle, monkeypatch):
    maker, owner, client = lifecycle
    claimed = await new_claim(maker, owner)
    monkeypatch.setattr(ai_budget, 'reserve_ai_budget', AsyncMock(side_effect=AIUsageLimitExceeded(60)))
    perform = AsyncMock()
    monkeypatch.setattr(worker, 'perform_import', perform)
    await worker.process_job(claimed)
    assert (await client.get(f'/recipes/import-jobs/{claimed.id}')).json()['status'] == 'failed'
    perform.assert_not_awaited()


@pytest.mark.asyncio
async def test_provider_rate_error_is_terminal_after_admission(lifecycle, monkeypatch):
    maker, owner, client = lifecycle
    claimed = await new_claim(maker, owner)
    async def provider(*args):
        assert current_ai_request.get() is not None
        raise HTTPException(429, 'Provider rate limit', headers={'Retry-After': '5'})
    monkeypatch.setattr(worker, 'perform_import', provider)
    await worker.process_job(claimed)
    final = (await client.get(f'/recipes/import-jobs/{claimed.id}')).json()
    assert final['status'] == 'failed' and final['error']['message'] == 'Provider rate limit'
    async with maker.begin() as session:
        assert await jobs.claim_job(session, lease_seconds=100) is None


@pytest.mark.asyncio
async def test_similarly_typed_error_after_admission_never_retries(lifecycle, monkeypatch):
    maker, owner, client = lifecycle
    claimed = await new_claim(maker, owner)
    monkeypatch.setattr(worker, 'perform_import', AsyncMock(side_effect=ai_budget.AIConcurrencyUnavailable(5)))
    await worker.process_job(claimed)
    assert (await client.get(f'/recipes/import-jobs/{claimed.id}')).json()['status'] == 'failed'
    async with maker.begin() as session:
        assert await jobs.claim_job(session, lease_seconds=100) is None


@pytest.mark.asyncio
async def test_actual_monetary_exhaustion_is_terminal_without_provider_request(lifecycle, monkeypatch):
    from app.core import llm
    maker, owner, client = lifecycle
    claimed = await new_claim(maker, owner)
    for key, value in {'AI_MONTHLY_BUDGET_USD': Decimal('0'), 'AI_ACCOUNT_MONTHLY_BUDGET_USD': Decimal('0'),
                       'OPENAI_MODEL': 'gpt-4o-mini', 'AI_PRICE_MODEL': 'gpt-4o-mini', 'AI_PRICE_VERSION': 'test',
                       'AI_INPUT_USD_PER_MILLION_TOKENS': Decimal('.15'),
                       'AI_OUTPUT_USD_PER_MILLION_TOKENS': Decimal('.60')}.items():
        monkeypatch.setattr(llm.settings, key, value)
    create = AsyncMock()
    provider = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    async def analysis(*args):
        await llm.complete_chat(provider, messages=[{'role': 'user', 'content': 'Slice tofu.'}], operation='extract')
    monkeypatch.setattr(worker, 'perform_import', analysis)
    await worker.process_job(claimed)
    final = (await client.get(f'/recipes/import-jobs/{claimed.id}')).json()
    assert final['status'] == 'failed' and final['error']['code'] == 'analysis_unavailable'
    create.assert_not_awaited()
    async with maker.begin() as session:
        assert await jobs.claim_job(session, lease_seconds=100) is None
        assert await session.scalar(select(func.count()).select_from(AICallLedgerModel)) == 0


@pytest.mark.asyncio
async def test_api_job_cancellation_stops_running_analysis_without_late_result(lifecycle, monkeypatch):
    maker, owner, client = lifecycle
    response = await client.post('/recipes/import-jobs', json={'mode': 'text', 'transcript': 'Slice tofu.'})
    assert response.status_code == 202
    job_id = response.json()['id']
    entered, stopped = asyncio.Event(), asyncio.Event()
    async def analysis(*args):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()
    monkeypatch.setattr(worker, 'perform_import', analysis)
    async with maker.begin() as session:
        claimed = await jobs.claim_job(session, lease_seconds=100)
    processing = asyncio.create_task(worker.process_job(claimed))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        response = await client.delete(f'/recipes/import-jobs/{job_id}')
        assert response.status_code == 200
        await asyncio.wait_for(processing, 2)
        assert stopped.is_set()
        assert (await client.get(f'/recipes/import-jobs/{job_id}')).json()['status'] == 'cancelled'
        async with maker() as session:
            assert await session.scalar(select(func.count()).select_from(AIInflightLeaseModel)) == 0
    finally:
        processing.cancel()
        await asyncio.gather(processing, return_exceptions=True)


@pytest.mark.asyncio
async def test_deferred_job_keeps_original_expiration(lifecycle):
    maker, owner, client = lifecycle
    claimed = await new_claim(maker, owner, media=True)
    await occupy_slot(maker)
    await worker.process_job(claimed)
    async with maker.begin() as session:
        await session.execute(update(Job).where(Job.id == claimed.id).values(expires_at=func.now()-timedelta(seconds=1)))
        await jobs.maintain_jobs(session)
        assert await jobs.claim_job(session, lease_seconds=100) is None
    assert (await client.get(f'/recipes/import-jobs/{claimed.id}')).status_code == 404


@pytest.mark.asyncio
async def test_rednote_queue_keeps_retrieval_token_then_clears_it_after_completion(lifecycle, monkeypatch):
    from app.api import routes_recipes
    from app.video_import import VideoTextResult, parse_video_source

    maker, owner, client = lifecycle
    canonical = 'https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9'
    original = canonical + '?xsec_token=private-share-token'
    source = parse_video_source(original)
    fetch = AsyncMock(return_value=VideoTextResult('ok', '鸡蛋2个，蒸10分钟。', source,
                                                  source_kind='description'))
    monkeypatch.setattr(routes_recipes, 'fetch_video_text', fetch)
    monkeypatch.setattr(routes_recipes, 'extract_recipe_from_text', AsyncMock(return_value=Recipe(
        id='draft', title='蒸蛋', ingredients=[{'name': '鸡蛋', 'quantity': '2个'}], steps=['蒸10分钟。'])))
    response = await client.post('/recipes/import-jobs', json={'url': '蒸蛋教程 ' + original})
    assert response.status_code == 202
    async with maker.begin() as session:
        claimed = await jobs.claim_job(session, lease_seconds=100)
        assert claimed.payload['url'] == original
        job_id = claimed.id
    await worker.process_job(claimed)
    result = (await client.get(f'/recipes/import-jobs/{job_id}')).json()
    assert result['status'] == 'completed'
    assert result['recipe']['source_url'] == canonical
    assert 'private-share-token' not in str(result)
    assert fetch.await_args.args[0].original_url == original
    async with maker() as session:
        completed = await jobs.get_job(session, job_id, owner.id)
        assert completed.payload == {} and completed.media_data is None
