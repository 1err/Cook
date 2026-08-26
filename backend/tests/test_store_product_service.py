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
    service.CACHE.clear()
    yield
    service.CACHE.clear()
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
    service._memory_cache_set(memory_key, [TOFU], timestamp=cached_at.timestamp())
    monkeypatch.setattr(service.time, "time", lambda: clock["seconds"])
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
async def test_failed_writer_rolls_back_closes_does_not_publish_and_allows_retry(monkeypatch):
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
    assert calls == ["upsert", "commit", "rollback", "close"]
    assert service._memory_cache_get(key) is None
    await service.reset_for_tests()
    assert await service.fetch_store_products("silken tofu", force_refresh=True) == [TOFU]
    assert calls == ["upsert", "commit", "rollback", "close", "upsert", "commit", "close"]


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

    async def capture_persist(*args: Any) -> None:
        persisted.append(args[2])

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_return([TOFU, duplicate, {"name": 123}, second, third, fourth]))
    monkeypatch.setattr(service, "_persist_positive_result", capture_persist)
    assert await service.fetch_store_products("tofu", force_refresh=True) == [TOFU, second, third]
    assert persisted == [[TOFU, second, third]]


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

    async def scrape(query_text, language):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        return [product_for(query_text)]

    app = FastAPI()
    app.get("/health")(health)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        lookups = [service.fetch_store_products(f"interactive {index}", force_refresh=True) for index in range(20)]
        lookups.extend(service.fetch_store_products(f"background {index}", force_refresh=True, priority="background") for index in range(2))
        responses, *products = await asyncio.gather(client.get("/health"), *lookups)
    assert responses.status_code == 200
    assert all(products)
    assert peak == 1
