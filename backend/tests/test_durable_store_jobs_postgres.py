import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, func, update

from app.db.job_models import StoreJobModel, StoreJobScheduleModel
from app.db.repo_store_jobs import StoreJobRepository, QueueFull
from test_postgres_integrations import pg_sessions


@pytest.fixture
async def jobs(pg_sessions):
    async with pg_sessions.begin() as session:
        await session.execute(delete(StoreJobModel))
        await session.execute(delete(StoreJobScheduleModel))
    return StoreJobRepository(pg_sessions, queue_max=2, lease_seconds=180, max_attempts=2)


@pytest.mark.asyncio
async def test_concurrent_dedupe_and_bounded_admission(jobs):
    admissions = await asyncio.gather(*(jobs.enqueue_lookup('tofu', 'en', 'v7') for _ in range(12)))
    assert len({job.id for job, _ in admissions}) == 1
    assert sum(created for _, created in admissions) == 1
    await jobs.enqueue_lookup('rice', 'en', 'v7')
    with pytest.raises(QueueFull):
        await jobs.enqueue_lookup('beef', 'en', 'v7')
    # Full queues still allow joining already admitted work.
    assert (await jobs.enqueue_lookup('tofu', 'en', 'v7'))[1] is False


@pytest.mark.asyncio
async def test_only_one_claim_and_expired_owner_is_fenced(jobs, pg_sessions):
    await jobs.enqueue_lookup('tofu', 'en', 'v7')
    await jobs.enqueue_lookup('rice', 'en', 'v7')
    claims = await asyncio.gather(jobs.claim('worker-a'), jobs.claim('worker-b'))
    first = next(job for job in claims if job is not None)
    assert sum(job is not None for job in claims) == 1
    async with pg_sessions.begin() as session:
        await session.execute(update(StoreJobModel).where(StoreJobModel.id == first.id).values(lease_until=func.clock_timestamp()-timedelta(seconds=1)))
    recovered = await jobs.claim('worker-c')
    assert recovered is not None
    assert not await jobs.heartbeat(first)
    assert not await jobs.complete(first, products=[], cached_at=None)
    assert await jobs.complete(recovered, products=[], cached_at=None)


@pytest.mark.asyncio
async def test_schedule_due_once_across_workers(jobs, pg_sessions):
    assert not await jobs.schedule_warm(interval_seconds=60)
    async with pg_sessions.begin() as session:
        await session.execute(update(StoreJobScheduleModel).values(next_due=func.clock_timestamp()-timedelta(seconds=1)))
    results = await asyncio.gather(*(jobs.schedule_warm(interval_seconds=60) for _ in range(8)))
    assert sum(results) == 1
    status = await jobs.warmer_status()
    assert status['running'] and status['current'] == 0


@pytest.mark.asyncio
async def test_restart_preserves_refresh_progress(jobs, pg_sessions):
    await jobs.enqueue_warm(force_refresh=True)
    claim = await jobs.claim('worker-a')
    assert await jobs.advance_warm(claim, 'tofu', 'empty', total=2)
    fresh_repository = StoreJobRepository(pg_sessions)
    status = await fresh_repository.warmer_status()
    assert status['running'] and status['current'] == 1
    assert status['last_query'] == 'tofu'
    assert (await fresh_repository.enqueue_warm(force_refresh=True))[1] is False


@pytest.mark.asyncio
async def test_recovery_reclaims_same_job_and_enforces_retry_cap(jobs, pg_sessions):
    job, _ = await jobs.enqueue_lookup('tofu', 'en', 'v7')
    first = await jobs.claim('worker-a')
    async with pg_sessions.begin() as session:
        await session.execute(update(StoreJobModel).where(StoreJobModel.id == job.id).values(lease_until=func.clock_timestamp()-timedelta(seconds=1)))
    second = await jobs.claim('worker-b')
    assert second.id == first.id and second.fence == first.fence+1
    assert second.attempts == 2
    assert not await jobs.fail(first)
    assert await jobs.fail(second)
    assert (await jobs.get(job.id)).state == 'failed'
    assert await jobs.claim('worker-c') is None


@pytest.mark.asyncio
async def test_fenced_cache_publish_and_completion_are_atomic(jobs, pg_sessions):
    from app.db import repo_store_cache
    product = dict(name='Tofu', price='$2', image='https://example.test/tofu.jpg', url='https://www.sayweee.com/product/tofu')
    admitted, _ = await jobs.enqueue_lookup('jobs-test-tofu', 'en', 'jobs-test-v1')
    claim = await jobs.claim('worker-a')
    assert await jobs.complete(claim, products=[product], cached_at=None)
    assert not await jobs.complete(claim, products=[dict(product, price='$999')], cached_at=None)
    result = await jobs.get(admitted.id)
    assert result.state == 'succeeded' and result.result['products'] == [product]
    async with pg_sessions() as session:
        cached = await repo_store_cache.get_cached_store_products(session, query='jobs-test-tofu', store='weee', language='en', cache_version='jobs-test-v1', max_age_seconds=60)
    assert cached == [product]


@pytest.mark.asyncio
async def test_retention_preserves_latest_refresh_and_removes_old_lookup(jobs, pg_sessions):
    lookup, _ = await jobs.enqueue_lookup('tofu', 'en', 'v7')
    claim = await jobs.claim('worker-a')
    await jobs.complete(claim, products=[], cached_at=None)
    warm, _ = await jobs.enqueue_warm(force_refresh=False)
    claim = await jobs.claim('worker-a')
    await jobs.advance_warm(claim, 'tofu', 'empty', total=1)
    async with pg_sessions.begin() as session:
        await session.execute(update(StoreJobModel).values(updated_at=func.clock_timestamp()-timedelta(days=2)))
    await jobs.prune(retention_seconds=86400)
    assert await jobs.get(lookup.id) is None
    assert await jobs.get(warm.id) is not None
    assert (await jobs.warmer_status())['current'] == 1


@pytest.mark.asyncio
async def test_cached_completion_preserves_database_timestamp(jobs, pg_sessions):
    from app.db import repo_store_cache
    from app.db.models import CachedStoreProductModel
    from app.jobs import worker
    from unittest.mock import patch
    product = dict(name='Tofu', price='$2', image='https://example.test/tofu.jpg', url='https://www.sayweee.com/product/tofu')
    async with pg_sessions.begin() as session:
        await repo_store_cache.upsert_cached_store_products(session, query='cache-age-tofu', store='weee', language='en', cache_version='v7', data=[product], updated_at=datetime.now(timezone.utc))
        await session.execute(update(CachedStoreProductModel).where(CachedStoreProductModel.query == 'cache-age-tofu').values(updated_at=func.clock_timestamp()-timedelta(hours=1)))
    async with pg_sessions() as session:
        before = await repo_store_cache.get_cached_store_products_with_metadata(session, query='cache-age-tofu', store='weee', language='en', cache_version='v7', max_age_seconds=86400)
    admitted, _ = await jobs.enqueue_lookup('cache-age-tofu', 'en', 'v7')
    claim = await jobs.claim('worker-a')
    async def forbidden(*args, **kwargs):
        pytest.fail('cache hit launched scraper')
    with patch.object(worker, 'scrape_in_subprocess', forbidden):
        await worker._execute(jobs, claim, 99999999)
    async with pg_sessions() as session:
        after = await repo_store_cache.get_cached_store_products_with_metadata(session, query='cache-age-tofu', store='weee', language='en', cache_version='v7', max_age_seconds=86400)
    assert after.updated_at == before.updated_at
    assert (await jobs.get(admitted.id)).result['cached_at'] == before.updated_at.isoformat()


@pytest.mark.asyncio
async def test_unconfirmed_browser_cleanup_blocks_recovery_until_ack(jobs, pg_sessions):
    await jobs.enqueue_lookup('tofu', 'en', 'v7')
    claim = await jobs.claim('worker-a')
    assert await jobs.mark_external_started(claim)
    assert not await jobs.mark_external_started(claim)
    assert not await jobs.fail(claim)
    async with pg_sessions.begin() as session:
        await session.execute(update(StoreJobModel).where(StoreJobModel.id == claim.id).values(lease_until=func.clock_timestamp()-timedelta(seconds=1)))
    assert await jobs.claim('worker-b') is None
    assert await jobs.confirm_cleanup(claim)
    recovered = await jobs.claim('worker-b')
    assert recovered.id == claim.id and recovered.fence > claim.fence
    assert not await jobs.confirm_cleanup(claim)
