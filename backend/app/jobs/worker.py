"""Run with python -m app.jobs.worker; API processes only admit/poll jobs."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
import time
from uuid import uuid4

from app.core.config import settings
from app.db import repo_store_cache, session as db_session
from app.db.repo_store_jobs import QueueFull
from app.jobs.durable_store import repository
from app.services.store_product_service import CACHE_TTL_SECONDS, CACHE_VERSION, prepare_store_query
from app.services.weee_scraper import StoreScrapeError, validate_products

logger = logging.getLogger(__name__)


class CleanupFailed(BaseException):
    """Fail-stop: do not release an external-work lease without cleanup proof."""


async def _kill_and_reap(process):
    # Chromium launches detached sessions. Only the Linux subreaper supervisor
    # can prove the entire descendant tree is gone; never SIGKILL it first.
    if process.returncode is None:
        try:
            os.kill(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        async with asyncio.timeout(15):
            # Cancellation can leave stdout buffered and pause its transport.
            # communicate() drains the pipe while reaping; wait() alone can hang.
            await process.communicate()
    except TimeoutError as exc:
        raise CleanupFailed("Scraper supervisor did not confirm cleanup") from exc
    if process.returncode not in (0, 124, 125):
        raise CleanupFailed("Scraper supervisor exited without cleanup proof")


async def scrape_in_subprocess(query, language, *, timeout, deadline=None, claim=None):
    deadline = min(time.monotonic()+timeout, deadline if deadline is not None else float('inf'))
    if deadline <= time.monotonic():
        raise StoreScrapeError('Store lookup timed out before launch')
    spawning = asyncio.create_task(asyncio.create_subprocess_exec(
        sys.executable, '-m', 'app.jobs.scrape_runner', str(os.getpid()), str(deadline),
        json.dumps(dict(id=str(claim.id), owner=claim.owner, fence=claim.fence)) if claim is not None else '{}',
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True,
    ))
    cancelled_during_spawn = False
    while not spawning.done():
        try:
            await asyncio.shield(spawning)
        except asyncio.CancelledError:
            cancelled_during_spawn = True
    process = spawning.result()
    try:
        if cancelled_during_spawn:
            raise asyncio.CancelledError
        async with asyncio.timeout(max(0, deadline-time.monotonic())):
            stdout, _ = await process.communicate(json.dumps(dict(query=query, language=language)).encode())
        if process.returncode != 0 or len(stdout) > 65536:
            raise StoreScrapeError('Isolated store lookup failed')
        return validate_products(json.loads(stdout))
    except TimeoutError as exc:
        raise StoreScrapeError('Store lookup timed out') from exc
    finally:
        cleanup = asyncio.create_task(_kill_and_reap(process))
        cancelled = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
        try:
            cleanup.result()
        except BaseException as exc:
            raise CleanupFailed("Could not confirm scraper process cleanup") from exc
        if cancelled:
            raise asyncio.CancelledError


async def _execute(repo, claim, deadline):
    if claim.kind == 'warm':
        queries = claim.payload['queries']
        index = claim.progress['current']
        if index >= len(queries):
            # A release may shrink the list; finish safely without indexing past it.
            await repo.advance_warm(claim, '', 'skipped', total=index)
            return
        query = queries[index]
        prepared = prepare_store_query(query)
        if prepared is None:
            await repo.advance_warm(claim, query, 'skipped', total=len(queries))
            return
        if not claim.payload['force_refresh']:
            async with repo.sessions() as session:
                cached = await repo_store_cache.get_cached_store_products(session, query=prepared.cache_query,
                    store='weee', language=prepared.language, cache_version=CACHE_VERSION, max_age_seconds=CACHE_TTL_SECONDS)
            if cached is not None:
                await repo.advance_warm(claim, query, 'cache_hit', total=len(queries))
                return
        try:
            products = await scrape_in_subprocess(prepared.query_text, prepared.language,
                timeout=settings.STORE_JOBS_TIMEOUT_SECONDS, deadline=deadline, claim=claim)
        except StoreScrapeError:
            if claim.attempts < settings.STORE_JOBS_MAX_ATTEMPTS:
                raise
            await repo.advance_warm(claim, query, 'failed', total=len(queries))
            return
        await repo.advance_warm(claim, query, 'cache_miss' if products else 'empty', total=len(queries),
            products=products, language=prepared.language, cache_version=CACHE_VERSION)
    else:
        payload = claim.payload
        # Recheck shared cache after queue wait; another job may have filled it.
        if not payload['force_refresh']:
            async with repo.sessions() as session:
                cached = await repo_store_cache.get_cached_store_products_with_metadata(session,
                    query=payload['query'], store='weee', language=payload['language'],
                    cache_version=payload['cache_version'], max_age_seconds=CACHE_TTL_SECONDS)
            if cached is not None:
                await repo.complete(claim, products=cached.products, cached_at=cached.updated_at, publish=False)
                return
        products = await scrape_in_subprocess(payload['query'], payload['language'],
            timeout=settings.STORE_JOBS_TIMEOUT_SECONDS, deadline=deadline, claim=claim)
        await repo.complete(claim, products=products, cached_at=None)


async def run_claim(repo, claim, *, deadline):
    work = asyncio.create_task(_execute(repo, claim, deadline))
    async def pulse():
        while True:
            await asyncio.sleep(min(5, settings.STORE_JOBS_LEASE_SECONDS/4))
            if not await repo.heartbeat(claim):
                raise StoreScrapeError('Store job ownership lost')
    heartbeat = asyncio.create_task(pulse())
    try:
        done, _ = await asyncio.wait({work, heartbeat}, return_when=asyncio.FIRST_COMPLETED)
        if heartbeat in done:
            heartbeat.result()
        await work
    except asyncio.CancelledError:
        raise
    except Exception:
        # No exception messages or private queries in logs/status.
        logger.warning('store job failed', extra={'event': 'store_job_failed', 'job_id': str(claim.id)})
    finally:
        work.cancel()
        heartbeat.cancel()
        outcomes = await asyncio.gather(work, heartbeat, return_exceptions=True)
        for outcome in outcomes:
            if isinstance(outcome, CleanupFailed):
                raise outcome
        # Fenced no-op after success. On cancellation/crash the lease is still
        # recoverable; release/retry only after subprocess cleanup has completed.
        await repo.fail(claim)


async def run_worker():
    if sys.platform != 'linux':
        raise RuntimeError('Durable scraper worker requires Linux descendant containment')
    if settings.STORE_JOBS_MODE != 'durable':
        raise RuntimeError('Worker requires STORE_JOBS_MODE=durable')
    if not settings.STORE_JOBS_ENABLED:
        raise RuntimeError('Store worker is disabled')
    db_session.init_engine()
    repo = repository()
    owner = str(uuid4())
    task = asyncio.current_task()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, task.cancel)
    maintenance_at = 0.0
    try:
        while True:
            try:
                if time.monotonic() >= maintenance_at:
                    try:
                        await repo.schedule_warm(interval_seconds=settings.STORE_JOBS_WARM_INTERVAL_SECONDS)
                    except QueueFull:
                        pass
                    await repo.prune(retention_seconds=settings.STORE_JOBS_RETENTION_SECONDS)
                    maintenance_at = time.monotonic()+30
                started = time.monotonic()
                claim = await repo.claim(owner)
                if claim is not None:
                    # Monotonic horizon starts BEFORE the claim round trip. Child
                    # watchdog receives the same clock and stops before DB lease.
                    await run_claim(repo, claim, deadline=started+settings.STORE_JOBS_LEASE_SECONDS-30)
                else:
                    await asyncio.sleep(settings.STORE_JOBS_POLL_SECONDS)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning('store worker database operation failed', extra={'event': 'store_worker_retry'})
                await asyncio.sleep(max(1, settings.STORE_JOBS_POLL_SECONDS))
    finally:
        await db_session.dispose_engine()


def main():
    logging.basicConfig(level=logging.INFO)
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        pass
    except asyncio.CancelledError:
        pass


if __name__ == '__main__':
    main()
