"""Fresh cached Weee product lookups coordinated through one live worker."""
from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import re
import time
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import repo_store_cache
from app.db import session as db_session
from app.services import weee_scraper

logger = logging.getLogger(__name__)

StoreName = Literal["weee"]
Language = Literal["en", "zh"]
LookupPriority = Literal["interactive", "background"]
CacheKey = tuple[StoreName, Language, str, str]
CACHE_TTL_SECONDS = 86_400
CACHE_VERSION = "v7"
CACHE: dict[CacheKey, dict[str, Any]] = {}
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")


@dataclass(frozen=True)
class PreparedStoreQuery:
    query_text: str
    cache_query: str
    language: Language


@dataclass(frozen=True)
class StoreProductsResult:
    products: list[dict[str, str]]
    cached_at: datetime | None


@dataclass(frozen=True)
class BatchStoreProductsEntry:
    query: str
    status: Literal["fresh", "missing"]
    products: list[dict[str, str]]
    cached_at: datetime | None


def _query_has_cjk(query: str) -> bool:
    return bool(_CJK_RE.search(query))


def prepare_store_query(query: str) -> PreparedStoreQuery | None:
    query_text = re.sub(r"\s+", " ", query or "").strip()
    if not query_text:
        return None
    return PreparedStoreQuery(
        query_text=query_text,
        cache_query=query_text.casefold(),
        language="zh" if _query_has_cjk(query_text) else "en",
    )


def _memory_cache_get_with_metadata(cache_key: CacheKey) -> StoreProductsResult | None:
    entry = CACHE.get(cache_key)
    if entry is None:
        return None
    timestamp = entry.get("timestamp")
    data = entry.get("data")
    if not isinstance(timestamp, (int, float)) or time.time() - timestamp >= CACHE_TTL_SECONDS:
        CACHE.pop(cache_key, None)
        return None
    try:
        products = weee_scraper.validate_products(data)
    except weee_scraper.StoreScrapeError:
        CACHE.pop(cache_key, None)
        return None
    if not products:
        return None
    return StoreProductsResult(products=products, cached_at=datetime.fromtimestamp(timestamp, tz=timezone.utc))


def _memory_cache_get(cache_key: CacheKey) -> list[dict[str, str]] | None:
    result = _memory_cache_get_with_metadata(cache_key)
    return result.products if result is not None else None


def _memory_cache_set(
    cache_key: CacheKey,
    products: list[dict[str, str]],
    *,
    timestamp: float | None = None,
) -> None:
    CACHE[cache_key] = {"data": products, "timestamp": time.time() if timestamp is None else timestamp}


def _log_event(
    event: str,
    cache_key: CacheKey,
    *,
    priority: LookupPriority,
    started_at: float,
    queue_wait_ms: float = 0.0,
    product_count: int | None = None,
    error: BaseException | None = None,
) -> None:
    elapsed_ms = max((time.perf_counter() - started_at) * 1_000, 0.0)
    fields: dict[str, Any] = {
        "event": event,
        "store": cache_key[0],
        "language": cache_key[1],
        "cache_version": cache_key[2],
        "query": cache_key[3],
        "priority": priority,
        "queue_wait_ms": queue_wait_ms,
        "elapsed_ms": elapsed_ms,
        "product_count": product_count,
        "error_type": type(error).__name__ if error is not None else None,
    }
    logger.info(
        "store_products event=%s store=weee language=%s cache_version=%s query=%r priority=%s queue_wait_ms=%.1f elapsed_ms=%.1f product_count=%s error_type=%s",
        event, cache_key[1], CACHE_VERSION, cache_key[3], priority, queue_wait_ms,
        elapsed_ms, product_count, fields["error_type"], extra=fields,
    )


@dataclass
class _QueuedJob:
    key: CacheKey
    operation: Callable[[], Awaitable[StoreProductsResult]]
    future: asyncio.Future[StoreProductsResult]
    priority: LookupPriority
    queued_at: float
    started: bool = False


class _LiveLookupCoordinator:
    """Runs one scrape at a time, with interactive work ahead of background work."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._jobs: dict[CacheKey, _QueuedJob] = {}
        self._interactive: deque[_QueuedJob] = deque()
        self._background: deque[_QueuedJob] = deque()
        self._worker: asyncio.Task[None] | None = None

    @staticmethod
    def _consume_exception(future: asyncio.Future[StoreProductsResult]) -> None:
        if not future.cancelled():
            future.exception()

    def _next_valid(self, queue: deque[_QueuedJob], priority: LookupPriority) -> _QueuedJob | None:
        while queue:
            job = queue.popleft()
            if self._jobs.get(job.key) is job and not job.started and job.priority == priority:
                return job
        return None

    async def submit(
        self,
        key: CacheKey,
        priority: LookupPriority,
        operation: Callable[[], Awaitable[StoreProductsResult]],
    ) -> StoreProductsResult:
        async with self._lock:
            job = self._jobs.get(key)
            if job is None:
                future: asyncio.Future[StoreProductsResult] = asyncio.get_running_loop().create_future()
                future.add_done_callback(self._consume_exception)
                job = _QueuedJob(key, operation, future, priority, time.perf_counter())
                self._jobs[key] = job
                (self._interactive if priority == "interactive" else self._background).append(job)
            elif priority == "interactive" and job.priority == "background" and not job.started:
                job.priority = "interactive"
                self._interactive.append(job)
            if self._worker is None or self._worker.done():
                self._worker = asyncio.create_task(self._run())
            future = job.future
        return await asyncio.shield(future)

    async def _run(self) -> None:
        while True:
            async with self._lock:
                job = self._next_valid(self._interactive, "interactive")
                if job is None:
                    job = self._next_valid(self._background, "background")
                if job is None:
                    self._worker = None
                    return
                job.started = True
            try:
                result = await job.operation()
            except BaseException as exc:
                if not job.future.done():
                    job.future.set_exception(exc)
            else:
                if not job.future.done():
                    job.future.set_result(result)
            finally:
                async with self._lock:
                    if self._jobs.get(job.key) is job:
                        self._jobs.pop(job.key, None)

    async def reset_for_tests(self) -> None:
        """Wait for an idle worker, then clear queue bookkeeping deterministically."""
        async with self._lock:
            if self._jobs:
                raise RuntimeError("Cannot reset live lookups while jobs are still running.")
            worker = self._worker
        if worker is not None:
            await asyncio.shield(worker)
        async with self._lock:
            if self._jobs:
                raise RuntimeError("Cannot reset live lookups while jobs are still running.")
            self._interactive.clear()
            self._background.clear()
            self._worker = None


_live_lookups = _LiveLookupCoordinator()


async def reset_for_tests() -> None:
    """Reset the process-local lookup state for deterministic test isolation."""
    await _live_lookups.reset_for_tests()


async def _persist_positive_result(
    cache_query: str,
    language: Language,
    products: list[dict[str, str]],
    cached_at: datetime,
) -> None:
    maker = db_session.async_session_maker
    if maker is None:
        raise RuntimeError("Database session maker is not initialized.")
    async with maker() as write_session:
        try:
            await repo_store_cache.upsert_cached_store_products(
                write_session, query=cache_query, store="weee", language=language,
                cache_version=CACHE_VERSION, data=products, updated_at=cached_at,
            )
            await write_session.commit()
        except BaseException:
            await write_session.rollback()
            raise


async def fetch_store_products_with_metadata(
    query: str,
    session: AsyncSession | None = None,
    *,
    force_refresh: bool = False,
    priority: LookupPriority = "interactive",
) -> StoreProductsResult:
    started_at = time.perf_counter()
    prepared = prepare_store_query(query)
    if prepared is None:
        return StoreProductsResult(products=[], cached_at=None)
    cache_key: CacheKey = ("weee", prepared.language, CACHE_VERSION, prepared.cache_query)

    if not force_refresh:
        memory = _memory_cache_get_with_metadata(cache_key)
        if memory is not None:
            _log_event("memory_hit", cache_key, priority=priority, started_at=started_at, product_count=len(memory.products))
            return memory
        if session is not None:
            database = await repo_store_cache.get_cached_store_products_with_metadata(
                session, query=prepared.cache_query, store="weee", language=prepared.language,
                cache_version=CACHE_VERSION, max_age_seconds=CACHE_TTL_SECONDS,
            )
            if database is not None:
                _memory_cache_set(cache_key, database.products, timestamp=database.updated_at.timestamp())
                _log_event("postgres_hit", cache_key, priority=priority, started_at=started_at, product_count=len(database.products))
                return StoreProductsResult(database.products, database.updated_at)
            memory = _memory_cache_get_with_metadata(cache_key)
            if memory is not None:
                _log_event("memory_hit", cache_key, priority=priority, started_at=started_at, product_count=len(memory.products))
                return memory

    _log_event("cache_miss", cache_key, priority=priority, started_at=started_at)

    async def scrape_and_persist() -> StoreProductsResult:
        scrape_started_at = time.perf_counter()
        try:
            raw_products = await weee_scraper.scrape_weee_products(prepared.query_text, prepared.language)
            products = weee_scraper.validate_products(raw_products)
            if not products:
                _log_event("scrape_empty", cache_key, priority=priority, started_at=scrape_started_at, product_count=0)
                return StoreProductsResult(products=[], cached_at=None)
            cached_at = datetime.fromtimestamp(time.time(), tz=timezone.utc)
            await _persist_positive_result(prepared.cache_query, prepared.language, products, cached_at)
            _memory_cache_set(cache_key, products, timestamp=cached_at.timestamp())
            _log_event("scrape_success", cache_key, priority=priority, started_at=scrape_started_at, product_count=len(products))
            return StoreProductsResult(products, cached_at)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _log_event("scrape_failure", cache_key, priority=priority, started_at=scrape_started_at, error=exc)
            raise

    return await _live_lookups.submit(cache_key, priority, scrape_and_persist)


async def fetch_store_products(
    query: str,
    session: AsyncSession | None = None,
    *,
    force_refresh: bool = False,
    priority: LookupPriority = "interactive",
) -> list[dict[str, str]]:
    result = await fetch_store_products_with_metadata(
        query, session=session, force_refresh=force_refresh, priority=priority,
    )
    return result.products


async def fetch_cached_store_products_batch(
    queries: Sequence[str], session: AsyncSession,
) -> list[BatchStoreProductsEntry]:
    prepared_by_key: dict[tuple[str, Language], PreparedStoreQuery] = {}
    for query in queries:
        prepared = prepare_store_query(query)
        if prepared is not None:
            prepared_by_key.setdefault((prepared.cache_query, prepared.language), prepared)

    fresh: dict[tuple[str, Language], StoreProductsResult] = {}
    missing: list[tuple[str, Language]] = []
    for key, prepared in prepared_by_key.items():
        cache_key: CacheKey = ("weee", prepared.language, CACHE_VERSION, prepared.cache_query)
        result = _memory_cache_get_with_metadata(cache_key)
        if result is None:
            missing.append(key)
        else:
            fresh[key] = result
    if missing:
        database = await repo_store_cache.get_cached_store_products_batch(
            session, keys=missing, store="weee", cache_version=CACHE_VERSION,
            max_age_seconds=CACHE_TTL_SECONDS,
        )
        for key in missing:
            entry = database.get(key)
            if entry is None:
                continue
            prepared = prepared_by_key[key]
            _memory_cache_set(("weee", prepared.language, CACHE_VERSION, prepared.cache_query), entry.products, timestamp=entry.updated_at.timestamp())
            fresh[key] = StoreProductsResult(entry.products, entry.updated_at)

    entries: list[BatchStoreProductsEntry] = []
    for key, prepared in prepared_by_key.items():
        result = fresh.get(key)
        if result is None:
            entries.append(BatchStoreProductsEntry(prepared.query_text, "missing", [], None))
        else:
            entries.append(BatchStoreProductsEntry(prepared.query_text, "fresh", result.products, result.cached_at))
    return entries
