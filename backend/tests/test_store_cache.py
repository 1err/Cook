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

        def scalar_one(self) -> datetime:
            return now

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

        def scalar_one(self) -> datetime:
            return now

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

        def scalar_one(self) -> datetime:
            return now

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
async def test_single_l2_freshness_uses_database_observation_not_host_clock(
    monkeypatch: pytest.MonkeyPatch,
):
    host_now = datetime(2026, 8, 27, 12, tzinfo=timezone.utc)
    database_observed_at = host_now + timedelta(seconds=31)
    row = SimpleNamespace(
        data=[PRODUCT],
        updated_at=database_observed_at - timedelta(seconds=1),
    )

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz: timezone | None = None) -> datetime:
            return host_now

    class RowScalars:
        def one_or_none(self) -> SimpleNamespace:
            return row

    class RowResult:
        def scalars(self) -> RowScalars:
            return RowScalars()

    class ClockResult:
        def scalar_one(self) -> datetime:
            return database_observed_at

    class Session:
        calls = 0

        async def execute(self, *args: Any, **kwargs: Any) -> object:
            self.calls += 1
            return RowResult() if self.calls == 1 else ClockResult()

    monkeypatch.setattr(repo_store_cache, "datetime", FrozenDateTime)
    entry = await repo_store_cache.get_cached_store_products_with_metadata(
        Session(),  # type: ignore[arg-type]
        query="tofu",
        store="weee",
        language="en",
        cache_version="v7",
        max_age_seconds=86_400,
    )

    assert entry is not None
    assert entry.products == [PRODUCT]
    assert entry.updated_at == database_observed_at - timedelta(seconds=1)
    assert getattr(entry, "observed_at", None) == database_observed_at


@pytest.mark.asyncio
async def test_batch_l2_uses_database_clock_without_extending_exact_expiry(
    monkeypatch: pytest.MonkeyPatch,
):
    host_now = datetime(2026, 8, 27, 12, tzinfo=timezone.utc)
    database_observed_at = host_now + timedelta(seconds=30)
    rows = [
        SimpleNamespace(
            query="fresh",
            language="en",
            data=[PRODUCT],
            updated_at=database_observed_at - timedelta(seconds=1),
        ),
        SimpleNamespace(
            query="exact-expiry",
            language="en",
            data=[PRODUCT],
            updated_at=database_observed_at - timedelta(seconds=86_400),
        ),
    ]

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz: timezone | None = None) -> datetime:
            return host_now

    class RowScalars:
        def all(self) -> list[object]:
            return rows

    class RowResult:
        def scalars(self) -> RowScalars:
            return RowScalars()

    class ClockResult:
        def scalar_one(self) -> datetime:
            return database_observed_at

    class Session:
        calls = 0

        async def execute(self, *args: Any, **kwargs: Any) -> object:
            self.calls += 1
            return RowResult() if self.calls == 1 else ClockResult()

    monkeypatch.setattr(repo_store_cache, "datetime", FrozenDateTime)
    entries = await repo_store_cache.get_cached_store_products_batch(
        Session(),  # type: ignore[arg-type]
        keys=[("fresh", "en"), ("exact-expiry", "en")],
        store="weee",
        cache_version="v7",
        max_age_seconds=86_400,
    )

    assert set(entries) == {("fresh", "en")}
    assert entries[("fresh", "en")].updated_at == (
        database_observed_at - timedelta(seconds=1)
    )
    assert getattr(entries[("fresh", "en")], "observed_at", None) == database_observed_at


@pytest.mark.asyncio
async def test_database_observation_response_delay_cannot_extend_l1_ttl(
    monkeypatch: pytest.MonkeyPatch,
):
    observed_at = datetime(2026, 8, 27, 12, tzinfo=timezone.utc)
    local_monotonic = {"seconds": 100.0}
    row = SimpleNamespace(
        data=[PRODUCT],
        updated_at=observed_at - timedelta(seconds=86_390),
    )

    class RowScalars:
        def one_or_none(self) -> SimpleNamespace:
            return row

    class RowResult:
        def scalars(self) -> RowScalars:
            return RowScalars()

    class ClockResult:
        def scalar_one(self) -> datetime:
            return observed_at

    class Session:
        calls = 0

        async def execute(self, *args: Any, **kwargs: Any) -> object:
            self.calls += 1
            if self.calls == 1:
                return RowResult()
            local_monotonic["seconds"] += 10
            return ClockResult()

    monkeypatch.setattr(
        repo_store_cache.time,
        "monotonic",
        lambda: local_monotonic["seconds"],
    )
    monkeypatch.setattr(
        store_product_service.time,
        "monotonic",
        lambda: local_monotonic["seconds"],
    )
    entry = await repo_store_cache.get_cached_store_products_with_metadata(
        Session(),  # type: ignore[arg-type]
        query="tofu",
        store="weee",
        language="en",
        cache_version="v7",
        max_age_seconds=86_400,
    )

    assert entry is not None
    assert store_product_service._authoritative_cache_age_seconds(entry) is None


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

        def scalar_one(self) -> datetime:
            return now

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
    assert written is None
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
        def one_or_none(self) -> SimpleNamespace:
            return SimpleNamespace(
                data=[rice_one, rice_two, beans],
                updated_at=datetime(2026, 8, 27, tzinfo=timezone.utc),
            )

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
    assert written == repo_store_cache.CachedStoreProducts(
        [rice_one, rice_two, beans],
        datetime(2026, 8, 27, tzinfo=timezone.utc),
    )
    assert compiled.params["data"] == [rice_one, rice_two, beans]


@pytest.mark.asyncio
async def test_upsert_conflict_loser_reads_and_returns_the_authoritative_winner():
    newer_at = datetime(2026, 8, 27, 12, tzinfo=timezone.utc)
    older_at = newer_at - timedelta(seconds=1)
    newer_product = {**PRODUCT, "price": "$12.99"}

    class Result:
        def __init__(self, row: object):
            self.row = row

        def scalar_one_or_none(self) -> None:
            return None

        def one_or_none(self) -> object:
            return self.row

    class Session:
        def __init__(self, winner_at: datetime):
            self.winner_at = winner_at
            self.statements: list[Any] = []

        async def execute(self, statement: Any) -> Result:
            self.statements.append(statement)
            if len(self.statements) % 2:
                return Result(None)
            return Result(SimpleNamespace(data=[newer_product], updated_at=self.winner_at))

    session = Session(newer_at)
    winner = await repo_store_cache.upsert_cached_store_products(
        session,  # type: ignore[arg-type]
        query="silken tofu",
        store="weee",
        language="en",
        cache_version="v7",
        data=[{**PRODUCT, "price": "$9.99"}],
        updated_at=older_at,
    )

    assert winner == repo_store_cache.CachedStoreProducts([newer_product], newer_at)
    assert len(session.statements) == 2
    insert_sql = str(session.statements[0].compile(dialect=postgresql.dialect()))
    assert "INSERT INTO cached_store_products" in insert_sql
    assert "ON CONFLICT (query, store, language, cache_version) DO UPDATE" in insert_sql
    assert "cached_store_products.updated_at < excluded.updated_at" in insert_sql
    assert "RETURNING cached_store_products.data, cached_store_products.updated_at" in insert_sql
    assert "FOR UPDATE" not in insert_sql
    select_sql = str(session.statements[1].compile(dialect=postgresql.dialect()))
    assert "SELECT cached_store_products.data, cached_store_products.updated_at" in select_sql


@pytest.mark.asyncio
async def test_upsert_atomically_replaces_a_future_poisoned_incumbent():
    cached_at = datetime(2026, 8, 27, 12, tzinfo=timezone.utc)
    candidate_product = {**PRODUCT, "price": "$4.99"}

    class Result:
        def scalar_one_or_none(self) -> datetime:
            return cached_at

        def one_or_none(self) -> SimpleNamespace:
            return SimpleNamespace(data=[candidate_product], updated_at=cached_at)

    class Session:
        statement: Any = None

        async def execute(self, statement: Any) -> Result:
            self.statement = statement
            return Result()

    session = Session()
    winner = await repo_store_cache.upsert_cached_store_products(
        session,  # type: ignore[arg-type]
        query="silken tofu",
        store="weee",
        language="en",
        cache_version="v7",
        data=[candidate_product],
        updated_at=cached_at,
    )

    assert winner == repo_store_cache.CachedStoreProducts([candidate_product], cached_at)
    sql = str(session.statement.compile(dialect=postgresql.dialect()))
    assert "cached_store_products.updated_at > clock_timestamp()" in sql
    assert "CURRENT_TIMESTAMP" not in sql
    assert sql.count("clock_timestamp()") >= 2
    assert "cached_store_products.updated_at < excluded.updated_at" in sql

    transaction_started_at = datetime(2026, 8, 27, 12, tzinfo=timezone.utc)
    candidate_started_at = transaction_started_at
    concurrent_winner_at = transaction_started_at + timedelta(seconds=1)
    conflict_evaluated_at = transaction_started_at + timedelta(seconds=2)
    frozen_transaction_clock_would_overwrite = (
        concurrent_winner_at < candidate_started_at
        or concurrent_winner_at > transaction_started_at
    )
    volatile_evaluation_clock_preserves_winner = not (
        concurrent_winner_at < candidate_started_at
        or concurrent_winner_at > conflict_evaluated_at
    )
    assert frozen_transaction_clock_would_overwrite is True
    assert volatile_evaluation_clock_preserves_winner is True


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
