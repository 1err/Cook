import asyncio
from datetime import datetime, timedelta, timezone
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
def clear_service_cache():
    service.CACHE.clear()
    yield
    service.CACHE.clear()


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

    class WriteSession:
        async def commit(self):
            commit_started.set()
            await release.wait()

        async def rollback(self):
            return None

    class Context:
        async def __aenter__(self):
            return WriteSession()

        async def __aexit__(self, *args):
            return None

    async def upsert(*args, **kwargs):
        return None

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_return([TOFU]))
    monkeypatch.setattr(db_session, "async_session_maker", lambda: Context())
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", upsert)
    task = asyncio.create_task(service.fetch_store_products("tofu", force_refresh=True))
    await commit_started.wait()
    assert not task.done()
    assert service._memory_cache_get(("weee", "en", service.CACHE_VERSION, "tofu")) is None
    release.set()
    assert await task == [TOFU]


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
