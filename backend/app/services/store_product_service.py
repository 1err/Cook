"""Fresh cached Weee product lookups coordinated through one live worker."""
from __future__ import annotations

import asyncio
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
import logging
import math
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
LIVE_DETACHED_DRAIN_TIMEOUT_SECONDS = 10.0
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


def _finite_number(value: object) -> float | None:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        return None
    return float(value)


def _memory_cache_age_seconds(
    entry: dict[str, Any],
    now: float,
    monotonic_now: float,
) -> float | None:
    if (
        "authoritative_age_seconds" in entry
        or "authoritative_age_anchor_monotonic" in entry
    ):
        base_age = _finite_number(entry.get("authoritative_age_seconds"))
        anchor = _finite_number(entry.get("authoritative_age_anchor_monotonic"))
        if base_age is None or anchor is None:
            return None
        elapsed = monotonic_now - anchor
        if not math.isfinite(elapsed) or elapsed < 0:
            return None
        age_seconds = base_age + elapsed
    else:
        timestamp = _finite_number(entry.get("timestamp"))
        if timestamp is None or not math.isfinite(now):
            return None
        age_seconds = now - timestamp
    if not math.isfinite(age_seconds) or not 0 <= age_seconds < CACHE_TTL_SECONDS:
        return None
    return age_seconds


def _prune_memory_cache(now: float, monotonic_now: float | None = None) -> None:
    if monotonic_now is None:
        monotonic_now = time.monotonic()
    for key, entry in list(CACHE.items()):
        if _memory_cache_age_seconds(entry, now, monotonic_now) is None:
            CACHE.pop(key, None)


def _is_fresh_memory_timestamp(timestamp: object, now: float) -> bool:
    if (
        isinstance(timestamp, bool)
        or not isinstance(timestamp, (int, float))
        or not math.isfinite(timestamp)
        or not math.isfinite(now)
    ):
        return False
    age_seconds = now - timestamp
    return math.isfinite(age_seconds) and 0 <= age_seconds < CACHE_TTL_SECONDS


def _memory_cache_get_with_metadata(cache_key: CacheKey) -> StoreProductsResult | None:
    now = time.time()
    monotonic_now = time.monotonic()
    _prune_memory_cache(now, monotonic_now)
    entry = CACHE.get(cache_key)
    if entry is None:
        return None
    data = entry.get("data")
    age_seconds = _memory_cache_age_seconds(entry, now, monotonic_now)
    if age_seconds is None:
        CACHE.pop(cache_key, None)
        return None
    products = normalize_store_products(data)
    if not products:
        CACHE.pop(cache_key, None)
        return None
    CACHE.move_to_end(cache_key)
    return StoreProductsResult(
        products=products,
        cached_at=datetime.fromtimestamp(now - age_seconds, tz=timezone.utc),
    )


def _memory_cache_get(cache_key: CacheKey) -> list[dict[str, str]] | None:
    result = _memory_cache_get_with_metadata(cache_key)
    return result.products if result is not None else None


def _memory_cache_set(
    cache_key: CacheKey,
    products: list[dict[str, str]],
    *,
    timestamp: float | None = None,
    authoritative_age_seconds: float | None = None,
) -> None:
    now = time.time()
    monotonic_now = time.monotonic()
    _prune_memory_cache(now, monotonic_now)
    normalized = normalize_store_products(products)
    if not normalized:
        return
    if authoritative_age_seconds is None:
        effective_timestamp = now if timestamp is None else timestamp
        if not _is_fresh_memory_timestamp(effective_timestamp, now):
            return
        candidate_age = now - effective_timestamp
        candidate_entry: dict[str, Any] = {
            "data": normalized,
            "timestamp": effective_timestamp,
        }
    else:
        candidate_age = _finite_number(authoritative_age_seconds)
        if (
            candidate_age is None
            or not 0 <= candidate_age < CACHE_TTL_SECONDS
        ):
            return
        candidate_entry = {
            "data": normalized,
            # This translated wall timestamp is presentation metadata only;
            # monotonic age below owns expiry while the process is alive.
            "timestamp": now - candidate_age,
            "authoritative_age_seconds": candidate_age,
            "authoritative_age_anchor_monotonic": monotonic_now,
        }
    existing = CACHE.get(cache_key)
    if existing is not None:
        existing_age = _memory_cache_age_seconds(existing, now, monotonic_now)
        existing_products = normalize_store_products(existing.get("data"))
        if (
            existing_products
            and existing_age is not None
            and existing_age <= candidate_age
        ):
            return
    CACHE[cache_key] = candidate_entry
    CACHE.move_to_end(cache_key)
    while len(CACHE) > CACHE_MAX_ENTRIES:
        CACHE.popitem(last=False)


def _authoritative_cache_age_seconds(entry: object) -> float | None:
    """Translate a DB-clock observation into age at this local instant."""
    updated_at = getattr(entry, "updated_at", None)
    observed_at = getattr(entry, "observed_at", None)
    if not isinstance(updated_at, datetime):
        return None
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    if observed_at is None:
        observed_at = datetime.fromtimestamp(time.time(), tz=timezone.utc)
    elif not isinstance(observed_at, datetime):
        return None
    elif observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    try:
        age_seconds = (observed_at - updated_at).total_seconds()
    except (OverflowError, TypeError, ValueError):
        return None
    observation_anchor = getattr(entry, "observation_anchor_monotonic", None)
    if observation_anchor is not None:
        anchor = _finite_number(observation_anchor)
        monotonic_now = _finite_number(time.monotonic())
        if anchor is None or monotonic_now is None:
            return None
        elapsed = monotonic_now - anchor
        if not math.isfinite(elapsed) or elapsed < 0:
            return None
        age_seconds += elapsed
    if not math.isfinite(age_seconds) or not 0 <= age_seconds < CACHE_TTL_SECONDS:
        return None
    return age_seconds


def _memory_cache_set_from_database_entry(
    cache_key: CacheKey,
    products: list[dict[str, str]],
    entry: object,
    age_seconds: float,
) -> None:
    """Publish DB-clock metadata, retaining legacy fake/read compatibility."""
    if isinstance(getattr(entry, "observed_at", None), datetime):
        _memory_cache_set(
            cache_key,
            products,
            authoritative_age_seconds=age_seconds,
        )
        return
    updated_at = getattr(entry, "updated_at", None)
    if isinstance(updated_at, datetime):
        _memory_cache_set(cache_key, products, timestamp=updated_at.timestamp())


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
class _LiveJobLease:
    generation: int
    valid: bool = True
    reason: str = ""

    def invalidate(self, reason: str) -> None:
        self.valid = False
        self.reason = reason

    def ensure_valid(self) -> None:
        if not self.valid:
            raise weee_scraper.StoreScrapeError(
                f"Store product live job expired: {self.reason or 'lease invalidated'}."
            )


class _LiveChildCancelled(weee_scraper.StoreScrapeError):
    """A child stopped itself (or lost its final waiter), not the worker."""


@dataclass
class _QueuedJob:
    key: CacheKey
    operation: Callable[
        [float, LookupPriority, _LiveJobLease],
        Awaitable[StoreProductsResult],
    ]
    future: asyncio.Future[StoreProductsResult]
    priority: LookupPriority
    queued_at: float
    lease: _LiveJobLease
    waiter_tokens: set[int] = field(default_factory=set)
    started: bool = False
    active_task: asyncio.Task[StoreProductsResult] | None = None
    queue_watchdog: asyncio.Task[None] | None = None


class _LiveLookupCoordinator:
    """Run one bounded scrape, preferring users without starving the warmer."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._jobs: dict[CacheKey, _QueuedJob] = {}
        self._interactive: deque[_QueuedJob] = deque()
        self._background: deque[_QueuedJob] = deque()
        self._worker: asyncio.Task[None] | None = None
        self._detached_operations: set[asyncio.Task[Any]] = set()
        self._accepting = True
        self._contaminated = False
        self._interactive_streak = 0
        self._next_generation = 1
        self._next_waiter_token = 1

    @staticmethod
    def _consume_exception(future: asyncio.Future[StoreProductsResult]) -> None:
        if not future.cancelled():
            future.exception()

    def _consume_operation(
        self,
        task: asyncio.Task[Any],
    ) -> None:
        self._detached_operations.discard(task)
        if not task.cancelled():
            try:
                task.exception()
            except asyncio.CancelledError:
                pass

    def _track_detached_operation(
        self,
        task: asyncio.Task[Any],
    ) -> None:
        if task.done():
            self._consume_operation(task)
            return
        self._detached_operations.add(task)
        task.add_done_callback(self._consume_operation)

    async def _drain_detached_operations(self) -> None:
        deadline = asyncio.get_running_loop().time() + LIVE_DETACHED_DRAIN_TIMEOUT_SECONDS
        pending: set[asyncio.Task[Any]] = set()
        while True:
            pending = {task for task in self._detached_operations if not task.done()}
            if not pending:
                return
            for task in pending:
                task.cancel()
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            done, pending = await asyncio.wait(pending, timeout=remaining)
            for task in done:
                self._consume_operation(task)
            if pending:
                break
            await asyncio.sleep(0)
        if pending:
            logger.error(
                "store product detached operation(s) outlived shutdown deadline",
                extra={
                    "event": "store_products_detached_shutdown_timeout",
                    "operation_count": len(pending),
                },
            )

    async def _bounded_operation(
        self,
        job: _QueuedJob,
        operation: Awaitable[StoreProductsResult],
    ) -> StoreProductsResult:
        """Stop waiting at the deadline even if an awaitable resists cancellation."""
        task = asyncio.ensure_future(operation)
        job.active_task = task
        try:
            done, _ = await asyncio.wait(
                {task},
                timeout=LIVE_OPERATION_TIMEOUT_SECONDS,
            )
        except asyncio.CancelledError:
            job.lease.invalidate("worker cancellation")
            task.cancel()
            self._track_detached_operation(task)
            await asyncio.sleep(0)
            raise
        if task in done:
            try:
                result = task.result()
            except asyncio.CancelledError as exc:
                raise _LiveChildCancelled(
                    "Store product live child was cancelled."
                ) from exc
            job.lease.ensure_valid()
            return result
        job.lease.invalidate("operation timeout")
        task.cancel()
        self._track_detached_operation(task)
        await asyncio.sleep(0)
        raise TimeoutError

    @staticmethod
    def _temporary_unavailable_error() -> weee_scraper.StoreScrapeError:
        return weee_scraper.StoreScrapeError(
            "Store product lookup is temporarily unavailable while the prior live operation stops."
        )

    def _cancel_queue_watchdog(self, job: _QueuedJob) -> None:
        watchdog = job.queue_watchdog
        job.queue_watchdog = None
        if watchdog is not None and watchdog is not asyncio.current_task() and not watchdog.done():
            watchdog.cancel()

    def _has_waiting_background_locked(self) -> bool:
        return any(
            not candidate.started and candidate.priority == "background"
            for candidate in self._jobs.values()
        )

    def _remove_job_locked(self, job: _QueuedJob) -> None:
        if self._jobs.get(job.key) is job:
            self._jobs.pop(job.key, None)
        self._cancel_queue_watchdog(job)
        if not self._has_waiting_background_locked():
            self._interactive_streak = 0

    async def _expire_queued_job(self, job: _QueuedJob) -> None:
        delay = max(job.queued_at + LIVE_QUEUE_MAX_WAIT_SECONDS - time.perf_counter(), 0.0)
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        async with self._lock:
            if self._jobs.get(job.key) is not job or job.started:
                return
            queue_wait_seconds = max(time.perf_counter() - job.queued_at, 0.0)
            job.lease.invalidate("queue timeout")
            self._remove_job_locked(job)
            error = weee_scraper.StoreScrapeError(
                "Store product lookup expired in the live queue."
            )
            if not job.future.done():
                job.future.set_exception(error)
            _log_event(
                "queue_expired",
                job.key,
                priority=job.priority,
                started_at=job.queued_at,
                queue_wait_ms=queue_wait_seconds * 1_000,
                error=error,
            )

    def _fail_queued_for_quarantine_locked(self, active_job: _QueuedJob) -> None:
        for queued in list(self._jobs.values()):
            if queued is active_job or queued.started:
                continue
            queued.lease.invalidate("serial lane quarantine")
            self._remove_job_locked(queued)
            if not queued.future.done():
                queued.future.set_exception(self._temporary_unavailable_error())
        self._interactive.clear()
        self._background.clear()
        self._interactive_streak = 0

    async def _enter_quarantine(self, job: _QueuedJob) -> None:
        async with self._lock:
            self._contaminated = True
            self._fail_queued_for_quarantine_locked(job)

    async def _await_task_termination(self, task: asyncio.Task[Any]) -> bool:
        caller_cancelled = False
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                current = asyncio.current_task()
                if current is not None and current.cancelling():
                    caller_cancelled = True
            except BaseException:
                break
        return caller_cancelled

    async def _quarantine_until_quiescent(self, job: _QueuedJob) -> bool:
        caller_cancelled = False
        active = job.active_task
        if active is not None:
            caller_cancelled = await self._await_task_termination(active)
        wait_for_quiescence = getattr(weee_scraper, "wait_for_scraper_quiescence", None)
        if callable(wait_for_quiescence):
            quiescence = asyncio.create_task(wait_for_quiescence())
            caller_cancelled = (
                await self._await_task_termination(quiescence) or caller_cancelled
            )
            if not quiescence.cancelled():
                try:
                    quiescence.result()
                except Exception:
                    logger.exception("failed to reach Weee scraper fixed-point quiescence")
        job.active_task = None
        async with self._lock:
            self._contaminated = False
        return caller_cancelled

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
        self._interactive_streak = 0
        return None

    def start_admission(self) -> None:
        self._accepting = True
        self._interactive_streak = 0

    def stop_admission(self) -> None:
        self._accepting = False

    async def submit(
        self,
        key: CacheKey,
        priority: LookupPriority,
        operation: Callable[
            [float, LookupPriority, _LiveJobLease],
            Awaitable[StoreProductsResult],
        ],
    ) -> StoreProductsResult:
        if priority not in ("interactive", "background"):
            raise ValueError(f"Invalid lookup priority: {priority!r}")
        async with self._lock:
            if not self._accepting:
                raise weee_scraper.StoreScrapeError(
                    "Store product lookups are shutting down."
                )
            if self._contaminated:
                raise self._temporary_unavailable_error()
            job = self._jobs.get(key)
            if job is None:
                future: asyncio.Future[StoreProductsResult] = asyncio.get_running_loop().create_future()
                future.add_done_callback(self._consume_exception)
                lease = _LiveJobLease(self._next_generation)
                self._next_generation += 1
                job = _QueuedJob(
                    key,
                    operation,
                    future,
                    priority,
                    time.perf_counter(),
                    lease,
                )
                self._jobs[key] = job
                (self._interactive if priority == "interactive" else self._background).append(job)
                job.queue_watchdog = asyncio.create_task(self._expire_queued_job(job))
            elif priority == "interactive" and job.priority == "background" and not job.started:
                job.priority = "interactive"
                self._interactive.append(job)
                if not self._has_waiting_background_locked():
                    self._interactive_streak = 0
            if self._worker is None or self._worker.done():
                self._worker = asyncio.create_task(self._run())
                self._worker.add_done_callback(self._worker_completed)
            future = job.future
            waiter_token = self._next_waiter_token
            self._next_waiter_token += 1
            job.waiter_tokens.add(waiter_token)
        released = False
        try:
            return await asyncio.wait_for(
                asyncio.shield(future),
                timeout=LIVE_FRONT_DOOR_TIMEOUT_SECONDS,
            )
        except TimeoutError as exc:
            caller_cancelled = await self._release_waiter_resilient(
                job,
                waiter_token,
                front_door_timeout=True,
            )
            released = True
            if caller_cancelled:
                raise asyncio.CancelledError
            raise weee_scraper.StoreScrapeError(
                "Store product lookup front door timed out."
            ) from exc
        except asyncio.CancelledError:
            await self._release_waiter_resilient(job, waiter_token)
            released = True
            raise
        finally:
            if not released:
                caller_cancelled = await self._release_waiter_resilient(
                    job,
                    waiter_token,
                )
                released = True
                if caller_cancelled:
                    raise asyncio.CancelledError

    def _worker_completed(self, task: asyncio.Task[None]) -> None:
        if self._worker is task:
            self._worker = None
        if not task.cancelled():
            try:
                task.exception()
            except asyncio.CancelledError:
                pass
        if (
            self._accepting
            and not self._contaminated
            and self._jobs
            and self._worker is None
        ):
            self._worker = asyncio.create_task(self._run())
            self._worker.add_done_callback(self._worker_completed)

    async def _release_waiter(
        self,
        job: _QueuedJob,
        waiter_token: int,
        *,
        front_door_timeout: bool = False,
    ) -> None:
        async with self._lock:
            if waiter_token not in job.waiter_tokens:
                return
            job.waiter_tokens.remove(waiter_token)
            if job.waiter_tokens:
                return
            if job.future.done():
                return
            reason = "front door timeout" if front_door_timeout else "no active waiters"
            job.lease.invalidate(reason)
            self._remove_job_locked(job)
            active = job.active_task
            if job.started and active is not None and not active.done():
                self._contaminated = True
                self._fail_queued_for_quarantine_locked(job)
                active.cancel()
            if not job.future.done():
                job.future.set_exception(
                    weee_scraper.StoreScrapeError(
                        "Store product lookup no longer has an active waiter."
                    )
                )

    async def _release_waiter_resilient(
        self,
        job: _QueuedJob,
        waiter_token: int,
        *,
        front_door_timeout: bool = False,
    ) -> bool:
        """Complete one identity-token release despite repeated caller cancellation."""
        current = asyncio.current_task()
        caller_cancelled = bool(current is not None and current.cancelling())
        release_task = asyncio.create_task(
            self._release_waiter(
                job,
                waiter_token,
                front_door_timeout=front_door_timeout,
            )
        )
        while not release_task.done():
            try:
                await asyncio.shield(release_task)
            except asyncio.CancelledError:
                current = asyncio.current_task()
                caller_cancelled = caller_cancelled or bool(
                    current is not None and current.cancelling()
                )
            except BaseException:
                break
        release_task.result()
        return caller_cancelled

    async def _run(self) -> None:
        while True:
            async with self._lock:
                now = time.perf_counter()
                job = self._choose_next(now)
                if job is None:
                    return
                queue_wait_seconds = now - job.queued_at
                if queue_wait_seconds >= LIVE_QUEUE_MAX_WAIT_SECONDS:
                    job.lease.invalidate("queue timeout")
                    self._remove_job_locked(job)
                    if not job.future.done():
                        job.future.set_exception(
                            weee_scraper.StoreScrapeError(
                                "Store product lookup expired in the live queue."
                            )
                        )
                    _log_event(
                        "queue_expired",
                        job.key,
                        priority=job.priority,
                        started_at=job.queued_at,
                        queue_wait_ms=queue_wait_seconds * 1_000,
                        error=weee_scraper.StoreScrapeError(
                            "Store product lookup expired in the live queue."
                        ),
                    )
                    continue
                job.started = True
                self._cancel_queue_watchdog(job)
                selected_priority = job.priority
            try:
                result = await self._bounded_operation(
                    job,
                    job.operation(
                        queue_wait_seconds * 1_000,
                        selected_priority,
                        job.lease,
                    ),
                )
            except asyncio.CancelledError:
                job.lease.invalidate("shutdown")
                if not job.future.done():
                    job.future.set_exception(
                        weee_scraper.StoreScrapeError(
                            "Store product lookups are shutting down."
                        )
                    )
                await self._enter_quarantine(job)
                try:
                    await weee_scraper.shutdown_weee_scraper()
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.exception("failed to invalidate Weee browser during shutdown")
                await self._quarantine_until_quiescent(job)
                return
            except TimeoutError:
                timeout_error = weee_scraper.StoreScrapeError(
                    "Store product live operation timed out."
                )
                await self._enter_quarantine(job)
                if not job.future.done():
                    job.future.set_exception(timeout_error)
                logger.warning(
                    "store product live operation timed out",
                    extra={
                        "event": "store_products_live_timeout",
                        "query": job.key[3],
                        "priority": selected_priority,
                        "queue_wait_ms": queue_wait_seconds * 1_000,
                    },
                )
                try:
                    await weee_scraper.shutdown_weee_scraper()
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.exception("failed to invalidate Weee browser after live timeout")
                caller_cancelled = await self._quarantine_until_quiescent(job)
                if caller_cancelled or not self._accepting:
                    return
            except _LiveChildCancelled as exc:
                await self._enter_quarantine(job)
                if not job.future.done():
                    job.future.set_exception(exc)
                caller_cancelled = await self._quarantine_until_quiescent(job)
                if caller_cancelled or not self._accepting:
                    return
            except Exception as exc:
                if not job.future.done():
                    job.future.set_exception(exc)
                if self._contaminated and not job.lease.valid:
                    caller_cancelled = await self._quarantine_until_quiescent(job)
                    if caller_cancelled or not self._accepting:
                        return
            else:
                if job.lease.valid and not job.future.done():
                    job.future.set_result(result)
                elif self._contaminated and not job.lease.valid:
                    caller_cancelled = await self._quarantine_until_quiescent(job)
                    if caller_cancelled or not self._accepting:
                        return
            finally:
                async with self._lock:
                    self._remove_job_locked(job)

    async def shutdown(self) -> None:
        error = weee_scraper.StoreScrapeError(
            "Store product lookups are shutting down."
        )
        async with self._lock:
            self._accepting = False
            self._interactive_streak = 0
            jobs = list(self._jobs.values())
            self._jobs.clear()
            self._interactive.clear()
            self._background.clear()
            worker = self._worker
            for job in jobs:
                job.lease.invalidate("shutdown")
                self._cancel_queue_watchdog(job)
                if not job.future.done():
                    job.future.set_exception(error)
            if worker is not None and not worker.done():
                worker.cancel()
        caller_cancelled = False
        shutdown_errors: list[BaseException] = []
        if worker is not None:
            try:
                await asyncio.wait_for(
                    asyncio.shield(worker),
                    timeout=LIVE_WORKER_SHUTDOWN_TIMEOUT_SECONDS,
                )
            except asyncio.CancelledError:
                current = asyncio.current_task()
                caller_cancelled = bool(current is not None and current.cancelling())
            except TimeoutError:
                logger.error("store product worker did not stop before shutdown deadline")
            except BaseException as exc:
                shutdown_errors.append(exc)
        try:
            await self._drain_detached_operations()
        except asyncio.CancelledError:
            current = asyncio.current_task()
            caller_cancelled = caller_cancelled or bool(
                current is not None and current.cancelling()
            )
        except BaseException as exc:
            shutdown_errors.append(exc)
        if worker is not None and worker.done():
            async with self._lock:
                if self._worker is worker:
                    self._worker = None
        if caller_cancelled:
            raise asyncio.CancelledError
        if len(shutdown_errors) == 1:
            raise shutdown_errors[0]
        if shutdown_errors:
            raise BaseExceptionGroup(
                "Store product live lookup shutdown failed.",
                shutdown_errors,
            )

    async def reset_for_tests(self) -> None:
        """Wait for an idle worker, then clear queue bookkeeping deterministically."""
        async with self._lock:
            if self._jobs:
                raise RuntimeError("Cannot reset live lookups while jobs are still running.")
            worker = self._worker
        if worker is not None:
            try:
                await asyncio.shield(worker)
            except asyncio.CancelledError:
                current = asyncio.current_task()
                if current is not None and current.cancelling():
                    raise
        async with self._lock:
            if self._jobs:
                raise RuntimeError("Cannot reset live lookups while jobs are still running.")
            self._interactive.clear()
            self._background.clear()
            self._worker = None
            self._interactive_streak = 0
            self._contaminated = False
            self._next_waiter_token = 1


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
    *,
    lease: _LiveJobLease | None = None,
) -> repo_store_cache.CachedStoreProducts:
    if lease is not None:
        lease.ensure_valid()
    maker = db_session.async_session_maker
    if maker is None:
        raise RuntimeError("Database session maker is not initialized.")
    async with maker() as write_session:
        commit_started = False
        try:
            winner = await repo_store_cache.upsert_cached_store_products(
                write_session, query=cache_query, store="weee", language=language,
                cache_version=CACHE_VERSION, data=products, updated_at=cached_at,
            )
            if winner is None:
                raise weee_scraper.StoreScrapeError(
                    "Store product cache write did not produce an authoritative winner."
                )
            if lease is not None:
                lease.ensure_valid()
            commit_started = True
            commit_task = asyncio.create_task(write_session.commit())
            caller_cancelled = False
            while not commit_task.done():
                try:
                    await asyncio.shield(commit_task)
                except asyncio.CancelledError:
                    caller_cancelled = True
            commit_task.result()
            if lease is not None:
                lease.ensure_valid()
            if caller_cancelled:
                raise asyncio.CancelledError
            return winner
        except BaseException:
            if not commit_started:
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
                database_age = _authoritative_cache_age_seconds(database)
                if database_products and database_age is not None:
                    _memory_cache_set_from_database_entry(
                        cache_key,
                        database_products,
                        database,
                        database_age,
                    )
                    winner = _memory_cache_get_with_metadata(cache_key)
                    if winner is not None:
                        _log_event(
                            "postgres_hit",
                            cache_key,
                            priority=priority,
                            started_at=started_at,
                            product_count=len(winner.products),
                        )
                        return winner
            memory = _memory_cache_get_with_metadata(cache_key)
            if memory is not None:
                _log_event("memory_hit", cache_key, priority=priority, started_at=started_at, product_count=len(memory.products))
                return memory

    if release_read_session_on_miss and session is not None:
        await session.close()

    _log_event("cache_miss", cache_key, priority=priority, started_at=started_at)

    async def scrape_and_persist(
        queue_wait_ms: float,
        selected_priority: LookupPriority,
        lease: _LiveJobLease,
    ) -> StoreProductsResult:
        scrape_started_at = time.perf_counter()
        try:
            raw_products = await weee_scraper.scrape_weee_products(prepared.query_text, prepared.language)
            lease.ensure_valid()
            products = weee_scraper.validate_products(raw_products)
            if not products:
                lease.ensure_valid()
                _log_event(
                    "scrape_empty",
                    cache_key,
                    priority=selected_priority,
                    started_at=scrape_started_at,
                    queue_wait_ms=queue_wait_ms,
                    product_count=0,
                )
                return StoreProductsResult(products=[], cached_at=None)
            cached_at = datetime.fromtimestamp(time.time(), tz=timezone.utc)
            lease.ensure_valid()
            winner = await _persist_positive_result(
                prepared.cache_query,
                prepared.language,
                products,
                cached_at,
                lease=lease,
            )
            lease.ensure_valid()
            winner_age = _authoritative_cache_age_seconds(winner)
            if winner_age is None:
                raise weee_scraper.StoreScrapeError(
                    "Store product cache winner has an invalid authoritative timestamp."
                )
            _memory_cache_set_from_database_entry(
                cache_key,
                winner.products,
                winner,
                winner_age,
            )
            lease.ensure_valid()
            published = _memory_cache_get_with_metadata(cache_key)
            if published is None:
                raise weee_scraper.StoreScrapeError(
                    "Store product cache winner could not be published safely."
                )
            _log_event(
                "scrape_success",
                cache_key,
                priority=selected_priority,
                started_at=scrape_started_at,
                queue_wait_ms=queue_wait_ms,
                product_count=len(published.products),
            )
            return published
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _log_event(
                "scrape_failure",
                cache_key,
                priority=selected_priority,
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
            database_age = _authoritative_cache_age_seconds(entry)
            if not products or database_age is None:
                continue
            _memory_cache_set_from_database_entry(
                ("weee", prepared.language, CACHE_VERSION, prepared.cache_query),
                products,
                entry,
                database_age,
            )
            winner = _memory_cache_get_with_metadata(
                ("weee", prepared.language, CACHE_VERSION, prepared.cache_query)
            )
            if winner is not None:
                fresh[key] = winner

    entries: list[BatchStoreProductsEntry] = []
    for key, prepared in prepared_by_key.items():
        result = fresh.get(key)
        if result is None:
            entries.append(BatchStoreProductsEntry(prepared.query_text, "missing", [], None))
        else:
            entries.append(BatchStoreProductsEntry(prepared.query_text, "fresh", result.products, result.cached_at))
    return entries
