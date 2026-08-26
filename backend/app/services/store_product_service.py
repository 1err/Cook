"""Fresh cached Weee product lookups coordinated through one live worker."""
from __future__ import annotations

import asyncio
from collections import OrderedDict, deque
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
from app.core.store_products import normalize_store_products
from app.services import weee_scraper

logger = logging.getLogger(__name__)

StoreName = Literal["weee"]
Language = Literal["en", "zh"]
LookupPriority = Literal["interactive", "background"]
CacheKey = tuple[StoreName, Language, str, str]
CACHE_TTL_SECONDS = 86_400
CACHE_VERSION = "v7"
CACHE_MAX_ENTRIES = 256
LIVE_OPERATION_TIMEOUT_SECONDS = 125.0
LIVE_QUEUE_MAX_WAIT_SECONDS = 180.0
LIVE_FRONT_DOOR_TIMEOUT_SECONDS = 240.0
LIVE_WORKER_SHUTDOWN_TIMEOUT_SECONDS = 10.0
MAX_INTERACTIVE_BURST = 8
BACKGROUND_MAX_WAIT_SECONDS = 30.0
CACHE: OrderedDict[CacheKey, dict[str, Any]] = OrderedDict()
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


def _prune_memory_cache(now: float) -> None:
    for key, entry in list(CACHE.items()):
        timestamp = entry.get("timestamp")
        if not isinstance(timestamp, (int, float)) or now - timestamp >= CACHE_TTL_SECONDS:
            CACHE.pop(key, None)


def _memory_cache_get_with_metadata(cache_key: CacheKey) -> StoreProductsResult | None:
    now = time.time()
    _prune_memory_cache(now)
    entry = CACHE.get(cache_key)
    if entry is None:
        return None
    timestamp = entry.get("timestamp")
    data = entry.get("data")
    if not isinstance(timestamp, (int, float)) or now - timestamp >= CACHE_TTL_SECONDS:
        CACHE.pop(cache_key, None)
        return None
    products = normalize_store_products(data)
    if not products:
        CACHE.pop(cache_key, None)
        return None
    CACHE.move_to_end(cache_key)
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
    now = time.time()
    _prune_memory_cache(now)
    normalized = normalize_store_products(products)
    if not normalized:
        CACHE.pop(cache_key, None)
        return
    CACHE[cache_key] = {
        "data": normalized,
        "timestamp": now if timestamp is None else timestamp,
    }
    CACHE.move_to_end(cache_key)
    while len(CACHE) > CACHE_MAX_ENTRIES:
        CACHE.popitem(last=False)


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
    operation: Callable[[float], Awaitable[StoreProductsResult]]
    future: asyncio.Future[StoreProductsResult]
    priority: LookupPriority
    queued_at: float
    started: bool = False


class _LiveLookupCoordinator:
    """Run one bounded scrape, preferring users without starving the warmer."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._jobs: dict[CacheKey, _QueuedJob] = {}
        self._interactive: deque[_QueuedJob] = deque()
        self._background: deque[_QueuedJob] = deque()
        self._worker: asyncio.Task[None] | None = None
        self._accepting = True
        self._interactive_streak = 0

    @staticmethod
    def _consume_exception(future: asyncio.Future[StoreProductsResult]) -> None:
        if not future.cancelled():
            future.exception()

    @classmethod
    async def _bounded_operation(
        cls,
        operation: Awaitable[StoreProductsResult],
    ) -> StoreProductsResult:
        """Stop waiting at the deadline even if an awaitable resists cancellation."""
        task = asyncio.ensure_future(operation)
        try:
            done, _ = await asyncio.wait(
                {task},
                timeout=LIVE_OPERATION_TIMEOUT_SECONDS,
            )
        except asyncio.CancelledError:
            task.cancel()
            task.add_done_callback(cls._consume_exception)
            raise
        if task in done:
            return task.result()
        task.cancel()
        task.add_done_callback(cls._consume_exception)
        raise TimeoutError

    def _next_valid(self, queue: deque[_QueuedJob], priority: LookupPriority) -> _QueuedJob | None:
        while queue:
            job = queue.popleft()
            if self._jobs.get(job.key) is job and not job.started and job.priority == priority:
                return job
        return None

    def _peek_valid(
        self,
        queue: deque[_QueuedJob],
        priority: LookupPriority,
    ) -> _QueuedJob | None:
        while queue:
            job = queue[0]
            if self._jobs.get(job.key) is job and not job.started and job.priority == priority:
                return job
            queue.popleft()
        return None

    def _choose_next(self, now: float) -> _QueuedJob | None:
        interactive = self._peek_valid(self._interactive, "interactive")
        background = self._peek_valid(self._background, "background")
        background_is_due = background is not None and (
            interactive is None
            or self._interactive_streak >= MAX_INTERACTIVE_BURST
            or now - background.queued_at >= BACKGROUND_MAX_WAIT_SECONDS
        )
        if background_is_due:
            self._interactive_streak = 0
            return self._next_valid(self._background, "background")
        if interactive is not None:
            if background is None:
                self._interactive_streak = 0
            else:
                self._interactive_streak += 1
            return self._next_valid(self._interactive, "interactive")
        if background is not None:
            self._interactive_streak = 0
            return self._next_valid(self._background, "background")
        return None

    def start_admission(self) -> None:
        self._accepting = True

    def stop_admission(self) -> None:
        self._accepting = False

    async def submit(
        self,
        key: CacheKey,
        priority: LookupPriority,
        operation: Callable[[float], Awaitable[StoreProductsResult]],
    ) -> StoreProductsResult:
        if priority not in ("interactive", "background"):
            raise ValueError(f"Invalid lookup priority: {priority!r}")
        async with self._lock:
            if not self._accepting:
                raise weee_scraper.StoreScrapeError(
                    "Store product lookups are shutting down."
                )
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
        try:
            return await asyncio.wait_for(
                asyncio.shield(future),
                timeout=LIVE_FRONT_DOOR_TIMEOUT_SECONDS,
            )
        except TimeoutError as exc:
            raise weee_scraper.StoreScrapeError(
                "Store product lookup front door timed out."
            ) from exc

    async def _run(self) -> None:
        while True:
            async with self._lock:
                now = time.perf_counter()
                job = self._choose_next(now)
                if job is None:
                    self._worker = None
                    return
                queue_wait_seconds = now - job.queued_at
                if queue_wait_seconds >= LIVE_QUEUE_MAX_WAIT_SECONDS:
                    if self._jobs.get(job.key) is job:
                        self._jobs.pop(job.key, None)
                    if not job.future.done():
                        job.future.set_exception(
                            weee_scraper.StoreScrapeError(
                                "Store product lookup expired in the live queue."
                            )
                        )
                    continue
                job.started = True
            try:
                result = await self._bounded_operation(
                    job.operation(queue_wait_seconds * 1_000),
                )
            except asyncio.CancelledError:
                if not job.future.done():
                    job.future.set_exception(
                        weee_scraper.StoreScrapeError(
                            "Store product lookups are shutting down."
                        )
                    )
                raise
            except TimeoutError:
                await weee_scraper.shutdown_weee_scraper()
                timeout_error = weee_scraper.StoreScrapeError(
                    "Store product live operation timed out."
                )
                if not job.future.done():
                    job.future.set_exception(timeout_error)
                logger.warning(
                    "store product live operation timed out",
                    extra={"event": "store_products_live_timeout", "query": job.key[3]},
                )
            except Exception as exc:
                if not job.future.done():
                    job.future.set_exception(exc)
            else:
                if not job.future.done():
                    job.future.set_result(result)
            finally:
                async with self._lock:
                    if self._jobs.get(job.key) is job:
                        self._jobs.pop(job.key, None)

    async def shutdown(self) -> None:
        error = weee_scraper.StoreScrapeError(
            "Store product lookups are shutting down."
        )
        async with self._lock:
            self._accepting = False
            jobs = list(self._jobs.values())
            self._jobs.clear()
            self._interactive.clear()
            self._background.clear()
            worker = self._worker
            for job in jobs:
                if not job.future.done():
                    job.future.set_exception(error)
            if worker is not None and not worker.done():
                worker.cancel()
        if worker is not None:
            try:
                await asyncio.wait_for(
                    asyncio.shield(worker),
                    timeout=LIVE_WORKER_SHUTDOWN_TIMEOUT_SECONDS,
                )
            except asyncio.CancelledError:
                pass
            except TimeoutError:
                logger.error("store product worker did not stop before shutdown deadline")
            async with self._lock:
                if self._worker is worker:
                    self._worker = None

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
            self._interactive_streak = 0


_live_lookups = _LiveLookupCoordinator()


async def reset_for_tests() -> None:
    """Reset the process-local lookup state for deterministic test isolation."""
    await _live_lookups.reset_for_tests()


def start_live_lookup_admission() -> None:
    """Enable request admission at application startup (including repeated lifespans)."""
    _live_lookups.start_admission()


def stop_live_lookup_admission() -> None:
    """Synchronously reject new submissions before async teardown begins."""
    _live_lookups.stop_admission()


async def shutdown_live_lookups() -> None:
    """Reject new live work and settle all active or queued waiters."""
    await _live_lookups.shutdown()


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
    release_read_session_on_miss: bool = False,
) -> StoreProductsResult:
    """Fetch products; callers opt in explicitly when this session is read-only.

    ``release_read_session_on_miss`` closes the caller-owned read session only
    after all cache reads miss and before entering the live queue. Routes may
    opt in after authentication; general service callers retain ownership.
    """
    if priority not in ("interactive", "background"):
        raise ValueError(f"Invalid lookup priority: {priority!r}")
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
                database_products = normalize_store_products(database.products)
                if database_products:
                    _memory_cache_set(
                        cache_key,
                        database_products,
                        timestamp=database.updated_at.timestamp(),
                    )
                    _log_event(
                        "postgres_hit",
                        cache_key,
                        priority=priority,
                        started_at=started_at,
                        product_count=len(database_products),
                    )
                    return StoreProductsResult(database_products, database.updated_at)
            memory = _memory_cache_get_with_metadata(cache_key)
            if memory is not None:
                _log_event("memory_hit", cache_key, priority=priority, started_at=started_at, product_count=len(memory.products))
                return memory

    if release_read_session_on_miss and session is not None:
        await session.close()

    _log_event("cache_miss", cache_key, priority=priority, started_at=started_at)

    async def scrape_and_persist(queue_wait_ms: float) -> StoreProductsResult:
        scrape_started_at = time.perf_counter()
        try:
            raw_products = await weee_scraper.scrape_weee_products(prepared.query_text, prepared.language)
            current_task = asyncio.current_task()
            if current_task is not None and current_task.cancelling():
                raise asyncio.CancelledError
            products = weee_scraper.validate_products(raw_products)
            if not products:
                _log_event(
                    "scrape_empty",
                    cache_key,
                    priority=priority,
                    started_at=scrape_started_at,
                    queue_wait_ms=queue_wait_ms,
                    product_count=0,
                )
                return StoreProductsResult(products=[], cached_at=None)
            cached_at = datetime.fromtimestamp(time.time(), tz=timezone.utc)
            await _persist_positive_result(prepared.cache_query, prepared.language, products, cached_at)
            _memory_cache_set(cache_key, products, timestamp=cached_at.timestamp())
            _log_event(
                "scrape_success",
                cache_key,
                priority=priority,
                started_at=scrape_started_at,
                queue_wait_ms=queue_wait_ms,
                product_count=len(products),
            )
            return StoreProductsResult(products, cached_at)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _log_event(
                "scrape_failure",
                cache_key,
                priority=priority,
                started_at=scrape_started_at,
                queue_wait_ms=queue_wait_ms,
                error=exc,
            )
            raise

    return await _live_lookups.submit(cache_key, priority, scrape_and_persist)


async def fetch_store_products(
    query: str,
    session: AsyncSession | None = None,
    *,
    force_refresh: bool = False,
    priority: LookupPriority = "interactive",
    release_read_session_on_miss: bool = False,
) -> list[dict[str, str]]:
    result = await fetch_store_products_with_metadata(
        query,
        session=session,
        force_refresh=force_refresh,
        priority=priority,
        release_read_session_on_miss=release_read_session_on_miss,
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
            products = normalize_store_products(entry.products)
            if not products:
                continue
            _memory_cache_set(
                ("weee", prepared.language, CACHE_VERSION, prepared.cache_query),
                products,
                timestamp=entry.updated_at.timestamp(),
            )
            fresh[key] = StoreProductsResult(products, entry.updated_at)

    entries: list[BatchStoreProductsEntry] = []
    for key, prepared in prepared_by_key.items():
        result = fresh.get(key)
        if result is None:
            entries.append(BatchStoreProductsEntry(prepared.query_text, "missing", [], None))
        else:
            entries.append(BatchStoreProductsEntry(prepared.query_text, "fresh", result.products, result.cached_at))
    return entries
