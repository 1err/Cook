import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

from app.db import repo_store_cache
from app.db import session as db_session
from app.db.repo_store_cache import is_cache_entry_fresh
from app.services import store_scraper


PRODUCT = {
    "name": "Silken tofu",
    "price": "$2.99",
    "image": "https://images.example.test/tofu.jpg",
    "url": "https://www.sayweee.com/product/tofu",
}


async def _scrape_extracted_candidates(
    monkeypatch: pytest.MonkeyPatch,
    candidates: list[dict[str, str]],
    enrich: Any,
) -> list[dict[str, str]]:
    class Page:
        async def goto(self, *args: Any, **kwargs: Any) -> None:
            return None

    class Context:
        async def new_page(self) -> Page:
            return Page()

        async def close(self) -> None:
            return None

    class Browser:
        async def new_context(self, **kwargs: Any) -> Context:
            return Context()

    async def fake_browser() -> Browser:
        return Browser()

    async def no_wait(*args: Any, **kwargs: Any) -> None:
        return None

    async def extracted(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return candidates

    monkeypatch.setattr(store_scraper, "_ensure_shared_browser", fake_browser)
    monkeypatch.setattr(store_scraper, "_wait_for_weee_results", no_wait)
    monkeypatch.setattr(store_scraper, "_weee_fetch_search_items_with_retry", extracted)
    monkeypatch.setattr(store_scraper, "_enrich_weee_products_from_detail_pages", enrich)
    playwright_module = ModuleType("playwright")
    async_api_module = ModuleType("playwright.async_api")
    playwright_module.async_api = async_api_module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "playwright", playwright_module)
    monkeypatch.setitem(sys.modules, "playwright.async_api", async_api_module)
    return await store_scraper._scrape_weee_products("tofu", "en")


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
async def test_memory_hit_metadata_uses_the_cache_entry_timestamp(
    monkeypatch: pytest.MonkeyPatch,
):
    cached_at = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    clock = {"seconds": cached_at.timestamp() + 120}
    cache_key = ("weee", "en", store_scraper.CACHE_VERSION, "silken tofu")
    store_scraper._memory_cache_set(cache_key, [PRODUCT], timestamp=cached_at.timestamp())

    monkeypatch.setattr(store_scraper.time, "time", lambda: clock["seconds"])

    result = await store_scraper.fetch_store_products_with_metadata(
        "silken tofu",
        session=object(),
    )

    assert result.products == [PRODUCT]
    assert result.cached_at == cached_at


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
async def test_postgresql_hit_metadata_uses_the_row_timestamp(
    monkeypatch: pytest.MonkeyPatch,
):
    now = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    cached_at = now - timedelta(seconds=86399)

    async def fresh_database(*args: Any, **kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(products=[PRODUCT], updated_at=cached_at)

    monkeypatch.setattr(
        repo_store_cache,
        "get_cached_store_products_with_metadata",
        fresh_database,
    )
    monkeypatch.setattr(store_scraper.time, "time", lambda: now.timestamp())

    result = await store_scraper.fetch_store_products_with_metadata(
        "silken tofu",
        session=object(),
    )

    assert result.products == [PRODUCT]
    assert result.cached_at == cached_at


@pytest.mark.asyncio
async def test_postgresql_miss_rechecks_memory_before_starting_a_new_flight(
    monkeypatch: pytest.MonkeyPatch,
):
    first_database_read_started = asyncio.Event()
    release_first_database_read = asyncio.Event()
    database_calls = 0
    scrape_calls = 0

    async def gated_database_miss(*args: Any, **kwargs: Any) -> None:
        nonlocal database_calls
        database_calls += 1
        if database_calls == 1:
            first_database_read_started.set()
            await release_first_database_read.wait()
        return None

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        nonlocal scrape_calls
        scrape_calls += 1
        return [PRODUCT]

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", gated_database_miss)
    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive)

    delayed = asyncio.create_task(store_scraper.fetch_store_products("silken tofu", session=object()))
    await asyncio.wait_for(first_database_read_started.wait(), timeout=1)

    assert await store_scraper.fetch_store_products("SILKEN TOFU", session=object()) == [PRODUCT]
    release_first_database_read.set()

    assert await delayed == [PRODUCT]
    assert database_calls == 2
    assert scrape_calls == 1


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
    commit_started = asyncio.Event()
    allow_commit = asyncio.Event()
    calls: list[str] = []

    class WriteSession:
        async def commit(self) -> None:
            calls.append("commit")
            commit_started.set()
            await allow_commit.wait()

        async def rollback(self) -> None:
            calls.append("rollback")

    write_session = WriteSession()

    class SessionContext:
        async def __aenter__(self) -> WriteSession:
            return write_session

        async def __aexit__(self, *args: Any) -> None:
            calls.append("close")

    def session_maker() -> SessionContext:
        return SessionContext()

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return [PRODUCT]

    async def upsert_positive(session: object, **kwargs: Any) -> None:
        assert session is write_session
        assert kwargs["store"] == "weee"
        assert kwargs["data"] == [PRODUCT]
        calls.append("upsert")

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live)
    monkeypatch.setattr(db_session, "async_session_maker", session_maker)
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", upsert_positive)

    result_task = asyncio.create_task(store_scraper.fetch_store_products("silken tofu", force_refresh=True))
    await asyncio.wait_for(commit_started.wait(), timeout=1)
    follower = asyncio.create_task(store_scraper.fetch_store_products("SILKEN TOFU", force_refresh=True))
    await asyncio.sleep(0)

    cache_key = ("weee", "en", store_scraper.CACHE_VERSION, "silken tofu")
    assert not result_task.done()
    assert not follower.done()
    assert store_scraper._memory_cache_get(cache_key) is None
    assert calls == ["upsert", "commit"]

    allow_commit.set()
    assert await asyncio.gather(result_task, follower) == [[PRODUCT], [PRODUCT]]
    assert calls == ["upsert", "commit", "close"]
    assert store_scraper._memory_cache_get(cache_key) == [PRODUCT]


@pytest.mark.asyncio
async def test_delayed_commit_keeps_postgresql_and_memory_on_one_absolute_expiry(
    monkeypatch: pytest.MonkeyPatch,
):
    clock = {"seconds": 1_000_000.0}
    cached_at_values: list[datetime] = []

    class WriteSession:
        async def commit(self) -> None:
            clock["seconds"] += 300

        async def rollback(self) -> None:
            raise AssertionError("a successful writer must not roll back")

    class SessionContext:
        async def __aenter__(self) -> WriteSession:
            return WriteSession()

        async def __aexit__(self, *args: Any) -> None:
            return None

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return [PRODUCT]

    async def capture_upsert(session: object, **kwargs: Any) -> None:
        cached_at_values.append(kwargs["updated_at"])

    monkeypatch.setattr(store_scraper.time, "time", lambda: clock["seconds"])
    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live)
    monkeypatch.setattr(db_session, "async_session_maker", lambda: SessionContext())
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", capture_upsert)

    assert await store_scraper.fetch_store_products("silken tofu", force_refresh=True) == [PRODUCT]

    cache_key = ("weee", "en", store_scraper.CACHE_VERSION, "silken tofu")
    assert len(cached_at_values) == 1
    cached_at = cached_at_values[0]
    assert cached_at == datetime.fromtimestamp(1_000_000.0, tz=timezone.utc)
    assert store_scraper.CACHE[cache_key]["timestamp"] == cached_at.timestamp()

    clock["seconds"] = 1_000_000.0 + 86399
    assert is_cache_entry_fresh(
        cached_at,
        datetime.fromtimestamp(clock["seconds"], tz=timezone.utc),
        store_scraper.CACHE_TTL_SECONDS,
    )
    assert store_scraper._memory_cache_get(cache_key) == [PRODUCT]

    clock["seconds"] = 1_000_000.0 + 86400
    assert not is_cache_entry_fresh(
        cached_at,
        datetime.fromtimestamp(clock["seconds"], tz=timezone.utc),
        store_scraper.CACHE_TTL_SECONDS,
    )
    assert store_scraper._memory_cache_get(cache_key) is None


@pytest.mark.asyncio
async def test_live_result_metadata_uses_the_precommit_cache_timestamp(
    monkeypatch: pytest.MonkeyPatch,
):
    clock = {"seconds": 1_000_000.0}

    class WriteSession:
        async def commit(self) -> None:
            clock["seconds"] += 300

        async def rollback(self) -> None:
            raise AssertionError("a successful writer must not roll back")

    class SessionContext:
        async def __aenter__(self) -> WriteSession:
            return WriteSession()

        async def __aexit__(self, *args: Any) -> None:
            return None

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return [PRODUCT]

    async def capture_upsert(session: object, **kwargs: Any) -> None:
        assert kwargs["updated_at"] == datetime.fromtimestamp(1_000_000.0, tz=timezone.utc)

    monkeypatch.setattr(store_scraper.time, "time", lambda: clock["seconds"])
    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live)
    monkeypatch.setattr(db_session, "async_session_maker", lambda: SessionContext())
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", capture_upsert)

    result = await store_scraper.fetch_store_products_with_metadata(
        "silken tofu",
        force_refresh=True,
    )

    assert result.products == [PRODUCT]
    assert result.cached_at == datetime.fromtimestamp(1_000_000.0, tz=timezone.utc)


@pytest.mark.asyncio
async def test_failed_independent_writer_rolls_back_closes_and_allows_retry(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[str] = []
    writer_attempts = 0

    class WriteSession:
        def __init__(self, *, fail_commit: bool):
            self.fail_commit = fail_commit

        async def commit(self) -> None:
            calls.append("commit")
            if self.fail_commit:
                raise RuntimeError("commit failed")

        async def rollback(self) -> None:
            calls.append("rollback")

    class SessionContext:
        def __init__(self, session: WriteSession):
            self.session = session

        async def __aenter__(self) -> WriteSession:
            return self.session

        async def __aexit__(self, *args: Any) -> None:
            calls.append("close")

    def session_maker() -> SessionContext:
        nonlocal writer_attempts
        writer_attempts += 1
        return SessionContext(WriteSession(fail_commit=writer_attempts == 1))

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return [PRODUCT]

    async def upsert_positive(*args: Any, **kwargs: Any) -> None:
        calls.append("upsert")

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live)
    monkeypatch.setattr(db_session, "async_session_maker", session_maker)
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", upsert_positive)

    cache_key = ("weee", "en", store_scraper.CACHE_VERSION, "silken tofu")
    with pytest.raises(RuntimeError, match="commit failed"):
        await store_scraper.fetch_store_products("silken tofu", force_refresh=True)

    await asyncio.sleep(0)
    assert calls == ["upsert", "commit", "rollback", "close"]
    assert store_scraper._memory_cache_get(cache_key) is None
    assert store_scraper._inflight == {}

    assert await store_scraper.fetch_store_products("silken tofu", force_refresh=True) == [PRODUCT]
    assert calls == ["upsert", "commit", "rollback", "close", "upsert", "commit", "close"]
    assert writer_attempts == 2


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
async def test_cancelled_leader_does_not_cancel_shared_flight_and_registry_cleans(
    monkeypatch: pytest.MonkeyPatch,
):
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

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive)

    leader = asyncio.create_task(store_scraper.fetch_store_products("tofu", force_refresh=True))
    await asyncio.wait_for(scrape_started.wait(), timeout=1)
    follower = asyncio.create_task(store_scraper.fetch_store_products("TOFU", force_refresh=True))
    await asyncio.sleep(0)
    assert len(store_scraper._inflight) == 1

    leader.cancel()
    with pytest.raises(asyncio.CancelledError):
        await leader
    assert not follower.done()

    allow_scrape.set()
    assert await follower == [PRODUCT]
    await asyncio.sleep(0)
    assert store_scraper._inflight == {}
    assert scrape_calls == 1


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_block_failed_flight_cleanup_or_retry(
    monkeypatch: pytest.MonkeyPatch,
):
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

    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive)

    leader = asyncio.create_task(store_scraper.fetch_store_products("tofu", force_refresh=True))
    await asyncio.wait_for(scrape_started.wait(), timeout=1)
    waiter = asyncio.create_task(store_scraper.fetch_store_products("TOFU", force_refresh=True))
    await asyncio.sleep(0)

    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    allow_failure.set()
    with pytest.raises(store_scraper.StoreScrapeError):
        await leader

    await asyncio.sleep(0)
    assert store_scraper._inflight == {}
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
async def test_old_unvalidated_cache_version_is_inert(monkeypatch: pytest.MonkeyPatch):
    old_product = {**PRODUCT, "name": "Old tofu", "price": "$0.01"}
    fresh_product = {**PRODUCT, "name": "Fresh tofu", "price": "$3.99"}
    store_scraper.CACHE[("weee", "en", "v6", "tofu")] = {
        "data": [old_product],
        "timestamp": 1_000_000.0,
    }
    cache_versions: list[str] = []

    async def database_miss(*args: Any, **kwargs: Any) -> None:
        cache_versions.append(kwargs["cache_version"])
        return None

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return [fresh_product]

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(store_scraper.time, "time", lambda: 1_000_001.0)
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", database_miss)
    monkeypatch.setattr(store_scraper, "_scrape_weee_products", scrape_live)
    monkeypatch.setattr(store_scraper, "_persist_positive_result", persist_positive)

    result = await store_scraper.fetch_store_products("tofu", session=object())

    assert result == [fresh_product]
    assert cache_versions == ["v7"]


@pytest.mark.parametrize(
    "url",
    [
        "http://www.sayweee.com/product/tofu",
        "https://sayweee.com.evil.test/product/tofu",
        "https://evil-sayweee.com/product/tofu",
        "https://user@sayweee.com/product/tofu",
        "https://sayweee.com:444/product/tofu",
    ],
)
def test_live_product_validation_rejects_unsafe_navigation_urls(url: str):
    with pytest.raises(store_scraper.StoreScrapeError, match="no valid products"):
        store_scraper._validate_products([{**PRODUCT, "url": url}])


def test_live_product_validation_accepts_exact_and_subdomain_weee_hosts_case_insensitively():
    products = [
        {**PRODUCT, "url": "https://SAYWEEE.COM/product/tofu"},
        {
            **PRODUCT,
            "name": "Firm tofu",
            "url": "https://shop.sayweee.com/product/firm-tofu",
        },
    ]

    assert store_scraper._validate_products(products) == [
        {**PRODUCT, "url": "https://sayweee.com/product/tofu"},
        {
            **PRODUCT,
            "name": "Firm tofu",
            "url": "https://shop.sayweee.com/product/firm-tofu",
        },
    ]


def test_live_product_validation_accepts_current_official_weee_domain():
    product = {
        **PRODUCT,
        "url": "https://WWW.WEEE.COM/en/product/Dutch-Farms-Grade-A-Jumbo-Eggs/108411?trace_id=release-probe",
    }

    assert store_scraper._validate_products([product]) == [
        {
            **PRODUCT,
            "url": "https://www.weee.com/en/product/Dutch-Farms-Grade-A-Jumbo-Eggs/108411?trace_id=release-probe",
        }
    ]


def test_weee_site_title_strips_current_pipe_suffix():
    assert (
        store_scraper._parse_weee_site_title("Dutch Farms Grade A Jumbo Eggs | Weee!")
        == "Dutch Farms Grade A Jumbo Eggs"
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://www.weee.com/en/product/tofu/1",
        "https://weee.com.evil.test/en/product/tofu/1",
        "https://evil-weee.com/en/product/tofu/1",
        "https://user@weee.com/en/product/tofu/1",
        "https://weee.com:444/en/product/tofu/1",
    ],
)
def test_live_product_validation_rejects_current_domain_lookalikes(url: str):
    with pytest.raises(store_scraper.StoreScrapeError, match="no valid products"):
        store_scraper._validate_products([{**PRODUCT, "url": url}])


@pytest.mark.asyncio
async def test_pdp_enrichment_never_navigates_to_an_unsafe_product_url():
    navigated: list[str] = []

    class Page:
        async def goto(self, url: str, **kwargs: Any) -> None:
            navigated.append(url)

        async def wait_for_selector(self, *args: Any, **kwargs: Any) -> None:
            return None

        async def evaluate(self, *args: Any, **kwargs: Any) -> dict[str, str]:
            return {}

        async def close(self) -> None:
            return None

    class Context:
        async def new_page(self) -> Page:
            return Page()

    await store_scraper._enrich_weee_products_from_detail_pages(
        Context(),
        store_scraper.WEEE_BASE_URL,
        [
            {**PRODUCT, "url": "https://sayweee.com.evil.test/product/tofu"},
            PRODUCT.copy(),
        ],
    )

    assert navigated == [PRODUCT["url"]]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://www.sayweee.com/product/tofu",
        "https://sayweee.com.evil.test/product/tofu",
        "https://user@sayweee.com/product/tofu",
        "https://sayweee.com:444/product/tofu",
    ],
)
async def test_database_cache_read_rejects_unsafe_product_urls(
    monkeypatch: pytest.MonkeyPatch,
    url: str,
):
    now = datetime(2026, 8, 16, 12, tzinfo=timezone.utc)
    row = SimpleNamespace(data=[{**PRODUCT, "url": url}], updated_at=now)

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
        query="tofu",
        store="weee",
        language="en",
        cache_version="v7",
        max_age_seconds=86400,
    ) is None


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
async def test_extraction_keeps_later_distinct_candidates_for_final_validation(
    monkeypatch: pytest.MonkeyPatch,
):
    enriched_urls: list[str] = []
    batch_sizes: list[int] = []
    candidates = [
        {
            "href": PRODUCT["url"],
            "name": PRODUCT["name"],
            "price": PRODUCT["price"],
            "image": PRODUCT["image"],
        },
        {
            "href": PRODUCT["url"] + "?ref=duplicate",
            "name": "Silken tofu duplicate",
            "price": "$3.49",
            "image": PRODUCT["image"],
        },
        {
            "href": "https://www.sayweee.com/product/invalid",
            "name": "x",
            "price": "$1.00",
            "image": PRODUCT["image"],
        },
        {
            "href": "https://www.sayweee.com/product/firm-tofu",
            "name": "Firm tofu",
            "price": "$3.99",
            "image": PRODUCT["image"],
        },
        {
            "href": "https://www.sayweee.com/product/fried-tofu",
            "name": "Fried tofu",
            "price": "$4.99",
            "image": PRODUCT["image"],
        },
    ]

    async def record_enrichment(
        context: object,
        base_url: str,
        products: list[dict[str, str]],
    ) -> None:
        batch_sizes.append(len(products))
        enriched_urls.extend(product["url"] for product in products)

    extracted_products = await _scrape_extracted_candidates(monkeypatch, candidates, record_enrichment)

    assert len(enriched_urls) == 3
    assert batch_sizes == [3]
    assert store_scraper._validate_products(extracted_products) == [
        PRODUCT,
        {
            "name": "Firm tofu",
            "price": "$3.99",
            "image": PRODUCT["image"],
            "url": "https://www.sayweee.com/product/firm-tofu",
        },
        {
            "name": "Fried tofu",
            "price": "$4.99",
            "image": PRODUCT["image"],
            "url": "https://www.sayweee.com/product/fried-tofu",
        },
    ]


@pytest.mark.asyncio
async def test_pdp_enrichment_stops_after_first_batch_has_three_distinct_products(
    monkeypatch: pytest.MonkeyPatch,
):
    enriched_urls: list[str] = []
    batch_sizes: list[int] = []
    candidates = [
        {
            "href": f"https://www.sayweee.com/product/tofu-{index}",
            "name": f"Tofu {index}",
            "price": "$2.99",
            "image": PRODUCT["image"],
        }
        for index in range(40)
    ]

    async def record_enrichment(
        context: object,
        base_url: str,
        products: list[dict[str, str]],
    ) -> None:
        batch_sizes.append(len(products))
        enriched_urls.extend(product["url"] for product in products)

    extracted_products = await _scrape_extracted_candidates(monkeypatch, candidates, record_enrichment)

    assert len(enriched_urls) == 3
    assert batch_sizes == [3]
    assert len(store_scraper._validate_products(extracted_products)) == 3


@pytest.mark.asyncio
async def test_pdp_enrichment_has_an_explicit_twelve_candidate_budget(
    monkeypatch: pytest.MonkeyPatch,
):
    enriched_urls: list[str] = []
    batch_sizes: list[int] = []
    candidates = [
        {
            "href": f"https://www.sayweee.com/product/tofu-{index}",
            "name": f"Tofu {index}",
            "price": "$2.99",
            "image": PRODUCT["image"],
        }
        for index in range(40)
    ]

    async def invalidate_enriched_batch(
        context: object,
        base_url: str,
        products: list[dict[str, str]],
    ) -> None:
        batch_sizes.append(len(products))
        enriched_urls.extend(product["url"] for product in products)
        for product in products:
            product["name"] = "x"

    await _scrape_extracted_candidates(monkeypatch, candidates, invalidate_enriched_batch)

    assert len(enriched_urls) == 12
    assert batch_sizes == [3, 3, 3, 3]


@pytest.mark.asyncio
async def test_cache_and_scrape_logs_have_distinguishable_event_fields(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    scrape_started = asyncio.Event()
    allow_scrape = asyncio.Event()
    calls = 0
    clock = 100.0

    def perf_counter() -> float:
        nonlocal clock
        clock += 0.01
        return clock

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
    monkeypatch.setattr(store_scraper.time, "perf_counter", perf_counter)
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

    async def postgres_hit(*args: Any, **kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(products=[PRODUCT], updated_at=datetime.now(timezone.utc))

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", postgres_hit)
    assert await store_scraper.fetch_store_products("database tofu", session=object()) == [PRODUCT]

    events = {getattr(record, "event", None) for record in caplog.records}
    required_events = {
        "memory_hit",
        "postgres_hit",
        "cache_miss",
        "single_flight_wait",
        "scrape_success",
        "scrape_empty",
        "scrape_failure",
    }
    assert required_events <= events
    for event in required_events:
        matching = [record for record in caplog.records if getattr(record, "event", None) == event]
        assert matching
        assert all(record.elapsed_ms > 0 for record in matching)
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
        updated_at=datetime(2026, 8, 16, 12, tzinfo=timezone.utc),
    )

    assert row.data == [PRODUCT]
    assert session.flush_count == 0
