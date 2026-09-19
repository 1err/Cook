"""API-side durable admission and bounded polling; never launches a browser."""
import asyncio
from datetime import datetime

from app.core.config import settings
from app.db import session as db_session
from app.db.repo_store_jobs import QueueFull, StoreJobRepository
from app.services.weee_scraper import StoreScrapeError


def enabled():
    return settings.STORE_JOBS_MODE == 'durable'


def repository():
    if db_session.async_session_maker is None:
        raise StoreScrapeError('Store queue database is not initialized')
    return StoreJobRepository(db_session.async_session_maker, queue_max=settings.STORE_JOBS_QUEUE_MAX,
        lease_seconds=settings.STORE_JOBS_LEASE_SECONDS, max_attempts=settings.STORE_JOBS_MAX_ATTEMPTS,
        retry_seconds=settings.STORE_JOBS_RETRY_SECONDS)


async def lookup(prepared, *, force_refresh=False):
    from app.services.store_product_service import CACHE_VERSION, StoreProductsResult
    repo = repository()
    try:
        job, _ = await repo.enqueue_lookup(prepared.cache_query, prepared.language, CACHE_VERSION, force_refresh=force_refresh)
        async with asyncio.timeout(settings.STORE_JOBS_WAIT_SECONDS):
            while True:
                state = await repo.get(job.id)
                if state is None or state.state == 'failed':
                    raise StoreScrapeError('Store lookup unavailable')
                if state.state == 'succeeded':
                    result = state.result
                    return StoreProductsResult(result['products'], datetime.fromisoformat(result['cached_at']) if result['cached_at'] else None)
                await asyncio.sleep(settings.STORE_JOBS_POLL_SECONDS)
    except TimeoutError as exc:
        # Shared admitted work belongs to the worker and survives this waiter.
        raise StoreScrapeError('Store lookup queued; retry shortly') from exc
    except QueueFull as exc:
        raise StoreScrapeError('Store lookup queue is full; retry shortly') from exc


async def trigger_warmer(*, force_refresh):
    repo = repository()
    _, started = await repo.enqueue_warm(force_refresh=force_refresh)
    return dict(started=started, status=await repo.warmer_status())


async def warmer_status():
    return await repository().warmer_status()
