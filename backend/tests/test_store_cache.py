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

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products", unexpected_database)
    monkeypatch.setattr(store_scraper, "_scrape_store_products", unexpected_scrape, raising=False)

    assert await store_scraper.fetch_weee_products("silken tofu", session=object()) == [PRODUCT]


@pytest.mark.asyncio
async def test_fresh_postgresql_hit_repopulates_memory_and_skips_scrape(monkeypatch: pytest.MonkeyPatch):
    database_calls = 0

    async def fresh_database(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        nonlocal database_calls
        database_calls += 1
        return [PRODUCT]

    async def unexpected_scrape(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        raise AssertionError("a fresh PostgreSQL result must skip scraping")

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products", fresh_database)
    monkeypatch.setattr(store_scraper, "_scrape_store_products", unexpected_scrape, raising=False)

    first = await store_scraper.fetch_weee_products("silken tofu", session=object())
    second = await store_scraper.fetch_weee_products("silken tofu", session=object())

    assert first == [PRODUCT]
    assert second == [PRODUCT]
    assert database_calls == 1


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

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products", expired_database)
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", persist_positive)
    monkeypatch.setattr(store_scraper, "_scrape_store_products", scrape_live, raising=False)
    store_scraper.CACHE[("weee", "en", store_scraper.CACHE_VERSION, "stale tofu")] = {
        "data": [stale_product],
        "timestamp": 0,
    }

    result = await store_scraper.fetch_weee_products("stale tofu", session=object())

    assert result == [scraped_product]
    assert result != [stale_product]
    assert scrape_calls == 1


@pytest.mark.asyncio
async def test_positive_live_scrape_persists_weee_before_future_call_uses_memory(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[str] = []

    async def cache_miss(*args: Any, **kwargs: Any) -> None:
        return None

    async def scrape_live(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        calls.append("scrape")
        return [PRODUCT]

    async def persist_positive(*args: Any, **kwargs: Any) -> None:
        assert kwargs["store"] == "weee"
        assert kwargs["data"] == [PRODUCT]
        calls.append("upsert")

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products", cache_miss)
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", persist_positive)
    monkeypatch.setattr(store_scraper, "_scrape_store_products", scrape_live, raising=False)

    first = await store_scraper.fetch_weee_products("silken tofu", session=object())
    second = await store_scraper.fetch_weee_products("silken tofu", session=object())

    assert first == [PRODUCT]
    assert second == [PRODUCT]
    assert calls == ["scrape", "upsert"]


@pytest.mark.asyncio
async def test_empty_live_result_never_overwrites_a_positive_cache_entry(monkeypatch: pytest.MonkeyPatch):
    async def cache_miss(*args: Any, **kwargs: Any) -> None:
        return None

    async def scrape_empty(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return []

    async def unexpected_upsert(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("an empty scrape must not overwrite cached products")

    monkeypatch.setattr(repo_store_cache, "get_cached_store_products", cache_miss)
    monkeypatch.setattr(repo_store_cache, "upsert_cached_store_products", unexpected_upsert)
    monkeypatch.setattr(store_scraper, "_scrape_store_products", scrape_empty, raising=False)

    assert await store_scraper.fetch_weee_products("silken tofu", session=object()) == []


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
