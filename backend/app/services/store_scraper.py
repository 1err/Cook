"""
Fetch store products from supported stores using Playwright.

Scope is intentionally narrow: search one store for one ingredient and return a
few basic product results for UI display. Results are cached in-process and can
optionally flow through a persistent DB-backed cache.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any, Literal
from urllib.parse import quote_plus, urljoin

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import repo_store_cache

logger = logging.getLogger(__name__)

# Reuse one browser per process (new context per request for locale isolation).
_browser_lock = asyncio.Lock()
_playwright_inst: Any = None
_shared_browser: Any = None

StoreName = Literal["weee", "amazon"]

MAX_RESULTS = 3
PLAYWRIGHT_TIMEOUT_MS = 15000
SUPPORTED_STORES: tuple[StoreName, ...] = ("weee", "amazon")
CACHE_TTL_SECONDS = 86400
CACHE_VERSION = "v6"
SCRAPE_CONCURRENCY = 4
WEEE_PDP_CONCURRENCY = 3
WEEE_MAX_ATTEMPTS = 2
CACHE: dict[tuple[StoreName, str, str, str], dict[str, Any]] = {}
_scrape_semaphore = asyncio.Semaphore(SCRAPE_CONCURRENCY)

STORE_BASE_URLS: dict[StoreName, str] = {
    "weee": "https://www.sayweee.com",
    "amazon": "https://www.amazon.com",
}

STORE_SEARCH_URLS: dict[StoreName, str] = {
    "weee": STORE_BASE_URLS["weee"] + "/en/search?keyword={query}",
    "amazon": STORE_BASE_URLS["amazon"] + "/s?k={query}",
}

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def _query_has_cjk(query: str) -> bool:
    return bool(_CJK_RE.search(query or ""))

STORE_WAIT_SELECTORS: dict[StoreName, str] = {
    "weee": "[data-testid*='product'] a[href*='/product/'], a[href*='/product/']",
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


def _is_valid_name(name: str) -> bool:
    cleaned = _normalize_space(name)
    if not cleaned:
        return False
    if len(cleaned) < 2:
        return False
    if len(cleaned) > 120:
        return False
    return True


def _extract_weee_search_card_title_block(text: str) -> str:
    """Title-ish text from the search card before the first price block."""
    t = _normalize_space(text)
    m = re.search(r"\$\s*[\d,.]+", t)
    if m:
        t = t[: m.start()]
    return _normalize_space(t)


def _parse_weee_site_title(raw: str) -> str:
    """Strip trailing ' - Weee!' / site suffix from og:title or document.title."""
    n = _normalize_space(raw)
    n = re.sub(r"\s*[-–—]\s*Weee!?\s*$", "", n, flags=re.IGNORECASE)
    n = re.sub(r"^\s*Weee!?\s*[-–—]\s*", "", n, flags=re.IGNORECASE)
    return _normalize_space(n)


def _cleanup_weee_zh_full_title(text: str) -> str:
    """Keep the product line while stripping prices and simple promo text."""
    n = _parse_weee_site_title(text)
    n = re.sub(r"\$[\d,.]+(?:\s*/\s*[A-Za-z\u4e00-\u9fff]+)?", " ", n)
    n = re.sub(r"\bSNAP\b", " ", n, flags=re.IGNORECASE)
    n = re.sub(r"\d+%\s*off", " ", n, flags=re.IGNORECASE)
    return _normalize_space(n)


def _resolve_weee_zh_product_name(candidate: dict[str, Any]) -> str:
    """Trust the DOM in priority order."""
    primary = _normalize_space(str(candidate.get("primary_title") or ""))
    title_hint = _normalize_space(str(candidate.get("title_hint") or ""))
    text = _normalize_space(str(candidate.get("text") or ""))
    image_alt = _normalize_space(str(candidate.get("image_alt") or ""))
    for raw in (primary, title_hint, image_alt, _extract_weee_search_card_title_block(text)):
        cleaned = _cleanup_weee_zh_full_title(raw)
        if _is_valid_name(cleaned):
            return cleaned
    return ""


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


def _normalize_product(
    candidate: dict[str, Any], store: StoreName, *, weee_prefer_zh: bool = False
) -> dict[str, str] | None:
    base_url = STORE_BASE_URLS[store]
    href = _normalize_space(str(candidate.get("href") or ""))
    if not href:
        return None

    url = urljoin(base_url, href)
    url_lower = url.lower()
    if store == "weee" and "/product/" not in url_lower:
        return None
    elif store != "weee" and not any(part in url for part in STORE_URL_PATTERNS[store]):
        return None

    text = _normalize_space(str(candidate.get("text") or ""))
    link_name = _normalize_space(str(candidate.get("name") or ""))
    image_alt = _normalize_space(str(candidate.get("image_alt") or ""))

    name = ""
    if store == "weee" and weee_prefer_zh:
        name = _resolve_weee_zh_product_name(
            {
                "primary_title": candidate.get("primary_title"),
                "title_hint": candidate.get("title_hint"),
                "text": text,
                "image_alt": image_alt,
            }
        )
    if not name:
        name = link_name or image_alt or _cleanup_name(text)
    if not name:
        return None
    return {
        "name": name,
        "price": _normalize_space(str(candidate.get("price") or "")) or _extract_price(text),
        "image": _normalize_image_url(str(candidate.get("image") or ""), base_url),
        "url": url,
    }


def _memory_cache_get(cache_key: tuple[StoreName, str, str, str]) -> list[dict[str, str]] | None:
    cached = CACHE.get(cache_key)
    if not cached:
        return None
    now = time.time()
    if now - float(cached["timestamp"]) >= CACHE_TTL_SECONDS:
        CACHE.pop(cache_key, None)
        return None
    data = cached.get("data")
    return data if isinstance(data, list) else None


def _memory_cache_set(cache_key: tuple[StoreName, str, str, str], products: list[dict[str, str]]) -> None:
    CACHE[cache_key] = {"data": products, "timestamp": time.time()}


def _clean_query(q: str) -> str:
    cleaned = q
    for word in ("新鲜", "切块"):
        cleaned = cleaned.replace(word, "")
    return _normalize_space(cleaned).strip()


def prepare_store_query(query: str, store: StoreName) -> tuple[str, str] | None:
    original_query = _clean_query(_normalize_space(query))
    cleaned_query = _clean_search_query(query) or original_query
    cleaned_query = _clean_query(cleaned_query)
    cleaned_query = cleaned_query.lower().strip() or original_query
    if not cleaned_query:
        return None
    weee_lang = "zh" if store == "weee" and _query_has_cjk(cleaned_query) else "en"
    return cleaned_query, weee_lang


async def _ensure_shared_browser() -> Any:
    """Single Chromium instance per process; contexts remain per-request."""
    global _playwright_inst, _shared_browser
    async with _browser_lock:
        if _shared_browser is not None:
            return _shared_browser
        from playwright.async_api import async_playwright

        _playwright_inst = await async_playwright().start()
        _shared_browser = await _playwright_inst.chromium.launch(headless=True)
        logger.info("store_scraper: launched shared Playwright browser")
        return _shared_browser


async def _weee_fetch_search_items_with_retry(page: Any, script: str) -> list[Any]:
    """Evaluate product rows; scroll if Weee returns an empty or lazy-loaded grid."""
    raw_items = await page.evaluate(script)
    if isinstance(raw_items, list) and len(raw_items) > 0:
        return raw_items
    scroll_js = (
        "() => { const h = document.body?.scrollHeight || 0; "
        "window.scrollTo(0, Math.min(h, 9000)); }"
    )
    bottom_js = "() => window.scrollTo(0, (document.body && document.body.scrollHeight) || 99999)"
    for attempt, js in enumerate((scroll_js, bottom_js)):
        try:
            await page.evaluate(js)
            await page.wait_for_timeout(780 if attempt == 0 else 1000)
            raw_items = await page.evaluate(script)
            if isinstance(raw_items, list) and len(raw_items) > 0:
                return raw_items
        except Exception as exc:
            logger.info("weee search scroll-retry failed (attempt %s): %s", attempt + 1, exc)
    return raw_items if isinstance(raw_items, list) else []


async def _wait_for_weee_results(page: Any, query: str, *, attempt: int) -> None:
    """Give Weee time to hydrate before treating an empty eval as a real miss."""
    try:
        await page.wait_for_load_state("networkidle", timeout=7000 if attempt == 0 else 9000)
    except Exception:
        pass
    try:
        await page.wait_for_selector(STORE_WAIT_SELECTORS["weee"], timeout=14000 if attempt == 0 else 17000)
    except Exception:
        logger.info("weee product selector wait timed out for query=%r on attempt=%s", query, attempt + 1)
    await page.wait_for_timeout(900 if attempt == 0 else 1500)


async def _enrich_weee_products_from_detail_pages(
    context: Any, base_url: str, products: list[dict[str, str]]
) -> None:
    """Use PDP metadata for canonical Weee names and images."""

    semaphore = asyncio.Semaphore(WEEE_PDP_CONCURRENCY)

    async def enrich_product(product: dict[str, str]) -> None:
        detail_page = None
        async with semaphore:
            try:
                detail_page = await context.new_page()
                await detail_page.goto(product["url"], wait_until="domcontentloaded", timeout=PLAYWRIGHT_TIMEOUT_MS)
                try:
                    await detail_page.wait_for_selector("meta[property='og:title']", timeout=8000)
                except Exception:
                    pass
                meta = await detail_page.evaluate(
                    """
                    () => ({
                      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "",
                      docTitle: document.title || "",
                      h1: document.querySelector("main h1, h1")?.textContent?.trim() || "",
                      ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "",
                      twImage: document.querySelector('meta[name="twitter:image"]')?.getAttribute("content") || "",
                      heroImage:
                        document.querySelector('img')?.currentSrc ||
                        document.querySelector('img')?.getAttribute('src') ||
                        "",
                    })
                    """
                )
                og_raw = str(meta.get("ogTitle") or meta.get("docTitle") or meta.get("h1") or "").strip()
                og_title = _normalize_space(_cleanup_weee_zh_full_title(og_raw))
                if og_title:
                    product["name"] = og_title
                og_image = str(meta.get("ogImage") or "").strip()
                if og_image:
                    product["image"] = _normalize_image_url(og_image, base_url)
                else:
                    raw_img = str(meta.get("twImage") or meta.get("heroImage") or "")
                    if raw_img:
                        product["image"] = _normalize_image_url(raw_img, base_url)
            except Exception as exc:
                logger.info("weee PDP enrich failed for url=%r: %s", product.get("url"), exc)
            finally:
                if detail_page is not None:
                    await detail_page.close()

    await asyncio.gather(*(enrich_product(product) for product in products))


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
    () => {
      const preferredSelector = '[data-testid*="product"] a[href*="/product/"]';
      const scopedAnchors = Array.from(document.querySelectorAll(preferredSelector));
      const anchors = scopedAnchors.length
        ? scopedAnchors
        : Array.from(document.querySelectorAll('a[href*="/product/"]'));
      return anchors
        .map((anchor) => {
          const href = (anchor.href || anchor.getAttribute("href") || "").trim();
          if (!/\\/product\\//i.test(href) || /^javascript:/i.test(href)) return null;
          const card =
            anchor.closest("article, li, [data-testid], .product-card, .productCard, .search-result-card, [class*='Product'], [class*='product'], section") ||
            anchor.parentElement ||
            anchor;
          const img = anchor.querySelector("img") || card?.querySelector("img");
          const titleEl = card?.querySelector(
            'h2, h3, h4, [class*="ProductTitle"], [class*="product-title"], [class*="ProductName"], [class*="productName"]'
          );
          const title_hint = (titleEl?.textContent || "").replace(/\\s+/g, " ").trim();
          const lines = (card?.innerText || "")
            .split(/\\n/)
            .map((s) => s.replace(/\\s+/g, " ").trim())
            .filter(Boolean);
          let primary_title = "";
          for (const line of lines) {
            if (/加入购物车|加入購物車/.test(line)) continue;
            if (/^\\$[\\d,.]+$/.test(line.trim())) continue;
            if (/^\\d+%\\s*(off|OFF)\\b/.test(line)) continue;
            if (/^(SNAP|周销量)/.test(line)) continue;
            if (line.length >= 2 && line.length <= 120) {
              primary_title = line;
              break;
            }
          }
          if (!primary_title) {
            primary_title = lines[0] || "";
          }
          return {
            href: href,
            text: ((card?.innerText || anchor.innerText || anchor.textContent || "")).replace(/\\s+/g, " ").trim(),
            title_hint: title_hint,
            primary_title: primary_title,
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
        .filter(Boolean);
    }
    """


async def _fetch_store_products(
    query: str,
    store: StoreName,
    session: AsyncSession | None = None,
    *,
    force_refresh: bool = False,
) -> list[dict[str, str]]:
    prepared = prepare_store_query(query, store)
    if prepared is None:
        return []
    cleaned_query, weee_lang = prepared
    logger.info("%s store lookup query=%r cleaned_query=%r", store, _normalize_space(query), cleaned_query)
    cache_key = (store, weee_lang, CACHE_VERSION, cleaned_query)
    if not force_refresh:
        memory_cached = _memory_cache_get(cache_key)
        if memory_cached is not None:
            return memory_cached
    if session is not None and not force_refresh:
        db_cached = await repo_store_cache.get_cached_store_products(
            session,
            query=cleaned_query,
            store=store,
            language=weee_lang,
            cache_version=CACHE_VERSION,
            max_age_seconds=CACHE_TTL_SECONDS,
        )
        if db_cached is not None:
            _memory_cache_set(cache_key, db_cached)
            return db_cached

    try:
        from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    except ModuleNotFoundError:
        logger.warning("playwright is not installed; store products unavailable")
        return []

    if store == "weee" and weee_lang == "zh":
        search_url = f"{STORE_BASE_URLS['weee']}/zh/search?keyword={quote_plus(cleaned_query)}"
    else:
        search_url = STORE_SEARCH_URLS[store].format(query=quote_plus(cleaned_query))
    weee_prefer_zh = store == "weee" and weee_lang == "zh"
    products: list[dict[str, str]] = []
    attempts = WEEE_MAX_ATTEMPTS if store == "weee" else 1
    last_exception: Exception | None = None
    for attempt in range(attempts):
        products = []
        try:
            async with _scrape_semaphore:
                browser = await _ensure_shared_browser()
                context_kwargs: dict[str, Any] = {
                    "locale": "zh-CN" if weee_prefer_zh else "en-US",
                    "user_agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    ),
                }
                if weee_prefer_zh:
                    context_kwargs["extra_http_headers"] = {"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
                context = await browser.new_context(**context_kwargs)
                try:
                    page = await context.new_page()
                    await page.goto(search_url, wait_until="domcontentloaded", timeout=PLAYWRIGHT_TIMEOUT_MS)
                    if store == "weee":
                        await _wait_for_weee_results(page, cleaned_query, attempt=attempt)
                    else:
                        try:
                            await page.wait_for_selector(STORE_WAIT_SELECTORS[store], timeout=12000)
                        except PlaywrightTimeoutError:
                            logger.info(
                                "%s product selector wait time out for query=%r — continuing with eval",
                                store,
                                cleaned_query,
                            )
                        await page.wait_for_timeout(450)

                    extract_script = _store_extract_script(store)
                    if store == "weee":
                        raw_items = await _weee_fetch_search_items_with_retry(page, extract_script)
                    else:
                        ri = await page.evaluate(extract_script)
                        raw_items = ri if isinstance(ri, list) else []

                    seen_urls: set[str] = set()
                    for item in raw_items:
                        if not isinstance(item, dict):
                            continue
                        product = _normalize_product(item, store, weee_prefer_zh=weee_prefer_zh)
                        if not product:
                            continue
                        if product["url"] in seen_urls:
                            continue
                        seen_urls.add(product["url"])
                        products.append(product)
                        if len(products) >= MAX_RESULTS:
                            break

                    if store == "weee" and products:
                        await _enrich_weee_products_from_detail_pages(context, STORE_BASE_URLS["weee"], products)
                    elif products:
                        await _fill_missing_images_from_product_pages(context, store, products)
                finally:
                    await context.close()
        except Exception as exc:
            last_exception = exc
            if attempt + 1 < attempts:
                logger.info("%s scrape attempt %s failed for query=%r; retrying once: %s", store, attempt + 1, cleaned_query, exc)
                continue
            logger.exception("%s scraping failed for query=%r: %s", store, cleaned_query, exc)
            return []

        if products or attempt + 1 >= attempts:
            break
        logger.info("%s scrape returned no products for query=%r on attempt=%s; retrying once", store, cleaned_query, attempt + 1)

    if not products and last_exception is not None:
        logger.info("%s returning empty products after retries for query=%r", store, cleaned_query)

    if products:
        _memory_cache_set(cache_key, products)
        if session is not None:
            await repo_store_cache.upsert_cached_store_products(
                session,
                query=cleaned_query,
                store=store,
                language=weee_lang,
                cache_version=CACHE_VERSION,
                data=products,
            )
    return products


async def fetch_weee_products(
    query: str,
    session: AsyncSession | None = None,
    *,
    force_refresh: bool = False,
) -> list[dict[str, str]]:
    return await _fetch_store_products(query, "weee", session=session, force_refresh=force_refresh)


async def fetch_amazon_products(
    query: str,
    session: AsyncSession | None = None,
    *,
    force_refresh: bool = False,
) -> list[dict[str, str]]:
    return await _fetch_store_products(query, "amazon", session=session, force_refresh=force_refresh)


async def fetch_store_products(
    query: str,
    store: str,
    session: AsyncSession | None = None,
    *,
    force_refresh: bool = False,
) -> list[dict[str, str]]:
    normalized = (store or "").strip().lower()
    if normalized not in SUPPORTED_STORES:
        return []
    return await _fetch_store_products(query, normalized, session=session, force_refresh=force_refresh)
