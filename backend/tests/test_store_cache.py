"""Repository and legacy store-scraper regressions.

Cache service behavior lives in test_store_product_service.py.  The scraper
tests remain here until the compatibility shim is introduced.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import sys
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

from app.db import repo_store_cache
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
        {**PRODUCT, "name": "Firm tofu", "url": "https://shop.sayweee.com/product/firm-tofu"},
    ]
    assert store_scraper._validate_products(products) == [
        {**PRODUCT, "url": "https://sayweee.com/product/tofu"},
        {**PRODUCT, "name": "Firm tofu", "url": "https://shop.sayweee.com/product/firm-tofu"},
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
    assert store_scraper._parse_weee_site_title("Dutch Farms Grade A Jumbo Eggs | Weee!") == "Dutch Farms Grade A Jumbo Eggs"


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
        Context(), store_scraper.WEEE_BASE_URL,
        [{**PRODUCT, "url": "https://sayweee.com.evil.test/product/tofu"}, PRODUCT.copy()],
    )
    assert navigated == [PRODUCT["url"]]


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
async def test_extraction_keeps_later_distinct_candidates_for_final_validation(monkeypatch: pytest.MonkeyPatch):
    enriched_urls: list[str] = []
    batch_sizes: list[int] = []
    candidates = [
        {"href": PRODUCT["url"], "name": PRODUCT["name"], "price": PRODUCT["price"], "image": PRODUCT["image"]},
        {"href": PRODUCT["url"] + "?ref=duplicate", "name": "Silken tofu duplicate", "price": "$3.49", "image": PRODUCT["image"]},
        {"href": "https://www.sayweee.com/product/invalid", "name": "x", "price": "$1.00", "image": PRODUCT["image"]},
        {"href": "https://www.sayweee.com/product/firm-tofu", "name": "Firm tofu", "price": "$3.99", "image": PRODUCT["image"]},
        {"href": "https://www.sayweee.com/product/fried-tofu", "name": "Fried tofu", "price": "$4.99", "image": PRODUCT["image"]},
    ]

    async def record_enrichment(context: object, base_url: str, products: list[dict[str, str]]) -> None:
        batch_sizes.append(len(products))
        enriched_urls.extend(product["url"] for product in products)

    extracted_products = await _scrape_extracted_candidates(monkeypatch, candidates, record_enrichment)
    assert len(enriched_urls) == 3
    assert batch_sizes == [3]
    assert store_scraper._validate_products(extracted_products) == [
        PRODUCT,
        {"name": "Firm tofu", "price": "$3.99", "image": PRODUCT["image"], "url": "https://www.sayweee.com/product/firm-tofu"},
        {"name": "Fried tofu", "price": "$4.99", "image": PRODUCT["image"], "url": "https://www.sayweee.com/product/fried-tofu"},
    ]


@pytest.mark.asyncio
async def test_pdp_enrichment_stops_after_first_batch_has_three_distinct_products(monkeypatch: pytest.MonkeyPatch):
    enriched_urls: list[str] = []
    batch_sizes: list[int] = []
    candidates = [
        {"href": f"https://www.sayweee.com/product/tofu-{index}", "name": f"Tofu {index}", "price": "$2.99", "image": PRODUCT["image"]}
        for index in range(40)
    ]

    async def record_enrichment(context: object, base_url: str, products: list[dict[str, str]]) -> None:
        batch_sizes.append(len(products))
        enriched_urls.extend(product["url"] for product in products)

    extracted_products = await _scrape_extracted_candidates(monkeypatch, candidates, record_enrichment)
    assert len(enriched_urls) == 3
    assert batch_sizes == [3]
    assert len(store_scraper._validate_products(extracted_products)) == 3


@pytest.mark.asyncio
async def test_pdp_enrichment_has_an_explicit_twelve_candidate_budget(monkeypatch: pytest.MonkeyPatch):
    enriched_urls: list[str] = []
    batch_sizes: list[int] = []
    candidates = [
        {"href": f"https://www.sayweee.com/product/tofu-{index}", "name": f"Tofu {index}", "price": "$2.99", "image": PRODUCT["image"]}
        for index in range(40)
    ]

    async def invalidate_enriched_batch(context: object, base_url: str, products: list[dict[str, str]]) -> None:
        batch_sizes.append(len(products))
        enriched_urls.extend(product["url"] for product in products)
        for product in products:
            product["name"] = "x"

    await _scrape_extracted_candidates(monkeypatch, candidates, invalidate_enriched_batch)
    assert len(enriched_urls) == 12
    assert batch_sizes == [3, 3, 3, 3]
