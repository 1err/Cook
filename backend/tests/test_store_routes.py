from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.api import admin, routes_store
from app.db import repo_store_cache


PRODUCT = {
    "name": "Silken tofu",
    "price": "$2.99",
    "image": "https://images.example.test/tofu.jpg",
    "url": "https://www.sayweee.com/product/tofu",
}


@pytest.mark.asyncio
@pytest.mark.parametrize("store", [None, "weee", " WEEE "])
async def test_store_products_accepts_only_the_weee_default_and_legacy_value(
    monkeypatch: pytest.MonkeyPatch,
    store: str | None,
):
    session = object()
    calls: list[tuple[str, object | None]] = []

    async def fetch(query: str, session: object | None = None) -> list[dict[str, str]]:
        calls.append((query, session))
        return [PRODUCT]

    monkeypatch.setattr(routes_store, "fetch_store_products", fetch)

    result = await routes_store.store_products(
        query="silken tofu",
        store=store,
        session=session,  # type: ignore[arg-type]
        current_user=object(),  # type: ignore[arg-type]
    )

    assert result == [PRODUCT]
    assert calls == [("silken tofu", session)]


@pytest.mark.asyncio
async def test_store_products_rejects_amazon_before_fetching(monkeypatch: pytest.MonkeyPatch):
    fetch_calls = 0

    async def unexpected_fetch(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        nonlocal fetch_calls
        fetch_calls += 1
        return []

    monkeypatch.setattr(routes_store, "fetch_store_products", unexpected_fetch)

    with pytest.raises(HTTPException) as exc_info:
        await routes_store.store_products(
            query="silken tofu",
            store="amazon",
            session=object(),  # type: ignore[arg-type]
            current_user=object(),  # type: ignore[arg-type]
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Unsupported store. Use weee."
    assert fetch_calls == 0


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
