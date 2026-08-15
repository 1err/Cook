import asyncio
import logging
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from app.db import repo_store_cache
from app.db.repo_store_cache import is_cache_entry_fresh
from app.services import store_scraper


PRODUCT = {
    "name": "Silken tofu",
    "price": "$2.99",
    "image": "https://images.example.test/tofu.jpg",
    "url": "https://www.sayweee.com/product/tofu",
}


def test_cache_entry_expires_at_exactly_24_hours():
    now = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)

    assert is_cache_entry_fresh(now - timedelta(seconds=86399), now, 86400)
    assert not is_cache_entry_fresh(now - timedelta(seconds=86400), now, 86400)


@pytest.mark.asyncio
async def test_database_cache_does_not_return_a_row_at_exactly_24_hours(
    monkeypatch: pytest.MonkeyPatch,
):
    now = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    row = SimpleNamespace(data=[PRODUCT], updated_at=now - timedelta(seconds=86400))

    class ScalarResult:
        def scalars(self) -> "ScalarResult":
            return self

        def one_or_none(self) -> SimpleNamespace:
            return row

    class Session:
        async def execute(self, *args: Any, **kwargs: Any) -> ScalarResult:
            return ScalarResult()

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz: timezone | None = None) -> datetime:
            return now

    monkeypatch.setattr(repo_store_cache, "datetime", FrozenDateTime)

    assert await repo_store_cache.get_cached_store_products(
        Session(),  # type: ignore[arg-type]
        query="silken tofu",
        store="weee",
        language="en",
        cache_version="v6",
        max_age_seconds=86400,
    ) is None


@pytest.mark.asyncio
async def test_fresh_memory_hit_skips_database_and_scrape(monkeypatch: pytest.MonkeyPatch):
    cache_key = ("weee", "en", store_scraper.CACHE_VERSION, "silken tofu")
    store_scraper._memory_cache_set(cache_key, [PRODUCT])

    async def unexpected_database(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        raise AssertionError("a fresh memory result must skip PostgreSQL")

    async def unexpected_scrape(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        raise AssertionError("a fresh memory result must skip scraping")

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", unexpected_database)
    monkeypatch.setattr(store_scraper, "_scrape_weee_products", unexpected_scrape, raising=False)

    assert await store_scraper.fetch_store_products("silken tofu", session=object()) == [PRODUCT]


@pytest.mark.asyncio
async def test_fresh_postgresql_hit_repopulates_memory_and_skips_scrape(monkeypatch: pytest.MonkeyPatch):
    database_calls = 0

    async def fresh_database(*args: Any, **kwargs: Any) -> SimpleNamespace:
        nonlocal database_calls
        database_calls += 1
        return SimpleNamespace(products=[PRODUCT], updated_at=datetime.now(timezone.utc))

    async def unexpected_scrape(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        raise AssertionError("a fresh PostgreSQL result must skip scraping")

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", fresh_database)
    monkeypatch.setattr(store_scraper, "_scrape_weee_products", unexpected_scrape, raising=False)

    first = await store_scraper.fetch_store_products("silken tofu", session=object())
    second = await store_scraper.fetch_store_products("silken tofu", session=object())

    assert first == [PRODUCT]
    assert second == [PRODUCT]
    assert database_calls == 1


@pytest.mark.asyncio
async def test_near_expiry_database_hit_does_not_extend_memory_freshness(
    monkeypatch: pytest.MonkeyPatch,
):
    clock = {"seconds": 1_000_000.0}
    database_calls = 0
    scrape_calls = 0
    database_product = {**PRODUCT, "price": "$2.99"}
    refreshed_product = {**PRODUCT, "price": "$3.99"}
    updated_at = datetime.fromtimestamp(clock["seconds"] - 86399, tz=timezone.utc)

    async def database_hit_with_metadata(*args: Any, **kwargs: Any) -> SimpleNamespace | None:
        nonlocal database_calls
        database_calls += 1
        if clock["seconds"] < 1_000_001.0:
            return SimpleNamespace(products=[database_product], updated_at=updated_at)
        return None

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        nonlocal scrape_calls
        scrape_calls += 1
        return [refreshed_product]

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(store_scraper.time, "time", lambda: clock["seconds"])
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_hit_with_metadata)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive, raising=False)
    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live, raising=False)

    assert await store_scraper.fetch_store_products("silken tofu", session=object()) == [database_product]

    clock["seconds"] = 1_000_002.0

    assert await store_scraper.fetch_store_products("silken tofu", session=object()) == [refreshed_product]
    assert database_calls == 2
    assert scrape_calls == 1


@pytest.mark.asyncio
async def test_expired_database_miss_reaches_live_scrape_without_returning_stale_products(
    monkeypatch: pytest.MonkeyPatch,
):
    stale_product = {**PRODUCT, "price": "$1.99"}
    scraped_product = {**PRODUCT, "price": "$3.99"}
    scrape_calls = 0

    async def expired_database(*args: Any, **kwargs: Any) -> None:
        return None

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        nonlocal scrape_calls
        scrape_calls += 1
        return [scraped_product]

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", expired_database)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive, raising=False)
    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live, raising=False)
    store_scraper.CACHE[("weee", "en", store_scraper.CACHE_VERSION, "stale tofu")] = {
        "data": [stale_product],
        "timestamp": 0,
    }

    result = await store_scraper.fetch_store_products("stale tofu", session=object())

    assert result == [scraped_product]
    assert result != [stale_product]
    assert scrape_calls == 1


@pytest.mark.asyncio
async def test_positive_live_scrape_is_committed_before_result_and_memory_are_published(
    monkeypatch: pytest.MonkeyPatch,
):
    persist_started = asyncio.Event()
    allow_persist = asyncio.Event()

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return [PRODUCT]

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        persist_started.set()
        await allow_persist.wait()

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live, raising=False)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive, raising=False)

    result_task = asyncio.create_task(store_scraper.fetch_store_products("silken tofu", force_refresh=True))
    await asyncio.wait_for(persist_started.wait(), timeout=1)

    cache_key = ("weee", "en", store_scraper.CACHE_VERSION, "silken tofu")
    assert not result_task.done()
    assert store_scraper._memory_cache_get(cache_key) is None

    allow_persist.set()
    assert await result_task == [PRODUCT]
    assert store_scraper._memory_cache_get(cache_key) == [PRODUCT]


@pytest.mark.asyncio
async def test_single_flight_coalesces_simultaneous_normalized_misses(monkeypatch: pytest.MonkeyPatch):
    scrape_started = asyncio.Event()
    allow_scrape = asyncio.Event()
    scrape_calls = 0

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        nonlocal scrape_calls
        scrape_calls += 1
        scrape_started.set()
        await allow_scrape.wait()
        return [PRODUCT]

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live, raising=False)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive, raising=False)

    tasks = [
        asyncio.create_task(store_scraper.fetch_store_products(query, force_refresh=True))
        for query in ("TOFU", " tofu ", "tofu", "ToFu", "tofu")
    ]
    await asyncio.wait_for(scrape_started.wait(), timeout=1)
    await asyncio.sleep(0)
    allow_scrape.set()

    assert await asyncio.gather(*tasks) == [[PRODUCT]] * 5
    assert scrape_calls == 1


@pytest.mark.asyncio
async def test_scrape_ceiling_allows_at_most_four_distinct_live_scrapes(monkeypatch: pytest.MonkeyPatch):
    four_active = asyncio.Event()
    allow_scrapes = asyncio.Event()
    active = 0
    peak = 0

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        if active == 4:
            four_active.set()
        try:
            await allow_scrapes.wait()
            return [PRODUCT]
        finally:
            active -= 1

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live, raising=False)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive, raising=False)

    tasks = [
        asyncio.create_task(store_scraper.fetch_store_products(f"query {index}", force_refresh=True))
        for index in range(6)
    ]
    await asyncio.wait_for(four_active.wait(), timeout=1)
    await asyncio.sleep(0)
    assert peak == 4

    allow_scrapes.set()
    await asyncio.gather(*tasks)
    assert peak == 4


@pytest.mark.asyncio
async def test_failed_flight_propagates_to_all_waiters_and_later_call_retries(
    monkeypatch: pytest.MonkeyPatch,
):
    assert issubclass(store_scraper.StoreScrapeError, RuntimeError)
    scrape_started = asyncio.Event()
    allow_failure = asyncio.Event()
    scrape_calls = 0

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        nonlocal scrape_calls
        scrape_calls += 1
        if scrape_calls == 1:
            scrape_started.set()
            await allow_failure.wait()
            raise store_scraper.StoreScrapeError("upstream unavailable")
        return [PRODUCT]

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live, raising=False)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive, raising=False)

    tasks = [
        asyncio.create_task(store_scraper.fetch_store_products("tofu", force_refresh=True))
        for _ in range(5)
    ]
    await asyncio.wait_for(scrape_started.wait(), timeout=1)
    await asyncio.sleep(0)
    allow_failure.set()

    results = await asyncio.gather(*tasks, return_exceptions=True)
    assert all(isinstance(result, store_scraper.StoreScrapeError) for result in results)
    assert scrape_calls == 1

    assert await store_scraper.fetch_store_products("tofu", force_refresh=True) == [PRODUCT]
    assert scrape_calls == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["empty", "failure"])
async def test_empty_or_failed_force_refresh_preserves_positive_entry(
    monkeypatch: pytest.MonkeyPatch,
    outcome: str,
):
    row = SimpleNamespace(data=[PRODUCT])
    persistence_calls = 0

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        if outcome == "failure":
            raise store_scraper.StoreScrapeError("upstream unavailable")
        return []

    async def unexpected_persist(*args: Any, **kwargs: Any) -> None:
        nonlocal persistence_calls
        persistence_calls += 1
        row.data = []

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live, raising=False)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", unexpected_persist, raising=False)

    if outcome == "failure":
        with pytest.raises(store_scraper.StoreScrapeError):
            await store_scraper.fetch_store_products("silken tofu", session=object(), force_refresh=True)
    else:
        assert await store_scraper.fetch_store_products(
            "silken tofu", session=object(), force_refresh=True
        ) == []

    assert persistence_calls == 0
    assert row.data == [PRODUCT]


@pytest.mark.asyncio
async def test_products_are_validated_deduplicated_and_truncated_before_persistence(
    monkeypatch: pytest.MonkeyPatch,
):
    duplicate = {**PRODUCT, "price": "$3.49"}
    second = {**PRODUCT, "name": "Firm tofu", "url": "https://www.sayweee.com/product/firm-tofu"}
    third = {**PRODUCT, "name": "Fried tofu", "url": "https://www.sayweee.com/product/fried-tofu"}
    fourth = {**PRODUCT, "name": "Tofu skin", "url": "https://www.sayweee.com/product/tofu-skin"}
    malformed = {**PRODUCT, "name": 123}
    persisted: list[list[dict[str, str]]] = []

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return [PRODUCT, duplicate, malformed, second, third, fourth]  # type: ignore[list-item]

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        persisted.append(args[2])

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live, raising=False)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive, raising=False)

    result = await store_scraper.fetch_store_products("tofu", force_refresh=True)

    assert result == [PRODUCT, second, third]
    assert persisted == [[PRODUCT, second, third]]


@pytest.mark.asyncio
async def test_invalid_weee_search_payload_raises_typed_failure():
    class Page:
        async def evaluate(self, script: str) -> dict[str, str]:
            return {"unexpected": "payload"}

        async def wait_for_timeout(self, milliseconds: int) -> None:
            return None

    with pytest.raises(store_scraper.StoreScrapeError, match="invalid product payload"):
        await store_scraper._weee_fetch_search_items_with_retry(Page(), "extract")


@pytest.mark.asyncio
async def test_cache_and_scrape_logs_have_distinguishable_event_fields(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    scrape_started = asyncio.Event()
    allow_scrape = asyncio.Event()
    calls = 0

    async def scrape_live(query: str, language: str) -> list[dict[str, str]]:
        nonlocal calls
        calls += 1
        if query == "tofu":
            scrape_started.set()
            await allow_scrape.wait()
            return [PRODUCT]
        if query == "empty":
            return []
        raise store_scraper.StoreScrapeError("upstream unavailable")

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live, raising=False)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive, raising=False)
    caplog.set_level(logging.INFO, logger=store_scraper.__name__)

    leader = asyncio.create_task(store_scraper.fetch_store_products("tofu", force_refresh=True))
    await asyncio.wait_for(scrape_started.wait(), timeout=1)
    waiter = asyncio.create_task(store_scraper.fetch_store_products("TOFU", force_refresh=True))
    await asyncio.sleep(0)
    allow_scrape.set()
    await asyncio.gather(leader, waiter)
    await store_scraper.fetch_store_products("tofu")
    assert await store_scraper.fetch_store_products("empty", force_refresh=True) == []
    with pytest.raises(store_scraper.StoreScrapeError):
        await store_scraper.fetch_store_products("failure", force_refresh=True)

    events = {getattr(record, "event", None) for record in caplog.records}
    assert {
        "memory_hit",
        "cache_miss",
        "single_flight_wait",
        "scrape_success",
        "scrape_empty",
        "scrape_failure",
    } <= events
    assert calls == 3


@pytest.mark.asyncio
async def test_empty_upsert_preserves_an_existing_positive_database_entry():
    row = SimpleNamespace(data=[PRODUCT])

    class ScalarResult:
        def scalars(self) -> "ScalarResult":
            return self

        def one_or_none(self) -> SimpleNamespace:
            return row

    class Session:
        flush_count = 0

        async def execute(self, *args: Any, **kwargs: Any) -> ScalarResult:
            return ScalarResult()

        async def flush(self) -> None:
            self.flush_count += 1

    session = Session()

    await repo_store_cache.upsert_cached_store_products(
        session,  # type: ignore[arg-type]
        query="silken tofu",
        store="weee",
        language="en",
        cache_version="v6",
        data=[],
    )

    assert row.data == [PRODUCT]
    assert session.flush_count == 0
