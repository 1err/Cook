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
from app.jobs.cache_warmer_queries import ALL_QUERIES, DEFAULT_STORE
from app.services.store_product_service import (
    CACHE_TTL_SECONDS,
    CACHE_VERSION,
    fetch_store_products,
    prepare_store_query,
)

logger = logging.getLogger(__name__)

WarmStatus = Literal["skipped", "cache_hit", "cache_miss", "empty", "failed"]
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
    force_refresh: bool = False,
) -> tuple[WarmStatus, list[dict[str, str]]]:
    prepared = prepare_store_query(query)
    if prepared is None:
        return "skipped", []
    if force_refresh:
        products = await fetch_store_products(
            query,
            session=None,
            force_refresh=True,
            priority="background",
        )
        return ("empty" if not products else "cache_miss"), products

    cleaned_query = prepared.cache_query
    language = prepared.language
    if db_session.async_session_maker is None:
        raise RuntimeError("Database session maker is not initialized.")
    async with db_session.async_session_maker() as session:
        cached = await repo_store_cache.get_cached_store_products(
            session,
            query=cleaned_query,
            store=DEFAULT_STORE,
            language=language,
            cache_version=CACHE_VERSION,
            max_age_seconds=CACHE_TTL_SECONDS,
        )
        if cached is not None:
            return "cache_hit", cached
        products = await fetch_store_products(
            query,
            session=session,
            force_refresh=force_refresh,
            priority="background",
        )
        await session.commit()
        return ("empty" if not products else "cache_miss"), products


async def run_cache_warmer(
    *,
    force_refresh: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, int]:
    async with _warmer_lock:
        started_at = time.perf_counter()
        logger.info("cache warmer started")
        summary = {
            "cache_hit": 0,
            "cache_miss": 0,
            "empty": 0,
            "skipped": 0,
            "failed": 0,
            "total": len(ALL_QUERIES),
        }
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
            try:
                status, _ = await warm_cache_query(query, force_refresh=force_refresh)
            except Exception:
                logger.exception("cache warmer query failed", extra={"query": query})
                status = "failed"
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
                try:
                    maybe_awaitable = progress_callback(index, summary["total"], query, status)
                    if inspect.isawaitable(maybe_awaitable):
                        await maybe_awaitable
                except Exception:
                    logger.exception("cache warmer progress callback failed", extra={"query": query})

        try:
            for index, query in enumerate(ALL_QUERIES, start=1):
                await warm(index, query)
            elapsed = time.perf_counter() - started_at
            logger.info(
                "cache warmer finished in %.2f seconds (hits=%s misses=%s empty=%s skipped=%s failed=%s total=%s)",
                elapsed,
                summary["cache_hit"],
                summary["cache_miss"],
                summary["empty"],
                summary["skipped"],
                summary["failed"],
                summary["total"],
            )
            _warmer_status.update({"running": False, "summary": summary.copy()})
            return summary
        finally:
            if _warmer_status["summary"] is None:
                _warmer_status["summary"] = summary.copy()
            _warmer_status["running"] = False


async def _run_scheduled_cache_warmer() -> None:
    await run_cache_warmer(force_refresh=True)


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
    _scheduler = scheduler
    return scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
