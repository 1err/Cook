from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api import admin, routes_store
from app.db import repo_store_cache


PRODUCT = {
    "name": "Silken tofu",
    "price": "$2.99",
    "image": "https://images.example.test/tofu.jpg",
    "url": "https://www.sayweee.com/product/tofu",
}


@pytest.mark.asyncio
async def test_store_products_omitted_store_returns_authoritative_expiry_metadata(
    monkeypatch: pytest.MonkeyPatch,
):
    session = object()
    calls: list[tuple[str, object | None]] = []

    cached_at = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)

    async def fetch(query: str, session: object | None = None) -> SimpleNamespace:
        calls.append((query, session))
        return SimpleNamespace(products=[PRODUCT], cached_at=cached_at)

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", fetch)

    result = await routes_store.store_products(
        query="silken tofu",
        store=None,
        session=session,  # type: ignore[arg-type]
        current_user=object(),  # type: ignore[arg-type]
    )

    assert result.products == [routes_store.StoreProduct(**PRODUCT)]
    assert result.expires_at == cached_at + timedelta(seconds=86400)
    assert calls == [("silken tofu", session)]


@pytest.mark.asyncio
@pytest.mark.parametrize("store", ["weee", " WEEE "])
async def test_store_products_explicit_legacy_weee_returns_the_product_array(
    monkeypatch: pytest.MonkeyPatch,
    store: str,
):
    session = object()
    calls: list[tuple[str, object | None]] = []
    cached_at = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)

    async def fetch(query: str, session: object | None = None) -> SimpleNamespace:
        calls.append((query, session))
        return SimpleNamespace(products=[PRODUCT], cached_at=cached_at)

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", fetch)

    result = await routes_store.store_products(
        query="silken tofu",
        store=store,
        session=session,  # type: ignore[arg-type]
        current_user=object(),  # type: ignore[arg-type]
    )

    assert result == [routes_store.StoreProduct(**PRODUCT)]
    assert calls == [("silken tofu", session)]


def test_store_products_http_contract_and_openapi_describe_both_response_shapes(
    monkeypatch: pytest.MonkeyPatch,
):
    cached_at = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)

    async def fetch(*args: Any, **kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(products=[PRODUCT], cached_at=cached_at)

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", fetch)
    app = FastAPI()
    app.include_router(routes_store.router)
    app.dependency_overrides[routes_store.get_session] = lambda: object()
    app.dependency_overrides[routes_store.get_current_user] = lambda: object()

    with TestClient(app) as client:
        modern = client.get("/store-products", params={"query": "silken tofu"})
        legacy = client.get(
            "/store-products",
            params={"query": "silken tofu", "store": "weee"},
        )

    assert modern.status_code == 200
    assert modern.json() == {
        "products": [PRODUCT],
        "expires_at": "2026-08-16T12:00:00Z",
    }
    assert legacy.status_code == 200
    assert legacy.json() == [PRODUCT]

    response_schema = app.openapi()["paths"]["/store-products"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]
    assert response_schema == {
        "anyOf": [
            {"$ref": "#/components/schemas/StoreProductsResponse"},
            {"items": {"$ref": "#/components/schemas/StoreProduct"}, "type": "array"},
        ],
        "title": "Response Store Products Store Products Get",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("store", ["amazon", "unknown", ""])
async def test_store_products_rejects_explicit_unsupported_store_before_fetching(
    monkeypatch: pytest.MonkeyPatch,
    store: str,
):
    fetch_calls = 0

    async def unexpected_fetch(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        nonlocal fetch_calls
        fetch_calls += 1
        return []

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", unexpected_fetch)

    with pytest.raises(HTTPException) as exc_info:
        await routes_store.store_products(
            query="silken tofu",
            store=store,
            session=object(),  # type: ignore[arg-type]
            current_user=object(),  # type: ignore[arg-type]
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Unsupported store. Use weee."
    assert fetch_calls == 0


@pytest.mark.asyncio
async def test_store_products_empty_response_has_an_explicit_null_expiry(
    monkeypatch: pytest.MonkeyPatch,
):
    async def fetch(*args: Any, **kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(products=[], cached_at=None)

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", fetch)

    result = await routes_store.store_products(
        query="no result",
        store=None,
        session=object(),  # type: ignore[arg-type]
        current_user=object(),  # type: ignore[arg-type]
    )

    assert result.products == []
    assert result.expires_at is None


@pytest.mark.asyncio
async def test_store_products_explicit_legacy_weee_returns_an_empty_array_without_expiry(
    monkeypatch: pytest.MonkeyPatch,
):
    async def fetch(*args: Any, **kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(products=[], cached_at=None)

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", fetch)

    result = await routes_store.store_products(
        query="no result",
        store="weee",
        session=object(),  # type: ignore[arg-type]
        current_user=object(),  # type: ignore[arg-type]
    )

    assert result == []


@pytest.mark.asyncio
async def test_cache_preview_filters_every_repository_read_to_weee(monkeypatch: pytest.MonkeyPatch):
    list_calls: list[dict[str, Any]] = []
    count_calls: list[dict[str, Any]] = []

    async def list_entries(session: object, **kwargs: Any) -> list[SimpleNamespace]:
        list_calls.append(kwargs)
        return []

    async def count_entries(session: object, **kwargs: Any) -> int:
        count_calls.append(kwargs)
        return 0

    monkeypatch.setattr(admin.repo_store_cache, "list_cached_store_product_entries", list_entries)
    monkeypatch.setattr(admin.repo_store_cache, "count_cached_store_product_entries", count_entries)

    response = await admin.cache_preview(
        stale_only=False,
        limit=100,
        offset=0,
        session=object(),  # type: ignore[arg-type]
        current_user=object(),  # type: ignore[arg-type]
    )

    assert response.items == []
    assert list_calls
    assert count_calls
    assert all(call["store"] == "weee" for call in [*list_calls, *count_calls])


@pytest.mark.asyncio
async def test_repository_list_and_count_apply_the_requested_store_filter():
    statements: list[Any] = []

    class Result:
        def scalars(self) -> "Result":
            return self

        def all(self) -> list[Any]:
            return []

        def scalar_one(self) -> int:
            return 0

    class Session:
        async def execute(self, statement: Any) -> Result:
            statements.append(statement)
            return Result()

    session = Session()
    await repo_store_cache.list_cached_store_product_entries(
        session,  # type: ignore[arg-type]
        store="weee",
    )
    await repo_store_cache.count_cached_store_product_entries(
        session,  # type: ignore[arg-type]
        store="weee",
    )

    assert len(statements) == 2
    for statement in statements:
        compiled = statement.compile()
        assert "cached_store_products.store" in str(compiled)
        assert "weee" in compiled.params.values()


@pytest.mark.asyncio
async def test_repository_stale_filters_include_the_exact_24_hour_boundary():
    statements: list[Any] = []
    cutoff = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)

    class Result:
        def scalars(self) -> "Result":
            return self

        def all(self) -> list[Any]:
            return []

        def scalar_one(self) -> int:
            return 0

    class Session:
        async def execute(self, statement: Any) -> Result:
            statements.append(statement)
            return Result()

    session = Session()
    await repo_store_cache.list_cached_store_product_entries(
        session,  # type: ignore[arg-type]
        updated_before=cutoff,
    )
    await repo_store_cache.count_cached_store_product_entries(
        session,  # type: ignore[arg-type]
        updated_before=cutoff,
    )

    assert len(statements) == 2
    for statement in statements:
        assert "cached_store_products.updated_at <=" in str(statement.compile())


@pytest.mark.asyncio
async def test_admin_preview_uses_the_exact_24_hour_cutoff(
    monkeypatch: pytest.MonkeyPatch,
):
    now = datetime(2026, 8, 16, 12, tzinfo=timezone.utc)
    expected_cutoff = now - timedelta(seconds=admin.CACHE_TTL_SECONDS)
    list_calls: list[dict[str, Any]] = []
    count_calls: list[dict[str, Any]] = []

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz: timezone | None = None) -> datetime:
            return now

    async def list_entries(session: object, **kwargs: Any) -> list[SimpleNamespace]:
        list_calls.append(kwargs)
        return []

    async def count_entries(session: object, **kwargs: Any) -> int:
        count_calls.append(kwargs)
        return 0

    monkeypatch.setattr(admin, "datetime", FrozenDateTime)
    monkeypatch.setattr(admin.repo_store_cache, "list_cached_store_product_entries", list_entries)
    monkeypatch.setattr(admin.repo_store_cache, "count_cached_store_product_entries", count_entries)

    await admin.cache_preview(
        stale_only=True,
        limit=100,
        offset=0,
        session=object(),  # type: ignore[arg-type]
        current_user=object(),  # type: ignore[arg-type]
    )

    stale_cutoffs = [
        call["updated_before"]
        for call in [*list_calls, *count_calls]
        if call.get("updated_before") is not None
    ]
    assert stale_cutoffs
    assert all(cutoff == expected_cutoff for cutoff in stale_cutoffs)


@pytest.mark.asyncio
async def test_cache_refresh_one_always_uses_weee_service_and_cache_key(
    monkeypatch: pytest.MonkeyPatch,
):
    dummy_session = SimpleNamespace(commit_calls=0)

    async def commit() -> None:
        dummy_session.commit_calls += 1

    dummy_session.commit = commit
    fetch_calls: list[tuple[str, object, bool]] = []
    entry_calls: list[dict[str, Any]] = []

    async def fetch(
        query: str,
        session: object | None = None,
        *,
        force_refresh: bool = False,
    ) -> list[dict[str, str]]:
        fetch_calls.append((query, session, force_refresh))
        return [PRODUCT]

    async def get_entry(service_session: object, **kwargs: Any) -> None:
        entry_calls.append(kwargs)
        return None

    monkeypatch.setattr(admin, "fetch_store_products", fetch)
    monkeypatch.setattr(admin.repo_store_cache, "get_cached_store_product_entry", get_entry)

    response = await admin.cache_refresh_one(
        body=admin.CacheRefreshOneBody(query="Silken tofu"),
        session=dummy_session,  # type: ignore[arg-type]
        current_user=object(),  # type: ignore[arg-type]
    )

    assert fetch_calls == [("Silken tofu", dummy_session, True)]
    assert entry_calls == [
        {
            "query": "silken tofu",
            "store": "weee",
            "language": "en",
            "cache_version": admin.CACHE_VERSION,
        }
    ]
    assert response.store == "weee"
    assert dummy_session.commit_calls == 1
