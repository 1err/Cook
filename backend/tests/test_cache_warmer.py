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


@pytest.mark.asyncio
async def test_warmer_runs_two_queries_at_a_time_and_isolates_failures(
    monkeypatch: pytest.MonkeyPatch,
):
    queries = ["hit", "miss one", "failure", "miss two"]
    active = 0
    peak_active = 0
    completed: list[str] = []

    async def warm_query(
        query: str,
        *,
        force_refresh: bool = False,
    ) -> tuple[cache_warmer.WarmStatus, list[dict[str, str]]]:
        nonlocal active, peak_active
        assert force_refresh
        active += 1
        peak_active = max(peak_active, active)
        await asyncio.sleep(0)
        active -= 1
        if query == "failure":
            raise RuntimeError("controlled scrape failure")
        completed.append(query)
        return ("cache_hit" if query == "hit" else "cache_miss"), [PRODUCT]

    monkeypatch.setattr(cache_warmer, "ALL_QUERIES", queries)
    monkeypatch.setattr(cache_warmer, "warm_cache_query", warm_query)

    summary = await cache_warmer.run_cache_warmer(force_refresh=True)

    assert peak_active == 2
    assert completed == ["hit", "miss one", "miss two"]
    assert summary == {
        "cache_hit": 1,
        "cache_miss": 2,
        "skipped": 0,
        "failed": 1,
        "total": 4,
    }


def test_scheduler_runs_daily_force_refresh_and_starts_stale_only(
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
    assert startup_force_refresh == [False]


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
