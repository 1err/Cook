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
