"""
Fetch live store products from supported stores using Playwright.

Scope is intentionally narrow: search one store for one ingredient and return a
few basic product results for UI display. No persistence, caching, or cart flow.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Literal
from urllib.parse import quote_plus, urljoin

logger = logging.getLogger(__name__)

StoreName = Literal["weee", "amazon"]

MAX_RESULTS = 3
PLAYWRIGHT_TIMEOUT_MS = 15000
SUPPORTED_STORES: tuple[StoreName, ...] = ("weee", "amazon")
CACHE_TTL_SECONDS = 86400
CACHE: dict[tuple[StoreName, str], dict[str, Any]] = {}

STORE_BASE_URLS: dict[StoreName, str] = {
    "weee": "https://www.sayweee.com",
    "amazon": "https://www.amazon.com",
}

STORE_SEARCH_URLS: dict[StoreName, str] = {
    "weee": STORE_BASE_URLS["weee"] + "/en/search?keyword={query}",
    "amazon": STORE_BASE_URLS["amazon"] + "/s?k={query}",
}

STORE_WAIT_SELECTORS: dict[StoreName, str] = {
    "weee": "a[href*='/product/']",
    "amazon": "[data-component-type='s-search-result']",
}

STORE_URL_PATTERNS: dict[StoreName, tuple[str, ...]] = {
    "weee": ("/product/",),
    "amazon": ("/dp/", "/gp/product/"),
}


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _clean_search_query(query: str) -> str:
    """Remove obvious quantity fragments while preserving Chinese ingredient text."""
    original = _normalize_space(query)
    if not original:
        return ""

    text = original
    text = re.sub(r"[，,;；]+", " ", text)
    text = re.sub(r"(?i)\b(?:to taste|as needed|for garnish)\b", " ", text)
    text = re.sub(
        r"(?i)\b\d+(?:\.\d+)?\s*(?:kg|g|gram|grams|lb|lbs|oz|ml|l|cup|cups|tbsp|tablespoons?|tsp|teaspoons?|cloves?|pcs?|packs?|packages?)\b",
        " ",
        text,
    )
    text = re.sub(r"\d+(?:\.\d+)?\s*(?:公斤|千克|克|斤|磅|盎司|毫升|升|个|颗|根|片|包|袋|盒)", " ", text)
    cleaned = _normalize_space(text)
    return cleaned or original


def _extract_price(text: str) -> str:
    normalized = _normalize_space(text)
    unit_price = re.search(r"\$[\d,.]+\s*/\s*[A-Za-z]+", normalized)
    if unit_price:
        return unit_price.group(0).replace(" ", "")
    price = re.search(r"\$[\d,.]+", normalized)
    return price.group(0) if price else ""


def _normalize_image_url(raw: str, base_url: str) -> str:
    image = _normalize_space(raw)
    if not image:
        return ""
    if "," in image:
        image = image.split(",", 1)[0]
    image = image.split(" ", 1)[0].strip()
    if image.startswith("//"):
        return f"https:{image}"
    return urljoin(base_url, image)


def _cleanup_name(text: str) -> str:
    name = _normalize_space(text)
    name = re.sub(r"\b\d+%\s*off\b", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\$[\d,.]+(?:\s*/\s*[A-Za-z]+)?", " ", name)
    name = re.sub(r"\b(?:Add to cart|See options|Loading\.\.\.|Options:\s*\d+)\b", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\b(?:Hot|Low Price|New|Choice|Featured)\b", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\bSNAP\b", " ", name)
    name = re.sub(r"\b\d+[Kk]?\+\s+SOLD\b", " ", name)
    name = re.sub(r"\b\d+[Kk]?\+\s+bought in past month\b", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\b(?:Freshly Made|Free shipping)\b", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\bGet it\b.*$", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\bShips from\b.*$", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\bRating\b.*$", " ", name, flags=re.IGNORECASE)
    return _normalize_space(name)


def _normalize_product(candidate: dict[str, Any], store: StoreName) -> dict[str, str] | None:
    base_url = STORE_BASE_URLS[store]
    href = _normalize_space(str(candidate.get("href") or ""))
    if not href:
        return None

    url = urljoin(base_url, href)
    if not any(part in url for part in STORE_URL_PATTERNS[store]):
        return None

    text = _normalize_space(str(candidate.get("text") or ""))
    name = (
        _normalize_space(str(candidate.get("name") or ""))
        or _normalize_space(str(candidate.get("image_alt") or ""))
        or _cleanup_name(text)
    )
    if not name:
        return None

    return {
        "name": name,
        "price": _normalize_space(str(candidate.get("price") or "")) or _extract_price(text),
        "image": _normalize_image_url(str(candidate.get("image") or ""), base_url),
        "url": url,
    }


async def _fill_missing_images_from_product_pages(context: Any, store: StoreName, products: list[dict[str, str]]) -> None:
    """Load missing product images from product page metadata."""
    base_url = STORE_BASE_URLS[store]
    for product in products:
        if product.get("image"):
            continue
        detail_page = None
        try:
            detail_page = await context.new_page()
            await detail_page.goto(product["url"], wait_until="domcontentloaded", timeout=PLAYWRIGHT_TIMEOUT_MS)
            raw_image = await detail_page.evaluate(
                """
                () =>
                  document.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
                  document.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ||
                  document.querySelector('img')?.currentSrc ||
                  document.querySelector('img')?.getAttribute("src") ||
                  ""
                """
            )
            product["image"] = _normalize_image_url(str(raw_image or ""), base_url)
        except Exception as exc:
            logger.info("%s image fallback failed for url=%r: %s", store, product.get("url"), exc)
        finally:
            if detail_page is not None:
                await detail_page.close()


def _store_extract_script(store: StoreName) -> str:
    if store == "amazon":
        return """
        () => Array.from(document.querySelectorAll('[data-component-type="s-search-result"]')).map((card) => {
          const link = card.querySelector('h2 a') || card.querySelector('a.a-link-normal[href*="/dp/"]');
          const img = card.querySelector('img.s-image') || card.querySelector('img');
          const price = card.querySelector('.a-price .a-offscreen') || card.querySelector('.a-price');
          return {
            href: link?.href || link?.getAttribute('href') || '',
            text: (card.innerText || '').replace(/\\s+/g, ' ').trim(),
            name: (link?.textContent || img?.alt || '').replace(/\\s+/g, ' ').trim(),
            price: (price?.textContent || '').replace(/\\s+/g, ' ').trim(),
            image:
              img?.currentSrc ||
              img?.src ||
              img?.getAttribute('src') ||
              img?.getAttribute('data-src') ||
              img?.getAttribute('srcset') ||
              '',
            image_alt: img?.alt || ''
          };
        })
        """
    return """
    () => Array.from(document.querySelectorAll('a[href*="/product/"]')).map((anchor) => {
      const card = anchor.closest("article, li, [data-testid], .product-card, .productCard, .search-result-card") || anchor.parentElement || anchor;
      const img = anchor.querySelector("img") || card?.querySelector("img");
      return {
        href: anchor.href || anchor.getAttribute("href") || "",
        text: ((card?.innerText || anchor.innerText || anchor.textContent || "")).replace(/\\s+/g, " ").trim(),
        name: (img?.alt || "").replace(/\\s+/g, " ").trim(),
        image:
          img?.currentSrc ||
          img?.src ||
          img?.getAttribute("src") ||
          img?.getAttribute("data-src") ||
          img?.getAttribute("data-original") ||
          img?.getAttribute("data-lazy-src") ||
          img?.getAttribute("data-lazyload") ||
          img?.getAttribute("srcset") ||
          img?.getAttribute("data-srcset") ||
          "",
        image_alt: img?.alt || ""
      };
    })
    """


async def _fetch_store_products(query: str, store: StoreName) -> list[dict[str, str]]:
    original_query = _normalize_space(query)
    cleaned_query = _clean_search_query(query) or original_query
    cleaned_query = cleaned_query.lower().strip() or original_query
    logger.info("%s store lookup query=%r cleaned_query=%r", store, original_query, cleaned_query)
    if not cleaned_query:
        return []
    cache_key = (store, cleaned_query)
    cached = CACHE.get(cache_key)
    now = time.time()
    if cached and now - float(cached["timestamp"]) < CACHE_TTL_SECONDS:
        return cached["data"]

    try:
        from playwright.async_api import TimeoutError as PlaywrightTimeoutError
        from playwright.async_api import async_playwright
    except ModuleNotFoundError:
        logger.warning("playwright is not installed; store products unavailable")
        return []

    search_url = STORE_SEARCH_URLS[store].format(query=quote_plus(cleaned_query))
    products: list[dict[str, str]] = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            context = await browser.new_context(
                locale="en-US",
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()

            await page.goto(search_url, wait_until="domcontentloaded", timeout=PLAYWRIGHT_TIMEOUT_MS)
            try:
                await page.wait_for_selector(STORE_WAIT_SELECTORS[store], timeout=PLAYWRIGHT_TIMEOUT_MS)
            except PlaywrightTimeoutError:
                logger.info("%s product selector wait timed out for query=%r", store, cleaned_query)

            try:
                await page.wait_for_load_state("networkidle", timeout=5000)
            except PlaywrightTimeoutError:
                pass

            raw_items = await page.evaluate(_store_extract_script(store))

            seen_urls: set[str] = set()
            for item in raw_items if isinstance(raw_items, list) else []:
                if not isinstance(item, dict):
                    continue
                product = _normalize_product(item, store)
                if not product:
                    continue
                if product["url"] in seen_urls:
                    continue
                seen_urls.add(product["url"])
                products.append(product)
                if len(products) >= MAX_RESULTS:
                    break

            await _fill_missing_images_from_product_pages(context, store, products)
            await context.close()
            await browser.close()
    except Exception as exc:
        logger.exception("%s scraping failed for query=%r: %s", store, cleaned_query, exc)
        return []

    if products:
        CACHE[cache_key] = {"data": products, "timestamp": now}
    return products


async def fetch_weee_products(query: str) -> list[dict[str, str]]:
    return await _fetch_store_products(query, "weee")


async def fetch_amazon_products(query: str) -> list[dict[str, str]]:
    return await _fetch_store_products(query, "amazon")


async def fetch_store_products(query: str, store: str) -> list[dict[str, str]]:
    normalized = (store or "").strip().lower()
    if normalized not in SUPPORTED_STORES:
        return []
    return await _fetch_store_products(query, normalized)
