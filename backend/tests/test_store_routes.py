from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any
import asyncio

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api import admin, routes_store
from app.db import repo_store_cache
from app.services.store_product_service import BatchStoreProductsEntry
from app.services import store_product_service, weee_scraper


PRODUCT = {
    "name": "Silken tofu",
    "price": "$2.99",
    "image": "https://images.example.test/tofu.jpg",
    "url": "https://www.sayweee.com/product/tofu",
}

CACHED_AT = datetime(2026, 8, 27, tzinfo=timezone.utc)


def authenticated_store_app() -> FastAPI:
    app = FastAPI()
    app.include_router(routes_store.router)
    app.dependency_overrides[routes_store.get_session] = lambda: object()
    app.dependency_overrides[routes_store.get_current_user] = lambda: object()
    return app


@pytest.mark.asyncio
async def test_retryable_scrape_failure_maps_to_503_with_retry_after(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.weee_scraper import StoreScrapeError

    async def fail(*args: Any, **kwargs: Any) -> SimpleNamespace:
        raise StoreScrapeError("selector never became trustworthy")

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", fail)
    app = authenticated_store_app()
    with TestClient(app) as client:
        response = client.get("/store-products", params={"query": "garlic"})

    assert response.status_code == 503
    assert response.headers["retry-after"] == "3"
    assert response.json() == {"detail": {"code": "weee_temporarily_unavailable"}}


def test_batch_route_returns_fresh_and_missing_in_cleaned_order(
    monkeypatch: pytest.MonkeyPatch,
):
    async def batch(*args: Any, **kwargs: Any) -> list[BatchStoreProductsEntry]:
        return [
            BatchStoreProductsEntry("Garlic", "fresh", [PRODUCT], CACHED_AT),
            BatchStoreProductsEntry("ginger", "missing", [], None),
        ]

    monkeypatch.setattr(routes_store, "fetch_cached_store_products_batch", batch)
    app = authenticated_store_app()
    with TestClient(app) as client:
        response = client.post(
            "/store-products/batch",
            json={"queries": [" Garlic ", "garlic", "", "ginger"]},
        )

    assert response.status_code == 200
    assert response.json() == {
        "entries": [
            {
                "query": "Garlic",
                "status": "fresh",
                "products": [PRODUCT],
                "expires_at": "2026-08-28T00:00:00Z",
            },
            {"query": "ginger", "status": "missing", "products": [], "expires_at": None},
        ]
    }


def test_batch_route_accepts_more_than_fifty_inputs_without_live_scraping(
    monkeypatch: pytest.MonkeyPatch,
):
    observed_queries: list[str] = []

    async def batch(queries: list[str], *args: Any, **kwargs: Any) -> list[BatchStoreProductsEntry]:
        observed_queries.extend(queries)
        return [BatchStoreProductsEntry(query, "missing", [], None) for query in queries]

    async def unexpected_live_scrape(*args: Any, **kwargs: Any) -> SimpleNamespace:
        raise AssertionError("batch cache lookup must not invoke live scraping")

    monkeypatch.setattr(routes_store, "fetch_cached_store_products_batch", batch)
    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", unexpected_live_scrape)
    queries = [f"ingredient-{index}" for index in range(75)]
    app = authenticated_store_app()
    with TestClient(app) as client:
        response = client.post("/store-products/batch", json={"queries": queries})

    assert response.status_code == 200
    assert observed_queries == queries
    assert response.json() == {
        "entries": [
            {"query": query, "status": "missing", "products": [], "expires_at": None}
            for query in queries
        ]
    }


@pytest.mark.asyncio
async def test_store_products_omitted_store_returns_authoritative_expiry_metadata(
    monkeypatch: pytest.MonkeyPatch,
):
    session = object()
    calls: list[tuple[str, object | None, bool]] = []

    cached_at = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)

    async def fetch(
        query: str,
        session: object | None = None,
        *,
        release_read_session_on_miss: bool = False,
    ) -> SimpleNamespace:
        calls.append((query, session, release_read_session_on_miss))
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
    assert calls == [("silken tofu", session, True)]


@pytest.mark.asyncio
@pytest.mark.parametrize("store", ["weee", " WEEE "])
async def test_store_products_explicit_legacy_weee_returns_the_product_array(
    monkeypatch: pytest.MonkeyPatch,
    store: str,
):
    session = object()
    calls: list[tuple[str, object | None, bool]] = []
    cached_at = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)

    async def fetch(
        query: str,
        session: object | None = None,
        *,
        release_read_session_on_miss: bool = False,
    ) -> SimpleNamespace:
        calls.append((query, session, release_read_session_on_miss))
        return SimpleNamespace(products=[PRODUCT], cached_at=cached_at)

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", fetch)

    result = await routes_store.store_products(
        query="silken tofu",
        store=store,
        session=session,  # type: ignore[arg-type]
        current_user=object(),  # type: ignore[arg-type]
    )

    assert result == [routes_store.StoreProduct(**PRODUCT)]
    assert calls == [("silken tofu", session, True)]


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


@pytest.mark.parametrize("query", ["   ", "\t\n", "\u2003\u2009"])
@pytest.mark.parametrize("store", [None, "weee"])
def test_store_products_rejects_all_unicode_whitespace_at_the_route_boundary(
    monkeypatch: pytest.MonkeyPatch,
    query: str,
    store: str | None,
):
    calls = 0

    async def unexpected_fetch(*args: Any, **kwargs: Any) -> SimpleNamespace:
        nonlocal calls
        calls += 1
        return SimpleNamespace(products=[], cached_at=None)

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", unexpected_fetch)
    app = authenticated_store_app()
    with TestClient(app) as client:
        response = client.get(
            "/store-products",
            params={"query": query, **({"store": store} if store is not None else {})},
        )

    assert 400 <= response.status_code < 500
    assert calls == 0


@pytest.mark.asyncio
async def test_unsupported_store_validation_precedes_whitespace_query_validation(
    monkeypatch: pytest.MonkeyPatch,
):
    async def unexpected_fetch(*args: Any, **kwargs: Any) -> SimpleNamespace:
        raise AssertionError("invalid route input must not reach the service")

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", unexpected_fetch)
    with pytest.raises(HTTPException) as exc_info:
        await routes_store.store_products(
            query="\u2003",
            store="amazon",
            session=object(),  # type: ignore[arg-type]
            current_user=object(),  # type: ignore[arg-type]
        )
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Unsupported store. Use weee."


@pytest.mark.asyncio
async def test_cold_authenticated_routes_release_read_sessions_before_scrape_wait(
    monkeypatch: pytest.MonkeyPatch,
):
    sessions: list[object] = []
    scrape_started = asyncio.Event()
    release_scrape = asyncio.Event()

    class ReadSession:
        def __init__(self) -> None:
            self.closed = asyncio.Event()

        async def close(self) -> None:
            self.closed.set()

        async def commit(self) -> None:
            return None

        async def rollback(self) -> None:
            return None

    async def session_dependency():
        session = ReadSession()
        sessions.append(session)
        yield session

    async def database_miss(*args: Any, **kwargs: Any) -> None:
        return None

    async def scrape(query_text: str, language: str) -> list[dict[str, str]]:
        scrape_started.set()
        await release_scrape.wait()
        return [{
            "name": query_text,
            "price": "$1",
            "image": "",
            "url": f"https://www.weee.com/en/product/{query_text}/1",
        }]

    async def no_persist(*args: Any, **kwargs: Any) -> None:
        return None

    await store_product_service.reset_for_tests()
    store_product_service.start_live_lookup_admission()
    store_product_service.CACHE.clear()
    monkeypatch.setattr(
        repo_store_cache,
        "get_cached_store_products_with_metadata",
        database_miss,
    )
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(store_product_service, "_persist_positive_result", no_persist)
    app = FastAPI()
    app.include_router(routes_store.router)
    app.dependency_overrides[routes_store.get_session] = session_dependency
    app.dependency_overrides[routes_store.get_current_user] = lambda: object()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        requests = [
            asyncio.create_task(client.get("/store-products", params={"query": f"item-{index}"}))
            for index in range(3)
        ]
        await scrape_started.wait()
        for _ in range(100):
            if len(sessions) == 3 and all(session.closed.is_set() for session in sessions):
                break
            await asyncio.sleep(0)
        assert len(sessions) == 3
        assert all(session.closed.is_set() for session in sessions)
        release_scrape.set()
        responses = await asyncio.gather(*requests)
    assert [response.status_code for response in responses] == [200, 200, 200]
    await store_product_service.reset_for_tests()


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
