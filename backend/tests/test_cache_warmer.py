import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest

from app.jobs import cache_warmer


PRODUCT = {
    "name": "Silken tofu",
    "price": "$2.99",
    "image": "https://images.example.test/tofu.jpg",
    "url": "https://www.sayweee.com/product/tofu",
}


@pytest.fixture(autouse=True)
async def reset_tracked_warmer():
    task = cache_warmer._warmer_task
    if task is not None and not task.done():
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    cache_warmer._warmer_task = None
    yield
    task = cache_warmer._warmer_task
    if task is not None and not task.done():
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    cache_warmer._warmer_task = None


@pytest.mark.asyncio
async def test_warmer_runs_queries_serially_at_background_priority_and_isolates_failures(
    monkeypatch: pytest.MonkeyPatch,
):
    active = 0
    peak = 0
    priorities: list[str] = []

    async def fetch(
        query: str,
        session: object | None = None,
        *,
        force_refresh: bool = False,
        priority: str = "interactive",
    ) -> list[dict[str, str]]:
        nonlocal active, peak
        priorities.append(priority)
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        if query == "failure":
            from app.services.weee_scraper import StoreScrapeError

            raise StoreScrapeError("controlled")
        return [] if query == "empty" else [PRODUCT]

    monkeypatch.setattr(cache_warmer, "ALL_QUERIES", ["one", "empty", "failure", "two"])
    monkeypatch.setattr(cache_warmer, "fetch_store_products", fetch)

    summary = await cache_warmer.run_cache_warmer(force_refresh=True)

    assert peak == 1
    assert priorities == ["background"] * 4
    assert summary == {
        "cache_hit": 0,
        "cache_miss": 2,
        "empty": 1,
        "skipped": 0,
        "failed": 1,
        "total": 4,
    }


def test_scheduler_runs_daily_force_refresh_without_a_startup_warming_sweep(
    monkeypatch: pytest.MonkeyPatch,
):
    jobs: list[tuple[Callable[[], Awaitable[None]], dict[str, Any]]] = []
    startup_force_refresh: list[bool] = []

    class RecordingScheduler:
        started = False

        def add_job(
            self,
            callback: Callable[[], Awaitable[None]],
            **kwargs: Any,
        ) -> None:
            jobs.append((callback, kwargs))

        def start(self) -> None:
            self.started = True

    def trigger(*, force_refresh: bool) -> dict[str, Any]:
        startup_force_refresh.append(force_refresh)
        return {"started": True, "status": {}}

    monkeypatch.setattr(cache_warmer, "AsyncIOScheduler", RecordingScheduler)
    monkeypatch.setattr(cache_warmer, "trigger_cache_warmer", trigger)
    monkeypatch.setattr(cache_warmer, "_scheduler", None)

    scheduler = cache_warmer.start_scheduler()

    assert scheduler.started
    assert len(jobs) == 1
    callback, options = jobs[0]
    assert callback is cache_warmer._run_scheduled_cache_warmer
    assert options["trigger"] == "interval"
    assert options["hours"] == 24
    assert options["max_instances"] == 1
    assert options["coalesce"] is True
    assert startup_force_refresh == []


@pytest.mark.asyncio
async def test_scheduled_warmer_force_refreshes_the_curated_queries(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[bool] = []

    async def run(*, force_refresh: bool) -> dict[str, int]:
        calls.append(force_refresh)
        return {}

    monkeypatch.setattr(cache_warmer, "run_cache_warmer", run)

    await cache_warmer._run_scheduled_cache_warmer()

    assert calls == [True]


@pytest.mark.asyncio
async def test_scheduled_start_during_manual_run_does_not_start_a_second_run(
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    release = asyncio.Event()
    calls: list[bool] = []

    async def run(*, force_refresh: bool) -> dict[str, int]:
        calls.append(force_refresh)
        started.set()
        await release.wait()
        return {"total": 0}

    monkeypatch.setattr(cache_warmer, "run_cache_warmer", run)
    assert cache_warmer.trigger_cache_warmer(force_refresh=False)["started"] is True
    await started.wait()

    await asyncio.wait_for(cache_warmer._run_scheduled_cache_warmer(), timeout=0.05)
    assert calls == [False]
    release.set()
    assert cache_warmer._warmer_task is not None
    await cache_warmer._warmer_task


@pytest.mark.asyncio
async def test_manual_start_during_scheduled_run_is_rejected_until_completion(
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    release = asyncio.Event()
    calls: list[bool] = []

    async def run(*, force_refresh: bool) -> dict[str, int]:
        calls.append(force_refresh)
        started.set()
        await release.wait()
        return {"total": 0}

    monkeypatch.setattr(cache_warmer, "run_cache_warmer", run)
    scheduled = asyncio.create_task(cache_warmer._run_scheduled_cache_warmer())
    await started.wait()

    trigger_result = cache_warmer.trigger_cache_warmer(force_refresh=False)
    release.set()
    await scheduled
    tracked = cache_warmer._warmer_task
    if tracked is not None:
        await tracked

    assert trigger_result["started"] is False
    assert calls == [True]

    follow_up_release = asyncio.Event()

    async def follow_up(*, force_refresh: bool) -> dict[str, int]:
        calls.append(force_refresh)
        follow_up_release.set()
        return {"total": 0}

    monkeypatch.setattr(cache_warmer, "run_cache_warmer", follow_up)
    assert cache_warmer.trigger_cache_warmer(force_refresh=False)["started"] is True
    await follow_up_release.wait()
    assert cache_warmer._warmer_task is not None
    await cache_warmer._warmer_task
    assert calls == [True, False]


@pytest.mark.asyncio
async def test_shutdown_cancels_and_awaits_the_tracked_warmer(
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def run(*, force_refresh: bool) -> dict[str, int]:
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(cache_warmer, "run_cache_warmer", run)
    cache_warmer.trigger_cache_warmer(force_refresh=True)
    await started.wait()

    await cache_warmer.shutdown_cache_warmer()

    assert cancelled.is_set()
    assert cache_warmer._warmer_task is None
