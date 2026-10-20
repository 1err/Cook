"""Exercise public-catalog admission and persistence through the production queue."""
import json
import time
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import DBAPIError

from app.db import repo_recipes, repo_store_cache
from app.db.job_models import StoreJobModel, StoreJobScheduleModel
from app.db.models import RecipeModel, UserModel
from app.db.repo_store_jobs import StoreJobRepository
from app.jobs import cache_warmer_queries, worker
from test_postgres_integrations import pg_sessions


@pytest.fixture
async def catalog_jobs(pg_sessions, monkeypatch):
    monkeypatch.setattr(cache_warmer_queries, 'ALL_QUERIES', ['tofu', 'tomato paste'])
    owner = uuid4()
    public_id, private_id = str(uuid4()), str(uuid4())
    async with pg_sessions.begin() as session:
        await session.execute(delete(StoreJobModel))
        await session.execute(delete(StoreJobScheduleModel))
        previous_public = list(await session.scalars(select(RecipeModel.id).where(RecipeModel.is_public_catalog.is_(True))))
        await session.execute(update(RecipeModel).where(RecipeModel.is_public_catalog.is_(True)).values(is_public_catalog=False))
        session.add(UserModel(id=owner, email=f'{owner}@example.com'))
        await session.flush()
        session.add_all([
            RecipeModel(id=public_id, user_id=owner, title='Public test recipe', is_public_catalog=True,
                ingredients=json.dumps([{'name': name} for name in ['  Fenugreek   leaves ', ' TOFU ', '番茄', 'FENUGREEK leaves']])),
            RecipeModel(id=private_id, user_id=owner, title='Private test recipe', is_public_catalog=False,
                ingredients=json.dumps([{'name': 'private ingredient'}])),
        ])
    try:
        yield StoreJobRepository(pg_sessions), public_id
    finally:
        async with pg_sessions.begin() as session:
            await session.execute(delete(RecipeModel).where(RecipeModel.user_id == owner))
            await session.execute(delete(UserModel).where(UserModel.id == owner))
            if previous_public:
                await session.execute(update(RecipeModel).where(RecipeModel.id.in_(previous_public)).values(is_public_catalog=True))


async def make_schedule_due(repo, sessions):
    assert not await repo.schedule_warm(interval_seconds=86400)
    async with sessions.begin() as session:
        await session.execute(update(StoreJobScheduleModel).values(next_due=func.clock_timestamp()-timedelta(seconds=1)))
        return await session.scalar(select(StoreJobScheduleModel.next_due))


@pytest.mark.asyncio
@pytest.mark.parametrize('admission', ['manual', 'scheduled'])
async def test_durable_admission_snapshots_normalized_public_queries_first(catalog_jobs, pg_sessions, admission):
    """The production manual and daily paths must both include public-only names."""
    repo, _ = catalog_jobs
    if admission == 'manual':
        job, created = await repo.enqueue_warm(force_refresh=False)
    else:
        await make_schedule_due(repo, pg_sessions)
        created = await repo.schedule_warm(interval_seconds=86400)
        async with pg_sessions() as session:
            job = await session.scalar(select(StoreJobModel).where(StoreJobModel.kind == 'warm'))
    assert created
    assert job.payload == {
        'force_refresh': admission == 'scheduled',
        'queries': ['fenugreek leaves', 'tofu', '番茄', 'tomato paste'],
    }
    assert job.progress['total'] == 4
    assert job.progress['current'] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('admission', ['manual', 'scheduled'])
async def test_catalog_database_failure_keeps_daily_run_due_for_retry(catalog_jobs, pg_sessions, monkeypatch, admission):
    """A failed catalog read must not admit a common-only job or advance next_due."""
    repo, _ = catalog_jobs
    due = await make_schedule_due(repo, pg_sessions)

    async def database_failure(session):
        await session.execute(text('SELECT 1 / 0'))

    with monkeypatch.context() as failure:
        failure.setattr(repo_recipes, 'list_public_ingredient_names', database_failure)
        with pytest.raises(DBAPIError):
            if admission == 'manual':
                await repo.enqueue_warm(force_refresh=True)
            else:
                await repo.schedule_warm(interval_seconds=86400)
    async with pg_sessions() as session:
        assert await session.scalar(select(func.count()).select_from(StoreJobModel)) == 0
        assert await session.scalar(select(StoreJobScheduleModel.next_due)) == due
    assert await repo.schedule_warm(interval_seconds=86400)


@pytest.mark.asyncio
async def test_worker_persists_public_snapshot_and_next_run_reloads_catalog(catalog_jobs, pg_sessions, monkeypatch):
    """Public products must reach shared L2, including after restart and dedupe."""
    repo, recipe_id = catalog_jobs
    job, _ = await repo.enqueue_warm(force_refresh=True)
    assert job.payload['queries'] == ['fenugreek leaves', 'tofu', '番茄', 'tomato paste']
    async with pg_sessions.begin() as session:
        await session.execute(update(RecipeModel).where(RecipeModel.id == recipe_id).values(ingredients=json.dumps([{'name': 'sumac'}])))

    async def unavailable(_session):
        raise RuntimeError('Catalog temporarily unavailable')

    with monkeypatch.context() as failure:
        failure.setattr(repo_recipes, 'list_public_ingredient_names', unavailable)
        existing, created = await repo.enqueue_warm(force_refresh=False)
    assert not created and existing.id == job.id
    assert existing.payload == job.payload

    async def scrape(query, language, **kwargs):
        return [{'name': query, 'price': '$2', 'image': '', 'url': 'https://www.sayweee.com/product/catalog-test'}]

    monkeypatch.setattr(worker, 'scrape_in_subprocess', scrape)
    restarted = StoreJobRepository(pg_sessions)
    for _ in range(4):
        claim = await restarted.claim('test-restarted-worker')
        assert claim is not None
        await worker._execute(restarted, claim, time.monotonic()+120)
    status = await restarted.warmer_status()
    assert not status['running'] and status['current'] == 4
    assert status['summary']['cache_miss'] == 4
    async with pg_sessions() as session:
        for query, language in [('fenugreek leaves', 'en'), ('番茄', 'zh')]:
            cached = await repo_store_cache.get_cached_store_products(session, query=query, store='weee', language=language,
                cache_version='v7', max_age_seconds=86400)
            assert cached and cached[0]['name'] == query
    next_job, created = await restarted.enqueue_warm(force_refresh=True)
    assert created and next_job.payload['queries'] == ['sumac', 'tofu', 'tomato paste']
