"""
In-process cache warming jobs.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.db import repo_store_cache
from app.db import session as db_session
from app.jobs.cache_warmer_queries import ALL_QUERIES, DEFAULT_STORE, PRECOMPUTE_CONCURRENCY
from app.services.store_scraper import CACHE_TTL_SECONDS, CACHE_VERSION, fetch_store_products, prepare_store_query

logger = logging.getLogger(__name__)

WarmStatus = Literal["skipped", "cache_hit", "cache_miss"]
ProgressCallback = Callable[[int, int, str, WarmStatus], None | Awaitable[None]]

_scheduler: AsyncIOScheduler | None = None
_warmer_lock = asyncio.Lock()
_warmer_task: asyncio.Task[dict[str, int]] | None = None
_warmer_status: dict[str, Any] = {
    "running": False,
    "current": 0,
    "total": len(ALL_QUERIES),
    "last_query": "",
    "last_status": "",
    "stale_only": False,
    "summary": None,
}


async def warm_cache_query(
    query: str,
    *,
    store: str = DEFAULT_STORE,
    force_refresh: bool = False,
) -> tuple[WarmStatus, list[dict[str, str]]]:
    prepared = prepare_store_query(query, store)
    if prepared is None:
        return "skipped", []
    cleaned_query, language = prepared
    if db_session.async_session_maker is None:
        raise RuntimeError("Database session maker is not initialized.")
    async with db_session.async_session_maker() as session:
        if not force_refresh:
            cached = await repo_store_cache.get_cached_store_products(
                session,
                query=cleaned_query,
                store=store,
                language=language,
                cache_version=CACHE_VERSION,
                max_age_seconds=CACHE_TTL_SECONDS,
            )
            if cached is not None:
                return "cache_hit", cached
        products = await fetch_store_products(query, store, session=session, force_refresh=force_refresh)
        await session.commit()
        return "cache_miss", products


async def run_cache_warmer(
    *,
    store: str = DEFAULT_STORE,
    force_refresh: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, int]:
    async with _warmer_lock:
        started_at = time.perf_counter()
        logger.info("cache warmer started")
        summary = {"cache_hit": 0, "cache_miss": 0, "skipped": 0, "total": len(ALL_QUERIES)}
        semaphore = asyncio.Semaphore(PRECOMPUTE_CONCURRENCY)
        completed = 0
        _warmer_status.update(
            {
                "running": True,
                "current": 0,
                "total": len(ALL_QUERIES),
                "last_query": "",
                "last_status": "",
                "stale_only": not force_refresh,
                "summary": None,
            }
        )

        async def warm(index: int, query: str) -> None:
            nonlocal completed
            async with semaphore:
                status, _ = await warm_cache_query(query, store=store, force_refresh=force_refresh)
                summary[status] += 1
                completed += 1
                _warmer_status.update(
                    {
                        "current": completed,
                        "last_query": query,
                        "last_status": status,
                    }
                )
                if progress_callback is not None:
                    maybe_awaitable = progress_callback(index, summary["total"], query, status)
                    if inspect.isawaitable(maybe_awaitable):
                        await maybe_awaitable

        try:
            await asyncio.gather(*(warm(index, query) for index, query in enumerate(ALL_QUERIES, start=1)))
            elapsed = time.perf_counter() - started_at
            logger.info(
                "cache warmer finished in %.2f seconds (hits=%s misses=%s skipped=%s total=%s)",
                elapsed,
                summary["cache_hit"],
                summary["cache_miss"],
                summary["skipped"],
                summary["total"],
            )
            _warmer_status.update({"running": False, "summary": summary.copy()})
            return summary
        finally:
            if _warmer_status["summary"] is None:
                _warmer_status["summary"] = summary.copy()
            _warmer_status["running"] = False


async def _run_scheduled_cache_warmer() -> None:
    await run_cache_warmer(force_refresh=False)


def get_cache_warmer_status() -> dict[str, Any]:
    return {
        "running": bool(_warmer_status["running"]),
        "current": int(_warmer_status["current"]),
        "total": int(_warmer_status["total"]),
        "last_query": str(_warmer_status["last_query"] or ""),
        "last_status": str(_warmer_status["last_status"] or ""),
        "stale_only": bool(_warmer_status["stale_only"]),
        "summary": _warmer_status["summary"],
    }


def trigger_cache_warmer(*, force_refresh: bool) -> dict[str, Any]:
    global _warmer_task
    if _warmer_task is not None and not _warmer_task.done():
        return {"started": False, "status": get_cache_warmer_status()}
    _warmer_status.update(
        {
            "running": True,
            "current": 0,
            "total": len(ALL_QUERIES),
            "last_query": "",
            "last_status": "",
            "stale_only": not force_refresh,
            "summary": None,
        }
    )

    async def runner() -> dict[str, int]:
        try:
            return await run_cache_warmer(force_refresh=force_refresh)
        finally:
            global _warmer_task
            _warmer_task = None

    _warmer_task = asyncio.create_task(runner())
    return {"started": True, "status": get_cache_warmer_status()}


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _run_scheduled_cache_warmer,
        trigger="interval",
        hours=24,
        id="cache-warmer",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    trigger_cache_warmer(force_refresh=False)
    _scheduler = scheduler
    return scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
