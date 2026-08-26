import asyncio
from datetime import datetime, timedelta, timezone
import logging
from typing import Any, Callable
from urllib.parse import quote_plus

import httpx
import pytest
from fastapi import FastAPI

from app.db import repo_store_cache
from app.db import session as db_session
from app.main import health
from app.services import store_product_service as service
from app.services import weee_scraper


GARLIC = {"name": "Garlic", "price": "$1.00", "image": "", "url": "https://www.weee.com/en/product/garlic/1"}
GINGER = {"name": "姜", "price": "$1.00", "image": "", "url": "https://www.weee.com/en/product/%E5%A7%9C/1"}
STALE_PRODUCT = {"name": "Old Garlic", "price": "$0.50", "image": "", "url": "https://www.weee.com/en/product/old-garlic/1"}
TOFU = {"name": "Silken tofu", "price": "$2.99", "image": "", "url": "https://www.weee.com/en/product/tofu/1"}


async def async_none(*args: Any, **kwargs: Any) -> None:
    return None


async def async_noop(*args: Any, **kwargs: Any) -> None:
    return None


async def async_typed_failure(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
    raise weee_scraper.StoreScrapeError("controlled upstream failure")


def async_return(value: Any):
    async def result(*args: Any, **kwargs: Any) -> Any:
        return value
    return result


def product_for(query: str) -> dict[str, str]:
    slug = quote_plus(query.casefold())
    return {"name": query, "price": "$1.00", "image": "", "url": f"https://www.weee.com/en/product/{slug}/1"}


async def wait_until(predicate: Callable[[], bool]) -> None:
    for _ in range(100):
        if predicate():
            return
        await asyncio.sleep(0)
    raise AssertionError("condition did not become true")


def cached(products: list[dict[str, str]]) -> repo_store_cache.CachedStoreProducts:
    return repo_store_cache.CachedStoreProducts(products, datetime(2026, 8, 27, tzinfo=timezone.utc))


@pytest.fixture(autouse=True)
async def clear_service_cache():
    await service.reset_for_tests()
    start_admission = getattr(service, "start_live_lookup_admission", None)
    if start_admission is not None:
        start_admission()
    service.CACHE.clear()
    yield
    service.CACHE.clear()
    if start_admission is not None:
        start_admission()
    await service.reset_for_tests()


def test_prepare_store_query_only_performs_mechanical_cleanup():
    assert service.prepare_store_query("  Two   cloves Garlic  ") == service.PreparedStoreQuery(
        query_text="Two cloves Garlic", cache_query="two cloves garlic", language="en"
    )
    assert service.prepare_store_query("新鲜  大蒜") == service.PreparedStoreQuery(
        query_text="新鲜 大蒜", cache_query="新鲜 大蒜", language="zh"
    )


def test_cache_entry_is_fresh_strictly_before_twenty_four_hours():
    now = datetime(2026, 8, 27, tzinfo=timezone.utc)
    assert repo_store_cache.is_cache_entry_fresh(now - timedelta(seconds=86_399), now, 86_400)
    assert not repo_store_cache.is_cache_entry_fresh(now - timedelta(seconds=86_400), now, 86_400)


@pytest.mark.asyncio
async def test_expired_refresh_failure_never_returns_stale_products(monkeypatch):
    service.CACHE[("weee", "en", service.CACHE_VERSION, "garlic")] = {
        "data": [STALE_PRODUCT], "timestamp": 0,
    }
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", async_none)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_typed_failure)

    with pytest.raises(weee_scraper.StoreScrapeError):
        await service.fetch_store_products("garlic", session=object())


@pytest.mark.asyncio
async def test_expired_l1_entry_is_replaced_by_a_live_result(monkeypatch):
    fresh = {"name": "Fresh garlic", "price": "$3.00", "image": "", "url": "https://www.weee.com/en/product/fresh-garlic/1"}
    service.CACHE[("weee", "en", service.CACHE_VERSION, "garlic")] = {
        "data": [STALE_PRODUCT], "timestamp": 0,
    }
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", async_none)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_return([fresh]))
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    assert await service.fetch_store_products("garlic", session=object()) == [fresh]
    assert service._memory_cache_get(("weee", "en", service.CACHE_VERSION, "garlic")) == [fresh]


@pytest.mark.asyncio
async def test_fresh_memory_hit_skips_database_and_scrape(monkeypatch):
    service._memory_cache_set(("weee", "en", service.CACHE_VERSION, "silken tofu"), [TOFU])

    async def unexpected_database(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("a fresh memory result must skip PostgreSQL")

    async def unexpected_scrape(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        raise AssertionError("a fresh memory result must skip scraping")

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", unexpected_database)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", unexpected_scrape)
    assert await service.fetch_store_products("silken tofu", session=object()) == [TOFU]


@pytest.mark.asyncio
async def test_l1_and_l2_hits_preserve_the_original_cache_timestamp(monkeypatch):
    cached_at = datetime(2026, 8, 27, 12, tzinfo=timezone.utc)
    clock = {"seconds": cached_at.timestamp() + 120}
    memory_key = ("weee", "en", service.CACHE_VERSION, "silken tofu")
    monkeypatch.setattr(service.time, "time", lambda: clock["seconds"])
    service._memory_cache_set(memory_key, [TOFU], timestamp=cached_at.timestamp())
    memory_result = await service.fetch_store_products_with_metadata("silken tofu", session=object())
    assert memory_result == service.StoreProductsResult([TOFU], cached_at)

    service.CACHE.clear()

    async def database_hit(*args: Any, **kwargs: Any) -> Any:
        return repo_store_cache.CachedStoreProducts([TOFU], cached_at)

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_hit)
    database_result = await service.fetch_store_products_with_metadata("silken tofu", session=object())
    assert database_result == service.StoreProductsResult([TOFU], cached_at)
    assert service.CACHE[memory_key]["timestamp"] == cached_at.timestamp()


@pytest.mark.asyncio
async def test_postgresql_hit_warms_l1_and_skips_a_second_database_read(monkeypatch):
    database_calls = 0

    async def database_hit(*args: Any, **kwargs: Any) -> Any:
        nonlocal database_calls
        database_calls += 1
        return repo_store_cache.CachedStoreProducts([TOFU], datetime.now(timezone.utc))

    async def unexpected_scrape(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        raise AssertionError("a fresh PostgreSQL result must skip scraping")

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_hit)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", unexpected_scrape)
    assert await service.fetch_store_products("silken tofu", session=object()) == [TOFU]
    assert await service.fetch_store_products("silken tofu", session=object()) == [TOFU]
    assert database_calls == 1


@pytest.mark.asyncio
async def test_l2_miss_rechecks_l1_before_submitting_a_live_job(monkeypatch):
    database_started = asyncio.Event()
    release_database = asyncio.Event()
    database_calls = 0
    scrape_calls = 0

    async def database_miss(*args: Any, **kwargs: Any) -> None:
        nonlocal database_calls
        database_calls += 1
        if database_calls == 1:
            database_started.set()
            await release_database.wait()
        return None

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        nonlocal scrape_calls
        scrape_calls += 1
        return [TOFU]

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_miss)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    delayed = asyncio.create_task(service.fetch_store_products("silken tofu", session=object()))
    await database_started.wait()
    assert await service.fetch_store_products("SILKEN TOFU", session=object()) == [TOFU]
    release_database.set()
    assert await delayed == [TOFU]
    assert database_calls == 2
    assert scrape_calls == 1


@pytest.mark.asyncio
async def test_delayed_older_l2_hit_cannot_replace_or_return_over_newer_l1(monkeypatch):
    database_started = asyncio.Event()
    release_database = asyncio.Event()
    now = datetime(2026, 8, 27, 12, tzinfo=timezone.utc)
    older = now - timedelta(minutes=5)
    newer_product = {**TOFU, "price": "$9.99"}
    older_product = {**TOFU, "price": "$1.99"}
    key = ("weee", "en", service.CACHE_VERSION, "silken tofu")
    monkeypatch.setattr(service.time, "time", lambda: now.timestamp())

    async def delayed_database_hit(*args: Any, **kwargs: Any) -> Any:
        database_started.set()
        await release_database.wait()
        return repo_store_cache.CachedStoreProducts([older_product], older)

    monkeypatch.setattr(
        repo_store_cache,
        "get_cached_store_products_with_metadata",
        delayed_database_hit,
    )
    lookup = asyncio.create_task(
        service.fetch_store_products_with_metadata("silken tofu", session=object())
    )
    await database_started.wait()
    service._memory_cache_set(key, [newer_product], timestamp=now.timestamp())
    release_database.set()

    assert await lookup == service.StoreProductsResult([newer_product], now)
    assert service._memory_cache_get_with_metadata(key) == service.StoreProductsResult(
        [newer_product], now
    )


@pytest.mark.asyncio
async def test_opt_in_read_session_is_released_before_waiting_for_live_work(monkeypatch):
    scrape_started = asyncio.Event()
    release_scrape = asyncio.Event()

    class ReadSession:
        def __init__(self) -> None:
            self.closed = False

        async def close(self) -> None:
            self.closed = True

    session = ReadSession()

    async def database_miss(observed_session: object, **kwargs: Any) -> None:
        assert observed_session is session
        return None

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        assert session.closed
        scrape_started.set()
        await release_scrape.wait()
        return [TOFU]

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_miss)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    task = asyncio.create_task(
        service.fetch_store_products(
            "tofu",
            session=session,  # type: ignore[arg-type]
            release_read_session_on_miss=True,
        )
    )
    await scrape_started.wait()
    assert session.closed
    release_scrape.set()
    assert await task == [TOFU]


@pytest.mark.asyncio
async def test_default_service_contract_never_closes_a_caller_owned_session(monkeypatch):
    class ReadSession:
        close_calls = 0

        async def close(self) -> None:
            self.close_calls += 1

    session = ReadSession()
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", async_none)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_return([TOFU]))
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    assert await service.fetch_store_products(
        "tofu",
        session=session,  # type: ignore[arg-type]
    ) == [TOFU]
    assert session.close_calls == 0


@pytest.mark.asyncio
async def test_near_expiry_l2_hit_does_not_extend_l1_freshness(monkeypatch):
    clock = {"seconds": 1_000_000.0}
    database_calls = 0
    scrape_calls = 0
    cached_at = datetime.fromtimestamp(clock["seconds"] - 86_399, tz=timezone.utc)
    cached_product = {"name": "Cached tofu", "price": "$2.99", "image": "", "url": "https://www.weee.com/en/product/cached-tofu/1"}
    fresh_product = {"name": "Fresh tofu", "price": "$3.99", "image": "", "url": "https://www.weee.com/en/product/fresh-tofu/1"}

    async def database_hit(*args: Any, **kwargs: Any) -> Any:
        nonlocal database_calls
        database_calls += 1
        if clock["seconds"] < 1_000_001:
            return repo_store_cache.CachedStoreProducts([cached_product], cached_at)
        return None

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        nonlocal scrape_calls
        scrape_calls += 1
        return [fresh_product]

    monkeypatch.setattr(service.time, "time", lambda: clock["seconds"])
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_hit)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    assert await service.fetch_store_products("silken tofu", session=object()) == [cached_product]
    clock["seconds"] = 1_000_002.0
    assert await service.fetch_store_products("silken tofu", session=object()) == [fresh_product]
    assert (database_calls, scrape_calls) == (2, 1)


@pytest.mark.asyncio
async def test_distinct_misses_never_run_more_than_one_live_scrape(monkeypatch):
    active = 0
    peak = 0

    async def scrape(query_text, language):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        return [product_for(query_text)]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    await asyncio.gather(*[
        service.fetch_store_products(f"ingredient {index}", force_refresh=True)
        for index in range(8)
    ])
    assert peak == 1


@pytest.mark.asyncio
async def test_interactive_job_precedes_next_background_job(monkeypatch):
    started = []
    first_release = asyncio.Event()

    async def scrape(query_text, language):
        started.append(query_text)
        if query_text == "warm one":
            await first_release.wait()
        return [product_for(query_text)]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    first = asyncio.create_task(service.fetch_store_products("warm one", force_refresh=True, priority="background"))
    await wait_until(lambda: started == ["warm one"])
    second = asyncio.create_task(service.fetch_store_products("warm two", force_refresh=True, priority="background"))
    user = asyncio.create_task(service.fetch_store_products("garlic", force_refresh=True, priority="interactive"))
    first_release.set()
    await asyncio.gather(first, second, user)
    assert started == ["warm one", "garlic", "warm two"]


@pytest.mark.asyncio
async def test_invalid_priority_fails_immediately_even_for_an_l1_hit(monkeypatch):
    service._memory_cache_set(
        ("weee", "en", service.CACHE_VERSION, "tofu"),
        [TOFU],
    )
    with pytest.raises(ValueError, match="priority"):
        await service.fetch_store_products(
            "tofu",
            priority="urgent",  # type: ignore[arg-type]
        )


@pytest.mark.asyncio
async def test_background_work_ages_past_a_sustained_interactive_burst(monkeypatch):
    started: list[str] = []
    release_first = asyncio.Event()

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.append(query_text)
        if query_text == "warm running":
            await release_first.wait()
        return [product_for(query_text)]

    monkeypatch.setattr(service, "MAX_INTERACTIVE_BURST", 2)
    monkeypatch.setattr(service, "BACKGROUND_MAX_WAIT_SECONDS", 60.0)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    running = asyncio.create_task(
        service.fetch_store_products(
            "warm running",
            force_refresh=True,
            priority="background",
        )
    )
    await wait_until(lambda: started == ["warm running"])
    waiting = asyncio.create_task(
        service.fetch_store_products(
            "warm waiting",
            force_refresh=True,
            priority="background",
        )
    )
    interactive = [
        asyncio.create_task(
            service.fetch_store_products(
                f"interactive {index}",
                force_refresh=True,
                priority="interactive",
            )
        )
        for index in range(4)
    ]
    await asyncio.sleep(0)
    release_first.set()
    await asyncio.gather(running, waiting, *interactive)

    assert started[:4] == [
        "warm running",
        "interactive 0",
        "interactive 1",
        "warm waiting",
    ]


@pytest.mark.asyncio
async def test_interactive_history_without_a_waiting_background_does_not_spend_burst(
    monkeypatch,
):
    started: list[str] = []
    active_started = asyncio.Event()
    release_active = asyncio.Event()

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.append(query_text)
        if query_text == "active":
            active_started.set()
            await release_active.wait()
        return [product_for(query_text)]

    monkeypatch.setattr(service, "MAX_INTERACTIVE_BURST", 2)
    monkeypatch.setattr(service, "BACKGROUND_MAX_WAIT_SECONDS", 60.0)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    for index in range(3):
        await service.fetch_store_products(
            f"earlier {index}",
            force_refresh=True,
            priority="interactive",
        )
    active = asyncio.create_task(
        service.fetch_store_products("active", force_refresh=True, priority="interactive")
    )
    await active_started.wait()
    background = asyncio.create_task(
        service.fetch_store_products("warm", force_refresh=True, priority="background")
    )
    user = asyncio.create_task(
        service.fetch_store_products("user", force_refresh=True, priority="interactive")
    )
    await asyncio.sleep(0)
    release_active.set()
    await asyncio.gather(active, background, user)

    assert started[-3:] == ["active", "user", "warm"]


@pytest.mark.asyncio
async def test_hung_live_operation_times_out_fails_queued_then_recovers(monkeypatch):
    hung_started = asyncio.Event()
    started: list[str] = []

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.append(query_text)
        if query_text == "hung":
            hung_started.set()
            await asyncio.Event().wait()
        return [product_for(query_text)]

    monkeypatch.setattr(service, "LIVE_OPERATION_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(service, "LIVE_FRONT_DOOR_TIMEOUT_SECONDS", 0.5)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    hung = asyncio.create_task(service.fetch_store_products("hung", force_refresh=True))
    await hung_started.wait()
    next_job = asyncio.create_task(service.fetch_store_products("next", force_refresh=True))

    with pytest.raises(weee_scraper.StoreScrapeError, match="timed out"):
        await hung
    with pytest.raises(weee_scraper.StoreScrapeError, match="temporarily unavailable"):
        await next_job
    await wait_until(lambda: service._live_lookups._worker is None)
    assert await service.fetch_store_products("recovered", force_refresh=True) == [
        product_for("recovered")
    ]
    assert started == ["hung", "recovered"]


@pytest.mark.asyncio
async def test_cancellation_resistant_live_operation_quarantines_the_serial_lane(monkeypatch, caplog):
    hung_started = asyncio.Event()
    cancelled = asyncio.Event()
    release_abandoned = asyncio.Event()
    started: list[str] = []
    active = 0
    peak_active = 0

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        nonlocal active, peak_active
        started.append(query_text)
        active += 1
        peak_active = max(peak_active, active)
        try:
            if query_text == "hung":
                hung_started.set()
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    await release_abandoned.wait()
            return [product_for(query_text)]
        finally:
            active -= 1

    monkeypatch.setattr(service, "LIVE_OPERATION_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(service, "LIVE_FRONT_DOOR_TIMEOUT_SECONDS", 0.1)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    caplog.set_level(logging.INFO, logger=service.__name__)

    hung = asyncio.create_task(service.fetch_store_products("hung", force_refresh=True))
    await hung_started.wait()
    next_job = asyncio.create_task(service.fetch_store_products("next", force_refresh=True))
    try:
        with pytest.raises(weee_scraper.StoreScrapeError, match="timed out"):
            await hung
        with pytest.raises(weee_scraper.StoreScrapeError, match="temporarily unavailable"):
            await asyncio.wait_for(next_job, timeout=0.05)
        assert cancelled.is_set()
        assert started == ["hung"]
        assert peak_active == 1
        with pytest.raises(weee_scraper.StoreScrapeError, match="temporarily unavailable"):
            await service.fetch_store_products("rejected", force_refresh=True)
        timeout_record = next(
            record
            for record in caplog.records
            if getattr(record, "event", None) == "store_products_live_timeout"
        )
        assert timeout_record.priority == "interactive"
        assert timeout_record.queue_wait_ms >= 0
    finally:
        release_abandoned.set()
        await wait_until(lambda: service._live_lookups._worker is None)

    assert await service.fetch_store_products("recovered", force_refresh=True) == [
        product_for("recovered")
    ]
    assert started == ["hung", "recovered"]
    assert peak_active == 1


@pytest.mark.asyncio
async def test_timed_out_cancellation_resistant_persistence_cannot_publish_l1(monkeypatch):
    persistence_started = asyncio.Event()
    persistence_cancelled = asyncio.Event()
    release_persistence = asyncio.Event()
    started: list[str] = []

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.append(query_text)
        return [product_for(query_text)]

    async def resistant_persist(*args: Any, **kwargs: Any) -> None:
        persistence_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            persistence_cancelled.set()
            await release_persistence.wait()

    monkeypatch.setattr(service, "LIVE_OPERATION_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(service, "LIVE_FRONT_DOOR_TIMEOUT_SECONDS", 0.2)
    monkeypatch.setattr(service, "LIVE_DETACHED_DRAIN_TIMEOUT_SECONDS", 0.01, raising=False)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", resistant_persist)

    timed_out = asyncio.create_task(
        service.fetch_store_products("late", force_refresh=True)
    )
    await persistence_started.wait()
    try:
        with pytest.raises(weee_scraper.StoreScrapeError, match="timed out"):
            await timed_out
        assert persistence_cancelled.is_set()
        assert service._live_lookups._detached_operations

        monkeypatch.setattr(service, "_persist_positive_result", async_noop)
        with pytest.raises(weee_scraper.StoreScrapeError, match="temporarily unavailable"):
            await service.fetch_store_products("next", force_refresh=True)
    finally:
        release_persistence.set()
        await wait_until(lambda: service._live_lookups._worker is None)

    await wait_until(lambda: not service._live_lookups._detached_operations)
    assert await service.fetch_store_products("recovered", force_refresh=True) == [
        product_for("recovered")
    ]
    late_key = ("weee", "en", service.CACHE_VERSION, "late")
    assert service._memory_cache_get(late_key) is None
    assert started == ["late", "recovered"]


@pytest.mark.asyncio
async def test_shutdown_tracks_and_boundedly_drains_resistant_operations(monkeypatch):
    started = asyncio.Event()
    cancelled = asyncio.Event()
    release = asyncio.Event()

    async def resistant_scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            while not release.is_set():
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    continue
        return [TOFU]

    monkeypatch.setattr(service, "LIVE_DETACHED_DRAIN_TIMEOUT_SECONDS", 0.01, raising=False)
    monkeypatch.setattr(service, "LIVE_WORKER_SHUTDOWN_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", resistant_scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    lookup = asyncio.create_task(service.fetch_store_products("tofu", force_refresh=True))
    await started.wait()
    try:
        await service.shutdown_live_lookups()

        assert cancelled.is_set()
        assert service._live_lookups._worker is not None
        assert service._live_lookups._detached_operations
        with pytest.raises(weee_scraper.StoreScrapeError, match="shutting down"):
            await lookup
    finally:
        release.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await asyncio.gather(lookup, return_exceptions=True)
    await wait_until(
        lambda: service._live_lookups._worker is None
        and not service._live_lookups._detached_operations
    )
    assert service._memory_cache_get(
        ("weee", "en", service.CACHE_VERSION, "tofu")
    ) is None
    await service.shutdown_live_lookups()


@pytest.mark.asyncio
async def test_self_cancelled_live_child_is_typed_failure_and_worker_recovers(monkeypatch):
    calls: list[str] = []

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        calls.append(query_text)
        if query_text == "cancelled":
            raise asyncio.CancelledError
        return [product_for(query_text)]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    with pytest.raises(weee_scraper.StoreScrapeError, match="cancelled"):
        await service.fetch_store_products("cancelled", force_refresh=True)
    await wait_until(lambda: service._live_lookups._worker is None)
    assert await service.fetch_store_products("next", force_refresh=True) == [
        product_for("next")
    ]
    assert calls == ["cancelled", "next"]


@pytest.mark.asyncio
async def test_expired_queued_job_settles_and_a_newer_job_runs(monkeypatch, caplog):
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    started: list[str] = []

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.append(query_text)
        if query_text == "first":
            first_started.set()
            await release_first.wait()
        return [product_for(query_text)]

    monkeypatch.setattr(service, "LIVE_QUEUE_MAX_WAIT_SECONDS", 0.02)
    monkeypatch.setattr(service, "LIVE_FRONT_DOOR_TIMEOUT_SECONDS", 1.0)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    caplog.set_level(logging.INFO, logger=service.__name__)

    first = asyncio.create_task(service.fetch_store_products("first", force_refresh=True))
    await first_started.wait()
    expired = asyncio.create_task(service.fetch_store_products("expired", force_refresh=True))
    await asyncio.sleep(0.03)
    newer = asyncio.create_task(service.fetch_store_products("newer", force_refresh=True))
    release_first.set()

    assert await first == [product_for("first")]
    with pytest.raises(weee_scraper.StoreScrapeError, match="queue"):
        await expired
    assert await newer == [product_for("newer")]
    assert started == ["first", "newer"]
    expired_log = next(
        record
        for record in caplog.records
        if getattr(record, "event", None) == "queue_expired"
        and getattr(record, "query", None) == "expired"
    )
    assert expired_log.priority == "interactive"
    assert expired_log.queue_wait_ms >= 20.0


@pytest.mark.asyncio
async def test_queue_watchdog_expires_a_job_while_active_lane_is_still_running(monkeypatch):
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    started: list[str] = []

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.append(query_text)
        if query_text == "first":
            first_started.set()
            await release_first.wait()
        return [product_for(query_text)]

    monkeypatch.setattr(service, "LIVE_QUEUE_MAX_WAIT_SECONDS", 0.01)
    monkeypatch.setattr(service, "LIVE_OPERATION_TIMEOUT_SECONDS", 1.0)
    monkeypatch.setattr(service, "LIVE_FRONT_DOOR_TIMEOUT_SECONDS", 1.0)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    first = asyncio.create_task(service.fetch_store_products("first", force_refresh=True))
    await first_started.wait()
    queued = asyncio.create_task(service.fetch_store_products("queued", force_refresh=True))
    try:
        with pytest.raises(weee_scraper.StoreScrapeError, match="queue"):
            await asyncio.wait_for(queued, timeout=0.05)
        assert started == ["first"]
    finally:
        release_first.set()
        await first


@pytest.mark.asyncio
async def test_front_door_expiry_removes_unstarted_job_with_no_waiters(monkeypatch):
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    started: list[str] = []

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.append(query_text)
        if query_text == "first":
            first_started.set()
            await release_first.wait()
        return [product_for(query_text)]

    monkeypatch.setattr(service, "LIVE_FRONT_DOOR_TIMEOUT_SECONDS", 1.0)
    monkeypatch.setattr(service, "LIVE_OPERATION_TIMEOUT_SECONDS", 1.0)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    first = asyncio.create_task(service.fetch_store_products("first", force_refresh=True))
    await first_started.wait()
    monkeypatch.setattr(service, "LIVE_FRONT_DOOR_TIMEOUT_SECONDS", 0.02)
    abandoned = asyncio.create_task(
        service.fetch_store_products("abandoned", force_refresh=True)
    )
    try:
        with pytest.raises(weee_scraper.StoreScrapeError, match="front door"):
            await abandoned

        abandoned_key = ("weee", "en", service.CACHE_VERSION, "abandoned")
        assert abandoned_key not in service._live_lookups._jobs
    finally:
        release_first.set()
        first_result = (await asyncio.gather(first, return_exceptions=True))[0]
    assert first_result == [product_for("first")]
    assert started == ["first"]


@pytest.mark.asyncio
async def test_front_door_timeout_invalidates_active_job_before_late_l1_publication(
    monkeypatch,
):
    started = asyncio.Event()
    cancelled = asyncio.Event()
    release = asyncio.Event()

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.set()
        try:
            await release.wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(service, "LIVE_FRONT_DOOR_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(service, "LIVE_OPERATION_TIMEOUT_SECONDS", 1.0)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    lookup = asyncio.create_task(service.fetch_store_products("tofu", force_refresh=True))
    await started.wait()
    try:
        with pytest.raises(weee_scraper.StoreScrapeError, match="front door"):
            await lookup
        await asyncio.wait_for(cancelled.wait(), timeout=0.05)
    finally:
        release.set()
    await wait_until(lambda: service._live_lookups._worker is None)

    key = ("weee", "en", service.CACHE_VERSION, "tofu")
    assert service._memory_cache_get(key) is None


@pytest.mark.asyncio
async def test_front_door_timeout_does_not_cancel_a_same_key_flight(monkeypatch):
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return [TOFU]

    monkeypatch.setattr(service, "LIVE_FRONT_DOOR_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(service, "LIVE_OPERATION_TIMEOUT_SECONDS", 1.0)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)

    timed_out = asyncio.create_task(service.fetch_store_products("tofu", force_refresh=True))
    await started.wait()
    monkeypatch.setattr(service, "LIVE_FRONT_DOOR_TIMEOUT_SECONDS", 1.0)
    follower = asyncio.create_task(service.fetch_store_products(" TOFU ", force_refresh=True))
    with pytest.raises(weee_scraper.StoreScrapeError, match="front door"):
        await timed_out

    release.set()
    assert await follower == [TOFU]
    assert calls == 1


@pytest.mark.asyncio
async def test_shutdown_caller_cancellation_is_propagated_and_worker_reference_retained(
    monkeypatch,
):
    coordinator = service._LiveLookupCoordinator()
    worker_started = asyncio.Event()
    worker_cancelled = asyncio.Event()
    release_worker = asyncio.Event()

    async def resistant_worker() -> None:
        worker_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            worker_cancelled.set()
            while not release_worker.is_set():
                try:
                    await release_worker.wait()
                except asyncio.CancelledError:
                    continue

    monkeypatch.setattr(service, "LIVE_WORKER_SHUTDOWN_TIMEOUT_SECONDS", 1.0)
    worker = asyncio.create_task(resistant_worker())
    coordinator._worker = worker
    await worker_started.wait()

    shutdown = asyncio.create_task(coordinator.shutdown())
    await worker_cancelled.wait()
    shutdown.cancel()
    try:
        with pytest.raises(asyncio.CancelledError):
            await shutdown

        assert coordinator._worker is worker
        assert not worker.done()
    finally:
        release_worker.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
    await worker
    await coordinator.shutdown()
    assert coordinator._worker is None


@pytest.mark.asyncio
async def test_shutdown_drains_detached_operations_before_propagating_worker_error():
    coordinator = service._LiveLookupCoordinator()
    detached_cancelled = asyncio.Event()

    async def detached_operation() -> service.StoreProductsResult:
        try:
            await asyncio.Event().wait()
        finally:
            detached_cancelled.set()

    async def failed_worker() -> None:
        raise RuntimeError("worker failed")

    detached = asyncio.create_task(detached_operation())
    coordinator._track_detached_operation(detached)
    worker = asyncio.create_task(failed_worker())
    coordinator._worker = worker
    await asyncio.sleep(0)

    try:
        with pytest.raises(RuntimeError, match="worker failed"):
            await coordinator.shutdown()

        assert detached_cancelled.is_set()
        assert detached.done()
        assert not coordinator._detached_operations
        assert coordinator._worker is None
    finally:
        detached.cancel()
        await asyncio.gather(detached, return_exceptions=True)


@pytest.mark.asyncio
async def test_shutdown_settles_active_and_queued_jobs_and_rejects_admission(monkeypatch):
    active_started = asyncio.Event()
    cancelled = asyncio.Event()
    started: list[str] = []

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.append(query_text)
        if query_text == "active":
            active_started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise
        return [product_for(query_text)]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    active = asyncio.create_task(service.fetch_store_products("active", force_refresh=True))
    await active_started.wait()
    queued = asyncio.create_task(service.fetch_store_products("queued", force_refresh=True))
    await asyncio.sleep(0)

    await service.shutdown_live_lookups()
    results = await asyncio.gather(active, queued, return_exceptions=True)

    assert all(isinstance(result, weee_scraper.StoreScrapeError) for result in results)
    assert cancelled.is_set()
    assert started == ["active"]
    with pytest.raises(weee_scraper.StoreScrapeError, match="shutting down"):
        await service.fetch_store_products("rejected", force_refresh=True)

    service.start_live_lookup_admission()
    assert await service.fetch_store_products("recovered", force_refresh=True) == [
        product_for("recovered")
    ]


@pytest.mark.asyncio
async def test_queue_wait_telemetry_records_real_wait_time(monkeypatch, caplog):
    first_started = asyncio.Event()
    release = asyncio.Event()

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        if query_text == "first":
            first_started.set()
            await release.wait()
        return [product_for(query_text)]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    caplog.set_level(logging.INFO, logger=service.__name__)
    first = asyncio.create_task(service.fetch_store_products("first", force_refresh=True))
    await first_started.wait()
    second = asyncio.create_task(service.fetch_store_products("second", force_refresh=True))
    await asyncio.sleep(0.01)
    release.set()
    await asyncio.gather(first, second)

    second_success = next(
        record
        for record in caplog.records
        if getattr(record, "event", None) == "scrape_success"
        and getattr(record, "query", None) == "second"
    )
    assert second_success.queue_wait_ms >= 5.0


@pytest.mark.asyncio
async def test_promoted_job_logs_the_selected_interactive_priority(monkeypatch, caplog):
    first_started = asyncio.Event()
    release = asyncio.Event()

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        if query_text == "first":
            first_started.set()
            await release.wait()
        return [product_for(query_text)]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    caplog.set_level(logging.INFO, logger=service.__name__)

    first = asyncio.create_task(service.fetch_store_products("first", force_refresh=True))
    await first_started.wait()
    background = asyncio.create_task(
        service.fetch_store_products(
            "promoted",
            force_refresh=True,
            priority="background",
        )
    )
    await asyncio.sleep(0)
    interactive = asyncio.create_task(
        service.fetch_store_products(
            "PROMOTED",
            force_refresh=True,
            priority="interactive",
        )
    )
    release.set()
    await asyncio.gather(first, background, interactive)

    success = next(
        record
        for record in caplog.records
        if getattr(record, "event", None) == "scrape_success"
        and getattr(record, "query", None) == "promoted"
    )
    assert success.priority == "interactive"
    assert success.queue_wait_ms >= 0


@pytest.mark.asyncio
async def test_fairness_state_resets_on_shutdown_and_start():
    coordinator = service._LiveLookupCoordinator()
    coordinator._interactive_streak = service.MAX_INTERACTIVE_BURST

    await coordinator.shutdown()
    assert coordinator._interactive_streak == 0

    coordinator._interactive_streak = service.MAX_INTERACTIVE_BURST
    coordinator.start_admission()
    assert coordinator._interactive_streak == 0


def test_fairness_streak_resets_at_idle_and_fresh_work_prefers_interactive():
    coordinator = service._LiveLookupCoordinator()
    loop = asyncio.new_event_loop()

    async def operation(
        queue_wait_ms: float,
        priority: service.LookupPriority,
        lease: service._LiveJobLease,
    ) -> service.StoreProductsResult:
        return service.StoreProductsResult([TOFU], datetime.now(timezone.utc))

    def queued(name: str, priority: service.LookupPriority) -> service._QueuedJob:
        key = ("weee", "en", service.CACHE_VERSION, name)
        return service._QueuedJob(
            key,
            operation,
            loop.create_future(),
            priority,
            100.0,
            service._LiveJobLease(1),
        )

    try:
        coordinator._interactive_streak = service.MAX_INTERACTIVE_BURST
        assert coordinator._choose_next(100.0) is None
        assert coordinator._interactive_streak == 0

        background = queued("background", "background")
        interactive = queued("interactive", "interactive")
        coordinator._jobs[background.key] = background
        coordinator._jobs[interactive.key] = interactive
        coordinator._background.append(background)
        coordinator._interactive.append(interactive)

        assert coordinator._choose_next(100.0) is interactive
    finally:
        loop.close()


def test_removing_last_background_and_quarantine_clear_reset_fairness_streak():
    coordinator = service._LiveLookupCoordinator()
    loop = asyncio.new_event_loop()
    futures: list[asyncio.Future[service.StoreProductsResult]] = []

    async def operation(
        queue_wait_ms: float,
        priority: service.LookupPriority,
        lease: service._LiveJobLease,
    ) -> service.StoreProductsResult:
        return service.StoreProductsResult([TOFU], datetime.now(timezone.utc))

    def queued(name: str, priority: service.LookupPriority) -> service._QueuedJob:
        key = ("weee", "en", service.CACHE_VERSION, name)
        future: asyncio.Future[service.StoreProductsResult] = loop.create_future()
        futures.append(future)
        return service._QueuedJob(
            key,
            operation,
            future,
            priority,
            100.0,
            service._LiveJobLease(1),
        )

    try:
        background = queued("old background", "background")
        coordinator._jobs[background.key] = background
        coordinator._background.append(background)
        coordinator._interactive_streak = service.MAX_INTERACTIVE_BURST
        coordinator._remove_job_locked(background)
        assert coordinator._interactive_streak == 0

        active = queued("active", "interactive")
        queued_background = queued("queued background", "background")
        coordinator._jobs[active.key] = active
        coordinator._jobs[queued_background.key] = queued_background
        coordinator._background.append(queued_background)
        coordinator._interactive_streak = service.MAX_INTERACTIVE_BURST
        coordinator._fail_queued_for_quarantine_locked(active)
        assert coordinator._interactive_streak == 0
    finally:
        for future in futures:
            if future.done() and not future.cancelled():
                future.exception()
            elif not future.done():
                future.cancel()
        loop.close()


@pytest.mark.asyncio
async def test_duplicate_lookup_joins_one_cancel_shielded_live_job(monkeypatch):
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def scrape(query_text, language):
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return [TOFU]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    leader = asyncio.create_task(service.fetch_store_products(" TOFU ", force_refresh=True))
    await started.wait()
    follower = asyncio.create_task(service.fetch_store_products("tofu", force_refresh=True))
    leader.cancel()
    with pytest.raises(asyncio.CancelledError):
        await leader
    release.set()
    assert await follower == [TOFU]
    assert calls == 1


@pytest.mark.asyncio
async def test_cancelling_the_last_active_waiter_invalidates_and_cancels_its_flight(
    monkeypatch,
):
    started = asyncio.Event()
    child_cancelled = asyncio.Event()
    release = asyncio.Event()
    key = ("weee", "en", service.CACHE_VERSION, "orphan")

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        started.set()
        try:
            await release.wait()
        finally:
            child_cancelled.set()
        return [product_for(query_text)]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    lookup = asyncio.create_task(
        service.fetch_store_products("orphan", force_refresh=True)
    )
    await started.wait()
    lookup.cancel()
    try:
        with pytest.raises(asyncio.CancelledError):
            await lookup
        await asyncio.wait_for(child_cancelled.wait(), timeout=0.05)
    finally:
        release.set()
        await asyncio.gather(lookup, return_exceptions=True)
        await wait_until(lambda: service._live_lookups._worker is None)

    assert key not in service._live_lookups._jobs
    assert service._memory_cache_get(key) is None


@pytest.mark.asyncio
async def test_waiter_release_survives_repeated_cancellation_while_lock_is_held():
    coordinator = service._LiveLookupCoordinator()
    operation_started = asyncio.Event()
    operation_cancelled = asyncio.Event()

    async def operation(
        queue_wait_ms: float,
        priority: service.LookupPriority,
        lease: service._LiveJobLease,
    ) -> service.StoreProductsResult:
        operation_started.set()
        try:
            await asyncio.Event().wait()
        finally:
            operation_cancelled.set()

    key = ("weee", "en", service.CACHE_VERSION, "repeated cancellation")
    lookup = asyncio.create_task(coordinator.submit(key, "interactive", operation))
    await operation_started.wait()
    job = coordinator._jobs[key]
    await coordinator._lock.acquire()
    try:
        for _ in range(4):
            lookup.cancel()
            await asyncio.sleep(0)
        assert not lookup.done()
    finally:
        coordinator._lock.release()

    with pytest.raises(asyncio.CancelledError):
        await lookup
    await asyncio.wait_for(operation_cancelled.wait(), timeout=0.05)
    await wait_until(lambda: coordinator._worker is None)

    assert job.waiter_tokens == set()
    assert key not in coordinator._jobs


@pytest.mark.asyncio
async def test_failed_flight_is_removed_for_a_later_retry(monkeypatch):
    calls = 0

    async def scrape(query_text, language):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise weee_scraper.StoreScrapeError("controlled failure")
        return [TOFU]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    with pytest.raises(weee_scraper.StoreScrapeError):
        await service.fetch_store_products("tofu", force_refresh=True)
    assert await service.fetch_store_products("tofu", force_refresh=True) == [TOFU]
    assert calls == 2


@pytest.mark.asyncio
async def test_positive_result_persists_before_it_is_published(monkeypatch):
    commit_started = asyncio.Event()
    release = asyncio.Event()
    calls: list[str] = []

    class WriteSession:
        async def commit(self):
            calls.append("commit")
            commit_started.set()
            await release.wait()

        async def rollback(self):
            calls.append("rollback")

    class Context:
        async def __aenter__(self):
            return WriteSession()

        async def __aexit__(self, *args):
            calls.append("close")
            return None

    async def upsert(*args, **kwargs):
        calls.append("upsert")
        return None

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_return([TOFU]))
    monkeypatch.setattr(db_session, "async_session_maker", lambda: Context())
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", upsert)
    task = asyncio.create_task(service.fetch_store_products("tofu", force_refresh=True))
    await commit_started.wait()
    follower = asyncio.create_task(service.fetch_store_products("TOFU", force_refresh=True))
    await asyncio.sleep(0)
    assert not task.done()
    assert not follower.done()
    assert service._memory_cache_get(("weee", "en", service.CACHE_VERSION, "tofu")) is None
    assert calls == ["upsert", "commit"]
    release.set()
    assert await asyncio.gather(task, follower) == [[TOFU], [TOFU]]
    assert calls == ["upsert", "commit", "close"]


@pytest.mark.asyncio
async def test_invalidated_job_lease_blocks_persistence_before_commit(monkeypatch):
    upsert_started = asyncio.Event()
    release_upsert = asyncio.Event()
    calls: list[str] = []

    class WriteSession:
        async def commit(self) -> None:
            calls.append("commit")

        async def rollback(self) -> None:
            calls.append("rollback")

    class Context:
        async def __aenter__(self) -> WriteSession:
            calls.append("open")
            return WriteSession()

        async def __aexit__(self, *args: Any) -> None:
            calls.append("close")

    async def upsert(*args: Any, **kwargs: Any) -> None:
        calls.append("upsert")
        upsert_started.set()
        await release_upsert.wait()

    lease = service._LiveJobLease(generation=1)
    monkeypatch.setattr(db_session, "async_session_maker", lambda: Context())
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", upsert)

    task = asyncio.create_task(
        service._persist_positive_result(
            "tofu",
            "en",
            [TOFU],
            datetime.now(timezone.utc),
            lease=lease,
        )
    )
    await upsert_started.wait()
    lease.invalidate("test timeout")
    release_upsert.set()

    with pytest.raises(weee_scraper.StoreScrapeError, match="expired"):
        await task
    assert calls == ["open", "upsert", "rollback", "close"]


@pytest.mark.asyncio
async def test_invalidation_during_irrevocable_commit_never_rolls_back_or_publishes(monkeypatch):
    commit_started = asyncio.Event()
    release_commit = asyncio.Event()
    calls: list[str] = []

    class WriteSession:
        async def commit(self) -> None:
            calls.append("commit_started")
            commit_started.set()
            await release_commit.wait()
            calls.append("committed")

        async def rollback(self) -> None:
            calls.append("rollback")

    class Context:
        async def __aenter__(self) -> WriteSession:
            calls.append("open")
            return WriteSession()

        async def __aexit__(self, *args: Any) -> None:
            calls.append("close")

    async def upsert(*args: Any, **kwargs: Any) -> bool:
        calls.append("upsert")
        return True

    lease = service._LiveJobLease(generation=7)
    monkeypatch.setattr(db_session, "async_session_maker", lambda: Context())
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", upsert)

    task = asyncio.create_task(
        service._persist_positive_result(
            "tofu", "en", [TOFU], datetime.now(timezone.utc), lease=lease
        )
    )
    await commit_started.wait()
    lease.invalidate("operation timeout")
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    release_commit.set()

    with pytest.raises(weee_scraper.StoreScrapeError, match="expired"):
        await task
    assert calls == ["open", "upsert", "commit_started", "committed", "close"]


@pytest.mark.asyncio
async def test_live_result_uses_precommit_timestamp_for_l1_and_metadata(monkeypatch):
    clock = {"seconds": 1_000_000.0}
    captured: list[datetime] = []

    class WriteSession:
        async def commit(self) -> None:
            clock["seconds"] += 300

        async def rollback(self) -> None:
            raise AssertionError("a successful write must not roll back")

    class Context:
        async def __aenter__(self) -> WriteSession:
            return WriteSession()

        async def __aexit__(self, *args: Any) -> None:
            return None

    async def capture_upsert(session: object, **kwargs: Any) -> None:
        captured.append(kwargs["updated_at"])

    monkeypatch.setattr(service.time, "time", lambda: clock["seconds"])
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_return([TOFU]))
    monkeypatch.setattr(db_session, "async_session_maker", lambda: Context())
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", capture_upsert)
    result = await service.fetch_store_products_with_metadata("silken tofu", force_refresh=True)
    expected = datetime.fromtimestamp(1_000_000.0, tz=timezone.utc)
    assert result == service.StoreProductsResult([TOFU], expected)
    assert captured == [expected]
    assert service.CACHE[("weee", "en", service.CACHE_VERSION, "silken tofu")]["timestamp"] == expected.timestamp()


@pytest.mark.asyncio
async def test_uncertain_commit_failure_closes_without_rollback_or_publication_and_allows_retry(
    monkeypatch,
):
    calls: list[str] = []
    attempts = 0

    class WriteSession:
        def __init__(self, fail_commit: bool):
            self.fail_commit = fail_commit

        async def commit(self) -> None:
            calls.append("commit")
            if self.fail_commit:
                raise RuntimeError("commit failed")

        async def rollback(self) -> None:
            calls.append("rollback")

    class Context:
        def __init__(self, session: WriteSession):
            self.session = session

        async def __aenter__(self) -> WriteSession:
            return self.session

        async def __aexit__(self, *args: Any) -> None:
            calls.append("close")

    def session_maker() -> Context:
        nonlocal attempts
        attempts += 1
        return Context(WriteSession(fail_commit=attempts == 1))

    async def upsert(*args: Any, **kwargs: Any) -> None:
        calls.append("upsert")

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_return([TOFU]))
    monkeypatch.setattr(db_session, "async_session_maker", session_maker)
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", upsert)
    key = ("weee", "en", service.CACHE_VERSION, "silken tofu")
    with pytest.raises(RuntimeError, match="commit failed"):
        await service.fetch_store_products("silken tofu", force_refresh=True)
    assert calls == ["upsert", "commit", "close"]
    assert service._memory_cache_get(key) is None
    await service.reset_for_tests()
    assert await service.fetch_store_products("silken tofu", force_refresh=True) == [TOFU]
    assert calls == ["upsert", "commit", "close", "upsert", "commit", "close"]


@pytest.mark.asyncio
async def test_precommit_failure_rolls_back_and_closes(monkeypatch):
    calls: list[str] = []

    class WriteSession:
        async def commit(self) -> None:
            calls.append("commit")

        async def rollback(self) -> None:
            calls.append("rollback")

    class Context:
        async def __aenter__(self) -> WriteSession:
            calls.append("open")
            return WriteSession()

        async def __aexit__(self, *args: Any) -> None:
            calls.append("close")

    async def fail_upsert(*args: Any, **kwargs: Any) -> bool:
        calls.append("upsert")
        raise RuntimeError("upsert failed")

    monkeypatch.setattr(db_session, "async_session_maker", lambda: Context())
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", fail_upsert)

    with pytest.raises(RuntimeError, match="upsert failed"):
        await service._persist_positive_result(
            "tofu",
            "en",
            [TOFU],
            datetime.now(timezone.utc),
        )

    assert calls == ["open", "upsert", "rollback", "close"]


@pytest.mark.asyncio
async def test_all_waiters_receive_one_failure_then_a_later_lookup_retries(monkeypatch):
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        nonlocal calls
        calls += 1
        if calls == 1:
            started.set()
            await release.wait()
            raise weee_scraper.StoreScrapeError("upstream unavailable")
        return [TOFU]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    tasks = [asyncio.create_task(service.fetch_store_products("tofu", force_refresh=True)) for _ in range(5)]
    await started.wait()
    release.set()
    results = await asyncio.gather(*tasks, return_exceptions=True)
    assert all(isinstance(result, weee_scraper.StoreScrapeError) for result in results)
    await service.reset_for_tests()
    assert await service.fetch_store_products("tofu", force_refresh=True) == [TOFU]
    assert calls == 2


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_block_failure_cleanup_or_retry(monkeypatch):
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        nonlocal calls
        calls += 1
        if calls == 1:
            started.set()
            await release.wait()
            raise weee_scraper.StoreScrapeError("upstream unavailable")
        return [TOFU]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    leader = asyncio.create_task(service.fetch_store_products("tofu", force_refresh=True))
    await started.wait()
    waiter = asyncio.create_task(service.fetch_store_products("TOFU", force_refresh=True))
    await asyncio.sleep(0)
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    release.set()
    with pytest.raises(weee_scraper.StoreScrapeError):
        await leader
    await service.reset_for_tests()
    assert await service.fetch_store_products("tofu", force_refresh=True) == [TOFU]
    assert calls == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["empty", "failure"])
async def test_empty_or_failed_refresh_never_persists_a_negative_result(monkeypatch, outcome):
    persistence_calls = 0

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        if outcome == "failure":
            raise weee_scraper.StoreScrapeError("upstream unavailable")
        return []

    async def unexpected_persist(*args: Any, **kwargs: Any) -> None:
        nonlocal persistence_calls
        persistence_calls += 1

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", unexpected_persist)
    if outcome == "failure":
        with pytest.raises(weee_scraper.StoreScrapeError):
            await service.fetch_store_products("silken tofu", force_refresh=True)
    else:
        assert await service.fetch_store_products("silken tofu", force_refresh=True) == []
    assert persistence_calls == 0


@pytest.mark.asyncio
async def test_validation_deduplicates_and_limits_products_before_persistence(monkeypatch):
    duplicate = {"name": "Silken tofu", "price": "$3.49", "image": "", "url": "https://www.weee.com/en/product/tofu/1"}
    second = {"name": "Firm tofu", "price": "$3.49", "image": "", "url": "https://www.weee.com/en/product/firm-tofu/1"}
    third = {"name": "Fried tofu", "price": "$3.49", "image": "", "url": "https://www.weee.com/en/product/fried-tofu/1"}
    fourth = {"name": "Tofu skin", "price": "$3.49", "image": "", "url": "https://www.weee.com/en/product/tofu-skin/1"}
    persisted: list[list[dict[str, str]]] = []

    async def capture_persist(*args: Any, **kwargs: Any) -> None:
        persisted.append(args[2])

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_return([TOFU, duplicate, {"name": 123}, second, third, fourth]))
    monkeypatch.setattr(service, "_persist_positive_result", capture_persist)
    assert await service.fetch_store_products("tofu", force_refresh=True) == [TOFU, second, third]
    assert persisted == [[TOFU, second, third]]


def test_l1_cache_is_bounded_and_touching_an_entry_updates_lru(monkeypatch):
    monkeypatch.setattr(service, "CACHE_MAX_ENTRIES", 3)
    monkeypatch.setattr(service.time, "time", lambda: 1_000.0)
    keys = [
        ("weee", "en", service.CACHE_VERSION, name)
        for name in ("a", "b", "c", "d")
    ]
    for key in keys[:3]:
        service._memory_cache_set(key, [product_for(f"product {key[3]}")])
    assert service._memory_cache_get(keys[0]) == [product_for("product a")]

    service._memory_cache_set(keys[3], [product_for("product d")])

    assert list(service.CACHE) == [keys[2], keys[0], keys[3]]
    assert keys[1] not in service.CACHE


def test_l1_cache_prunes_expired_entries_globally_during_unrelated_access(monkeypatch):
    monkeypatch.setattr(service.time, "time", lambda: 100_000.0)
    expired_key = ("weee", "en", service.CACHE_VERSION, "expired")
    fresh_key = ("weee", "en", service.CACHE_VERSION, "fresh")
    service.CACHE[expired_key] = {"data": [product_for("expired")], "timestamp": 0.0}
    service.CACHE[fresh_key] = {"data": [product_for("fresh")], "timestamp": 99_999.0}

    assert service._memory_cache_get(fresh_key) == [product_for("fresh")]
    assert expired_key not in service.CACHE


@pytest.mark.parametrize(
    "timestamp",
    [
        100_000.000_001,
        float("nan"),
        float("inf"),
        float("-inf"),
        "invalid",
    ],
)
def test_l1_cache_rejects_future_and_non_finite_timestamps(monkeypatch, timestamp):
    monkeypatch.setattr(service.time, "time", lambda: 100_000.0)
    key = ("weee", "en", service.CACHE_VERSION, "invalid timestamp")
    service.CACHE[key] = {"data": [TOFU], "timestamp": timestamp}

    assert service._memory_cache_get(key) is None
    assert key not in service.CACHE


@pytest.mark.parametrize(
    ("candidate_timestamp", "candidate_products"),
    [
        (99_999.0, [{**TOFU, "price": "$1.00"}]),
        (100_000.0, [{**TOFU, "price": "$2.00"}]),
        (100_000.000_001, [{**TOFU, "price": "$3.00"}]),
        (99_999.5, [{"name": "unsafe", "url": "https://evil.test/product/1"}]),
    ],
    ids=["older", "equal", "future", "invalid-products"],
)
def test_l1_set_rejects_nonwinning_candidates_without_erasing_valid_entry(
    monkeypatch,
    candidate_timestamp,
    candidate_products,
):
    monkeypatch.setattr(service.time, "time", lambda: 100_000.0)
    key = ("weee", "en", service.CACHE_VERSION, "monotonic")
    winner = {**TOFU, "price": "$9.99"}
    service._memory_cache_set(key, [winner], timestamp=100_000.0)

    service._memory_cache_set(
        key,
        candidate_products,
        timestamp=candidate_timestamp,
    )

    assert service.CACHE[key] == {
        "data": [winner],
        "timestamp": 100_000.0,
    }


def test_l1_cache_accepts_zero_age_and_rejects_exactly_twenty_four_hours(monkeypatch):
    monkeypatch.setattr(service.time, "time", lambda: 100_000.0)
    current = ("weee", "en", service.CACHE_VERSION, "current")
    exact_expiry = ("weee", "en", service.CACHE_VERSION, "expired")
    service.CACHE[current] = {"data": [TOFU], "timestamp": 100_000.0}
    service.CACHE[exact_expiry] = {
        "data": [TOFU],
        "timestamp": 100_000.0 - service.CACHE_TTL_SECONDS,
    }

    assert service._memory_cache_get(current) == [TOFU]
    assert service._memory_cache_get(exact_expiry) is None


def test_l1_cache_remains_bounded_under_high_cardinality_churn(monkeypatch):
    monkeypatch.setattr(service, "CACHE_MAX_ENTRIES", 5)
    monkeypatch.setattr(service.time, "time", lambda: 1_000.0)
    for index in range(50):
        key = ("weee", "en", service.CACHE_VERSION, f"ingredient {index}")
        service._memory_cache_set(key, [product_for(f"ingredient {index}")])
    assert len(service.CACHE) == 5


@pytest.mark.asyncio
async def test_l2_legacy_rows_are_safely_normalized_with_restart_parity(monkeypatch):
    rice_one = {
        "name": "Rice 1 lb",
        "price": "$2",
        "image": "",
        "url": "https://www.weee.com/en/product/rice-one/1",
    }
    rice_two = {
        "name": "Rice 2 lb",
        "price": "$3",
        "image": "",
        "url": "https://www.weee.com/en/product/rice-two/1",
    }
    beans = {
        "name": "Beans",
        "price": "$4",
        "image": "",
        "url": "https://www.weee.com/en/product/beans/1",
    }
    corrupt_rows = [
        rice_one,
        {**rice_one, "name": "RICE 1 LB"},
        {"name": "Unsafe", "price": "$1", "image": "", "url": "https://evil.test/product/unsafe"},
        rice_two,
        beans,
        product_for("fourth"),
    ]
    cached_at = datetime.now(timezone.utc)

    async def database_hit(*args: Any, **kwargs: Any) -> Any:
        return repo_store_cache.CachedStoreProducts(corrupt_rows, cached_at)

    async def unexpected_scrape(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        raise AssertionError("a normalized L2 hit must not scrape")

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_hit)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", unexpected_scrape)
    expected = [rice_one, rice_two, beans]

    first = await service.fetch_store_products("rice", session=object())
    service.CACHE.clear()
    restarted = await service.fetch_store_products("rice", session=object())

    assert first == expected
    assert restarted == expected
    assert service._memory_cache_get(
        ("weee", "en", service.CACHE_VERSION, "rice")
    ) == expected


@pytest.mark.asyncio
async def test_old_cache_version_is_inert(monkeypatch):
    service.CACHE[("weee", "en", "v6", "tofu")] = {"data": [TOFU], "timestamp": 1_000_000.0}
    requested_versions: list[str] = []

    async def database_miss(*args: Any, **kwargs: Any) -> None:
        requested_versions.append(kwargs["cache_version"])
        return None

    monkeypatch.setattr(service.time, "time", lambda: 1_000_001.0)
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_miss)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_return([TOFU]))
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    assert await service.fetch_store_products("tofu", session=object()) == [TOFU]
    assert requested_versions == ["v7"]


@pytest.mark.asyncio
async def test_cache_and_scrape_logs_include_distinguishable_parseable_fields(monkeypatch, caplog):
    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        if query_text == "empty":
            return []
        if query_text == "failure":
            raise weee_scraper.StoreScrapeError("upstream unavailable")
        return [TOFU]

    async def database_hit(*args: Any, **kwargs: Any) -> Any:
        return repo_store_cache.CachedStoreProducts([TOFU], datetime.now(timezone.utc))

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    caplog.set_level(logging.INFO, logger=service.__name__)
    assert await service.fetch_store_products("tofu", force_refresh=True) == [TOFU]
    assert await service.fetch_store_products("tofu") == [TOFU]
    assert await service.fetch_store_products("empty", force_refresh=True) == []
    with pytest.raises(weee_scraper.StoreScrapeError):
        await service.fetch_store_products("failure", force_refresh=True)
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_hit)
    assert await service.fetch_store_products("database tofu", session=object()) == [TOFU]

    events = {getattr(record, "event", None) for record in caplog.records}
    assert {"memory_hit", "postgres_hit", "cache_miss", "scrape_success", "scrape_empty", "scrape_failure"} <= events
    for record in caplog.records:
        assert record.store == "weee"
        assert record.cache_version == service.CACHE_VERSION
        assert record.language in {"en", "zh"}
        assert record.elapsed_ms >= 0
        assert record.queue_wait_ms >= 0


@pytest.mark.asyncio
async def test_batch_cache_read_preserves_order_dedupes_and_never_scrapes(monkeypatch):
    rows = {("garlic", "en"): cached([GARLIC]), ("姜", "zh"): cached([GINGER])}
    monkeypatch.setattr(
        service.time,
        "time",
        lambda: datetime(2026, 8, 27, tzinfo=timezone.utc).timestamp(),
    )

    async def unexpected_scrape(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        raise AssertionError("batch reads must not scrape")

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_batch", async_return(rows))
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", unexpected_scrape)
    result = await service.fetch_cached_store_products_batch([" Garlic ", "garlic", "姜", "missing"], session=object())
    assert [(entry.query, entry.status) for entry in result] == [
        ("Garlic", "fresh"), ("姜", "fresh"), ("missing", "missing"),
    ]


@pytest.mark.asyncio
async def test_batch_cache_read_accepts_more_than_fifty_queries(monkeypatch):
    queries = [f"ingredient {index}" for index in range(75)]
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_batch", async_return({}))
    result = await service.fetch_cached_store_products_batch(queries, session=object())
    assert [entry.query for entry in result] == queries
    assert all(entry.status == "missing" for entry in result)


@pytest.mark.asyncio
async def test_batch_repository_uses_one_query_and_filters_exact_expiry(monkeypatch):
    now = datetime(2026, 8, 27, tzinfo=timezone.utc)
    fresh = type("Row", (), {"query": "garlic", "language": "en", "data": [GARLIC], "updated_at": now - timedelta(seconds=86_399)})()
    expired = type("Row", (), {"query": "old", "language": "en", "data": [STALE_PRODUCT], "updated_at": now - timedelta(seconds=86_400)})()
    calls = 0

    class Scalars:
        def all(self):
            return [fresh, expired]

    class Result:
        def scalars(self):
            return Scalars()

    class Session:
        async def execute(self, statement):
            nonlocal calls
            calls += 1
            return Result()

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    monkeypatch.setattr(repo_store_cache, "datetime", FrozenDateTime)
    result = await repo_store_cache.get_cached_store_products_batch(
        Session(), keys=[("garlic", "en"), ("old", "en")], store="weee", cache_version="v7", max_age_seconds=86_400
    )
    assert calls == 1
    assert result == {("garlic", "en"): repo_store_cache.CachedStoreProducts([GARLIC], fresh.updated_at)}


@pytest.mark.asyncio
async def test_cold_cache_health_probe_keeps_one_live_scrape_and_health_responsive(monkeypatch):
    active = 0
    peak = 0
    sessions: list[object] = []

    class ReadSession:
        def __init__(self) -> None:
            self.closed = False

        async def close(self) -> None:
            self.closed = True

    async def database_miss(*args: Any, **kwargs: Any) -> None:
        return None

    async def scrape(query_text, language):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        return [product_for(query_text)]

    app = FastAPI()
    app.get("/health")(health)
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_miss)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        lookups = []
        for index in range(20):
            session = ReadSession()
            sessions.append(session)
            lookups.append(
                service.fetch_store_products(
                    f"interactive {index}",
                    session=session,  # type: ignore[arg-type]
                    release_read_session_on_miss=True,
                )
            )
        for index in range(2):
            session = ReadSession()
            sessions.append(session)
            lookups.append(
                service.fetch_store_products(
                    f"background {index}",
                    session=session,  # type: ignore[arg-type]
                    priority="background",
                    release_read_session_on_miss=True,
                )
            )
        gathered = await asyncio.gather(
            *(client.get("/health") for _ in range(12)),
            *lookups,
        )
    responses = gathered[:12]
    products = gathered[12:]
    assert all(response.status_code == 200 for response in responses)
    assert all(products)
    assert all(session.closed for session in sessions)
    assert peak == 1
