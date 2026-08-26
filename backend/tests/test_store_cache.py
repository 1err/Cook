"""Repository cache regressions and legacy import compatibility."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from app.db import repo_store_cache
from app.services import store_product_service, store_scraper, weee_scraper


PRODUCT = {
    "name": "Silken tofu",
    "price": "$2.99",
    "image": "https://images.example.test/tofu.jpg",
    "url": "https://www.sayweee.com/product/tofu",
}


@pytest.mark.asyncio
async def test_database_cache_does_not_return_a_row_at_exactly_twenty_four_hours(
    monkeypatch: pytest.MonkeyPatch,
):
    now = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    row = SimpleNamespace(data=[PRODUCT], updated_at=now - timedelta(seconds=86_400))

    class Scalars:
        def one_or_none(self) -> SimpleNamespace:
            return row

    class Result:
        def scalars(self) -> Scalars:
            return Scalars()

    class Session:
        async def execute(self, *args: Any, **kwargs: Any) -> Result:
            return Result()

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz: timezone | None = None) -> datetime:
            return now

    monkeypatch.setattr(repo_store_cache, "datetime", FrozenDateTime)
    assert await repo_store_cache.get_cached_store_products(
        Session(),  # type: ignore[arg-type]
        query="silken tofu", store="weee", language="en", cache_version="v7", max_age_seconds=86_400,
    ) is None


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

    class Scalars:
        def one_or_none(self) -> SimpleNamespace:
            return row

    class Result:
        def scalars(self) -> Scalars:
            return Scalars()

    class Session:
        async def execute(self, *args: Any, **kwargs: Any) -> Result:
            return Result()

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz: timezone | None = None) -> datetime:
            return now

    monkeypatch.setattr(repo_store_cache, "datetime", FrozenDateTime)
    assert await repo_store_cache.get_cached_store_products(
        Session(),  # type: ignore[arg-type]
        query="tofu", store="weee", language="en", cache_version="v7", max_age_seconds=86_400,
    ) is None


@pytest.mark.asyncio
async def test_empty_upsert_preserves_an_existing_positive_database_entry():
    row = SimpleNamespace(data=[PRODUCT])

    class Scalars:
        def one_or_none(self) -> SimpleNamespace:
            return row

    class Result:
        def scalars(self) -> Scalars:
            return Scalars()

    class Session:
        flush_count = 0

        async def execute(self, *args: Any, **kwargs: Any) -> Result:
            return Result()

        async def flush(self) -> None:
            self.flush_count += 1

    session = Session()
    await repo_store_cache.upsert_cached_store_products(
        session,  # type: ignore[arg-type]
        query="silken tofu", store="weee", language="en", cache_version="v7", data=[],
        updated_at=datetime(2026, 8, 16, 12, tzinfo=timezone.utc),
    )
    assert row.data == [PRODUCT]
    assert session.flush_count == 0


def test_store_scraper_is_a_public_compatibility_facade():
    assert store_scraper.__all__ == [
        "CACHE",
        "CACHE_TTL_SECONDS",
        "CACHE_VERSION",
        "BatchStoreProductsEntry",
        "StoreProductsResult",
        "StoreScrapeError",
        "fetch_cached_store_products_batch",
        "fetch_store_products",
        "fetch_store_products_with_metadata",
        "prepare_store_query",
    ]
    for name in (
        "CACHE",
        "CACHE_TTL_SECONDS",
        "CACHE_VERSION",
        "BatchStoreProductsEntry",
        "StoreProductsResult",
        "fetch_cached_store_products_batch",
        "fetch_store_products",
        "fetch_store_products_with_metadata",
        "prepare_store_query",
    ):
        assert getattr(store_scraper, name) is getattr(store_product_service, name)
    assert store_scraper.StoreScrapeError is weee_scraper.StoreScrapeError
