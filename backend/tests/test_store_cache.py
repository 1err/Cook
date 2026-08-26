"""Repository cache regressions and legacy import compatibility."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.dialects import postgresql

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


def test_cache_freshness_rejects_future_updated_at_without_clock_skew_allowance():
    now = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)

    assert not repo_store_cache.is_cache_entry_fresh(
        now + timedelta(microseconds=1),
        now,
        86_400,
    )
    assert repo_store_cache.is_cache_entry_fresh(now, now, 86_400)
    for invalid in (float("nan"), float("inf"), float("-inf"), "invalid"):
        assert not repo_store_cache.is_cache_entry_fresh(  # type: ignore[arg-type]
            invalid,
            now,
            86_400,
        )


@pytest.mark.asyncio
async def test_single_database_cache_rejects_future_and_invalid_updated_at(
    monkeypatch: pytest.MonkeyPatch,
):
    now = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz: timezone | None = None) -> datetime:
            return now

    monkeypatch.setattr(repo_store_cache, "datetime", FrozenDateTime)

    class Scalars:
        def __init__(self, row: object):
            self.row = row

        def one_or_none(self) -> object:
            return self.row

    class Result:
        def __init__(self, row: object):
            self.row = row

        def scalars(self) -> Scalars:
            return Scalars(self.row)

    class Session:
        def __init__(self, row: object):
            self.row = row

        async def execute(self, *args: Any, **kwargs: Any) -> Result:
            return Result(self.row)

    for updated_at in (
        now + timedelta(seconds=1),
        float("nan"),
        float("inf"),
        float("-inf"),
        "invalid",
    ):
        assert await repo_store_cache.get_cached_store_products_with_metadata(
            Session(SimpleNamespace(data=[PRODUCT], updated_at=updated_at)),  # type: ignore[arg-type]
            query="tofu",
            store="weee",
            language="en",
            cache_version="v7",
            max_age_seconds=86_400,
        ) is None


@pytest.mark.asyncio
async def test_batch_database_cache_rejects_future_rows(
    monkeypatch: pytest.MonkeyPatch,
):
    now = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    rows = [
        SimpleNamespace(
            query="future",
            language="en",
            data=[PRODUCT],
            updated_at=now + timedelta(microseconds=1),
        ),
        SimpleNamespace(
            query="nan",
            language="en",
            data=[PRODUCT],
            updated_at=float("nan"),
        ),
        SimpleNamespace(
            query="infinity",
            language="en",
            data=[PRODUCT],
            updated_at=float("inf"),
        ),
        SimpleNamespace(
            query="invalid",
            language="en",
            data=[PRODUCT],
            updated_at="invalid",
        ),
        SimpleNamespace(
            query="current",
            language="en",
            data=[PRODUCT],
            updated_at=now,
        ),
    ]

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz: timezone | None = None) -> datetime:
            return now

    class Scalars:
        def all(self) -> list[object]:
            return rows

    class Result:
        def scalars(self) -> Scalars:
            return Scalars()

    class Session:
        async def execute(self, *args: Any, **kwargs: Any) -> Result:
            return Result()

    monkeypatch.setattr(repo_store_cache, "datetime", FrozenDateTime)
    entries = await repo_store_cache.get_cached_store_products_batch(
        Session(),  # type: ignore[arg-type]
        keys=[
            ("future", "en"),
            ("nan", "en"),
            ("infinity", "en"),
            ("invalid", "en"),
            ("current", "en"),
        ],
        store="weee",
        cache_version="v7",
        max_age_seconds=86_400,
    )

    assert set(entries) == {("current", "en")}


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
    class Session:
        execute_count = 0

        async def execute(self, *args: Any, **kwargs: Any) -> object:
            self.execute_count += 1
            raise AssertionError("an empty candidate must never reach PostgreSQL")

    session = Session()
    written = await repo_store_cache.upsert_cached_store_products(
        session,  # type: ignore[arg-type]
        query="silken tofu", store="weee", language="en", cache_version="v7", data=[],
        updated_at=datetime(2026, 8, 16, 12, tzinfo=timezone.utc),
    )
    assert written is False
    assert session.execute_count == 0


@pytest.mark.asyncio
async def test_upsert_keeps_distinct_weights_and_uses_shared_safe_deduplication():
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

    class Result:
        def scalar_one_or_none(self) -> datetime:
            return datetime(2026, 8, 27, tzinfo=timezone.utc)

    class Session:
        statement: Any = None

        async def execute(self, statement: Any) -> Result:
            self.statement = statement
            return Result()

    session = Session()
    written = await repo_store_cache.upsert_cached_store_products(
        session,  # type: ignore[arg-type]
        query="rice",
        store="weee",
        language="en",
        cache_version="v7",
        data=[
            rice_one,
            rice_two,
            {**rice_one, "name": "RICE 1 LB"},
            {"name": "Unsafe", "price": "$1", "image": "", "url": "https://evil.test/product/unsafe"},
            beans,
            PRODUCT,
        ],
        updated_at=datetime(2026, 8, 27, tzinfo=timezone.utc),
    )

    compiled = session.statement.compile(dialect=postgresql.dialect())
    assert written is True
    assert compiled.params["data"] == [rice_one, rice_two, beans]


@pytest.mark.asyncio
async def test_upsert_is_one_atomic_strictly_monotonic_postgresql_statement():
    newer_at = datetime(2026, 8, 27, 12, tzinfo=timezone.utc)
    older_at = newer_at - timedelta(seconds=1)

    class Result:
        def scalar_one_or_none(self) -> None:
            return None

    class Session:
        statements: list[Any] = []

        async def execute(self, statement: Any) -> Result:
            self.statements.append(statement)
            return Result()

    session = Session()
    written = await repo_store_cache.upsert_cached_store_products(
        session,  # type: ignore[arg-type]
        query="silken tofu",
        store="weee",
        language="en",
        cache_version="v7",
        data=[{**PRODUCT, "price": "$9.99"}],
        updated_at=older_at,
    )

    assert written is False

    equal_generation_written = await repo_store_cache.upsert_cached_store_products(
        session,  # type: ignore[arg-type]
        query="silken tofu",
        store="weee",
        language="en",
        cache_version="v7",
        data=[{**PRODUCT, "price": "$8.99"}],
        updated_at=newer_at,
    )

    assert equal_generation_written is False
    assert len(session.statements) == 2
    for statement in session.statements:
        sql = str(statement.compile(dialect=postgresql.dialect()))
        assert "INSERT INTO cached_store_products" in sql
        assert "ON CONFLICT (query, store, language, cache_version) DO UPDATE" in sql
        assert "cached_store_products.updated_at < excluded.updated_at" in sql
        assert "RETURNING cached_store_products.updated_at" in sql
        assert "FOR UPDATE" not in sql


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
