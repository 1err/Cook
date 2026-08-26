"""A self-recovering, one-page scraper for Weee search results."""
from __future__ import annotations

import asyncio
import logging
import random
import re
from typing import Any, Literal
from urllib.parse import quote_plus, urljoin, urlsplit

from app.core.store_products import normalize_weee_product_url

logger = logging.getLogger(__name__)

Language = Literal["en", "zh"]
PageOutcome = Literal["results", "no_results", "challenge", "pending"]

MAX_RESULTS = 3
WEEE_MAX_ATTEMPTS = 3
PLAYWRIGHT_TIMEOUT_MS = 15_000
_PAGE_STATE_POLLS = 15
_PAGE_STATE_POLL_MS = 500

WEEE_BASE_URL = "https://www.sayweee.com"
WEEE_SEARCH_URL = WEEE_BASE_URL + "/en/search?keyword={query}"

_browser_lock = asyncio.Lock()
_playwright_inst: Any = None
_shared_browser: Any = None


class StoreScrapeError(RuntimeError):
    """Weee did not produce a trustworthy result."""


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


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
    return 2 <= len(cleaned) <= 120


def _extract_weee_search_card_title_block(text: str) -> str:
    title = _normalize_space(text)
    price_match = re.search(r"\$\s*[\d,.]+", title)
    if price_match:
        title = title[: price_match.start()]
    return _normalize_space(title)


def _parse_weee_site_title(raw: str) -> str:
    title = _normalize_space(raw)
    title = re.sub(r"\s*[-–—|]\s*Weee!?\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"^\s*Weee!?\s*[-–—|]\s*", "", title, flags=re.IGNORECASE)
    return _normalize_space(title)


def _cleanup_weee_zh_full_title(text: str) -> str:
    title = _parse_weee_site_title(text)
    title = re.sub(r"\$[\d,.]+(?:\s*/\s*[A-Za-z\u4e00-\u9fff]+)?", " ", title)
    title = re.sub(r"\bSNAP\b", " ", title, flags=re.IGNORECASE)
    title = re.sub(r"\d+%\s*off", " ", title, flags=re.IGNORECASE)
    return _normalize_space(title)


def _resolve_weee_zh_product_name(candidate: dict[str, Any]) -> str:
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


def _normalize_weee_product(candidate: dict[str, Any], *, prefer_zh: bool = False) -> dict[str, str] | None:
    href = _normalize_space(str(candidate.get("href") or ""))
    url = normalize_weee_product_url(href, base_url=WEEE_BASE_URL)
    if url is None:
        return None

    text = _normalize_space(str(candidate.get("text") or ""))
    link_name = _normalize_space(str(candidate.get("name") or ""))
    image_alt = _normalize_space(str(candidate.get("image_alt") or ""))
    name = ""
    if prefer_zh:
        name = _resolve_weee_zh_product_name(candidate)
    if not name:
        name = link_name or image_alt or _cleanup_name(text)
    if not name:
        return None
    return {
        "name": name,
        "price": _normalize_space(str(candidate.get("price") or "")) or _extract_price(text),
        "image": _normalize_image_url(str(candidate.get("image") or ""), WEEE_BASE_URL),
        "url": url,
    }


def validate_products(raw_products: object) -> list[dict[str, str]]:
    if not isinstance(raw_products, list):
        raise StoreScrapeError("Weee returned a non-list product payload.")
    products: list[dict[str, str]] = []
    seen_names: set[str] = set()
    seen_urls: set[str] = set()
    for raw in raw_products:
        if not isinstance(raw, dict):
            continue
        values = tuple(raw.get(field) for field in ("name", "price", "image", "url"))
        if not all(isinstance(value, str) for value in values):
            continue
        name, price, image, raw_url = (_normalize_space(value) for value in values)
        url = normalize_weee_product_url(raw_url)
        if not _is_valid_name(name) or url is None:
            continue
        normalized_name = name.casefold()
        if normalized_name in seen_names or url in seen_urls:
            continue
        seen_names.add(normalized_name)
        seen_urls.add(url)
        products.append({"name": name, "price": price, "image": image, "url": url})
        if len(products) == MAX_RESULTS:
            break
    if raw_products and not products:
        raise StoreScrapeError("Weee returned no valid products.")
    return products


async def _launch_browser() -> tuple[Any, Any]:
    try:
        from playwright.async_api import async_playwright
    except ModuleNotFoundError as exc:
        raise StoreScrapeError("Playwright is not installed.") from exc
    playwright = await async_playwright().start()
    try:
        browser = await playwright.chromium.launch(headless=True)
    except BaseException:
        await playwright.stop()
        raise
    logger.info("weee_scraper: launched shared Playwright browser")
    return playwright, browser


def _browser_is_connected(browser: Any) -> bool:
    try:
        connected = browser.is_connected()
        return bool(connected)
    except Exception:
        return False


async def _close_browser_resources(browser: Any, playwright: Any) -> None:
    if browser is not None:
        try:
            await browser.close()
        except Exception:
            pass
    if playwright is not None:
        try:
            await playwright.stop()
        except Exception:
            pass


async def _invalidate_shared_browser(observed_browser: Any | None = None) -> None:
    global _shared_browser, _playwright_inst
    async with _browser_lock:
        if observed_browser is not None and _shared_browser is not observed_browser:
            return
        browser, playwright = _shared_browser, _playwright_inst
        _shared_browser = None
        _playwright_inst = None
        await _close_browser_resources(browser, playwright)


async def _ensure_shared_browser() -> Any:
    global _shared_browser, _playwright_inst
    async with _browser_lock:
        if _shared_browser is not None and _browser_is_connected(_shared_browser):
            return _shared_browser
        stale_browser, stale_playwright = _shared_browser, _playwright_inst
        _shared_browser = None
        _playwright_inst = None
        await _close_browser_resources(stale_browser, stale_playwright)
        _playwright_inst, _shared_browser = await _launch_browser()
        return _shared_browser


def _looks_like_browser_closure(error: BaseException) -> bool:
    message = str(error).casefold()
    return any(
        token in message
        for token in (
            "target page, context or browser has been closed",
            "target closed",
            "browser has been closed",
            "connection closed",
        )
    )


def _weee_search_url(query_text: str, language: Language) -> str:
    if language == "zh":
        return f"{WEEE_BASE_URL}/zh/search?keyword={quote_plus(query_text)}"
    return WEEE_SEARCH_URL.format(query=quote_plus(query_text))


def _is_weee_search_route(url: str, language: Language) -> bool:
    try:
        parsed = urlsplit(url)
        hostname = (parsed.hostname or "").casefold()
    except ValueError:
        return False
    is_official_host = hostname in {"sayweee.com", "weee.com"} or hostname.endswith(
        (".sayweee.com", ".weee.com")
    )
    path = parsed.path.rstrip("/").casefold()
    return is_official_host and path == f"/{language}/search"


async def _classify_search_page(page: Any) -> PageOutcome:
    """Classify only visible signals, prioritising products over page copy."""
    result = await page.evaluate(
        """
        () => {
          const visible = (element) => Boolean(element) && !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
          const productAnchors = Array.from(document.querySelectorAll('[data-testid*="product"] a[href*="/product/"], a[href*="/product/"]'));
          if (productAnchors.some(visible)) return "results";

          const text = (document.body?.innerText || "").replace(/\\s+/g, " ").toLowerCase();
          const noResultsSelector = [
            '[data-testid*="no-result"]', '[data-testid*="empty"]',
            '[class*="no-result"]', '[class*="empty-result"]'
          ].some((selector) => Array.from(document.querySelectorAll(selector)).some(visible));
          if (noResultsSelector || /no results|no products found|没有找到|暂无商品/.test(text)) return "no_results";

          if (/captcha|verify you are human|access denied|unusual traffic|安全验证/.test(text)) return "challenge";
          return "pending";
        }
        """
    )
    if result in ("results", "no_results", "challenge", "pending"):
        return result
    return "pending"


async def _wait_for_search_outcome(page: Any) -> PageOutcome:
    for poll in range(_PAGE_STATE_POLLS):
        outcome = await _classify_search_page(page)
        if outcome != "pending":
            return outcome
        if poll + 1 < _PAGE_STATE_POLLS:
            await page.wait_for_timeout(_PAGE_STATE_POLL_MS)
    return "pending"


def _weee_extract_script() -> str:
    return """
    () => Array.from(document.querySelectorAll('[data-testid*="product"] a[href*="/product/"], a[href*="/product/"]'))
      .filter((anchor) => !!(anchor.offsetWidth || anchor.offsetHeight || anchor.getClientRects().length))
      .map((anchor) => {
        const card = anchor.closest('article, li, [data-testid], .product-card, .productCard, .search-result-card, [class*="Product"], [class*="product"], section') || anchor.parentElement || anchor;
        const image = anchor.querySelector('img') || card?.querySelector('img');
        const title = card?.querySelector('h2, h3, h4, [class*="ProductTitle"], [class*="product-title"], [class*="ProductName"], [class*="productName"]');
        return {
          href: (anchor.href || anchor.getAttribute('href') || '').trim(),
          text: (card?.innerText || anchor.innerText || anchor.textContent || '').replace(/\\s+/g, ' ').trim(),
          title_hint: (title?.textContent || '').replace(/\\s+/g, ' ').trim(),
          primary_title: (title?.textContent || '').replace(/\\s+/g, ' ').trim(),
          name: (image?.alt || '').replace(/\\s+/g, ' ').trim(),
          image: image?.currentSrc || image?.src || image?.getAttribute('src') || image?.getAttribute('data-src') || image?.getAttribute('srcset') || '',
          image_alt: image?.alt || ''
        };
      })
      .filter((item) => /\\/product\\//i.test(item.href) && !/^javascript:/i.test(item.href));
    """


async def _extract_weee_search_products(page: Any, language: Language) -> list[Any]:
    raw_products = await page.evaluate(_weee_extract_script())
    if not isinstance(raw_products, list):
        raise StoreScrapeError("Weee returned an invalid product payload.")
    return raw_products


async def _scrape_once(query_text: str, language: Language, attempt_number: int) -> list[dict[str, str]]:
    browser: Any = None
    context: Any = None
    page: Any = None
    try:
        browser = await _ensure_shared_browser()
        context_options: dict[str, Any] = {
            "locale": "zh-CN" if language == "zh" else "en-US",
            "user_agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        }
        if language == "zh":
            context_options["extra_http_headers"] = {"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
        context = await browser.new_context(**context_options)
        page = await context.new_page()
        response = await page.goto(
            _weee_search_url(query_text, language),
            wait_until="domcontentloaded",
            timeout=PLAYWRIGHT_TIMEOUT_MS,
        )
        status = getattr(response, "status", 200) if response is not None else 200
        if status >= 400:
            raise StoreScrapeError(f"Weee search returned HTTP {status}.")
        if not _is_weee_search_route(str(getattr(page, "url", "")), language):
            raise StoreScrapeError("Weee search was redirected to an unexpected route.")

        outcome = await _wait_for_search_outcome(page)
        if outcome == "no_results":
            return []
        if outcome != "results":
            raise StoreScrapeError(f"Weee search page was not trustworthy: {outcome}.")
        raw_cards = await _extract_weee_search_products(page, language)
        products = [
            product
            for card in raw_cards
            if isinstance(card, dict)
            if (product := _normalize_weee_product(card, prefer_zh=language == "zh")) is not None
        ]
        if not products:
            raise StoreScrapeError("Weee search results contained no usable products.")
        return validate_products(products)
    except asyncio.CancelledError:
        raise
    except Exception as error:
        if browser is not None and (not _browser_is_connected(browser) or _looks_like_browser_closure(error)):
            await _invalidate_shared_browser(browser)
        raise
    finally:
        if page is not None:
            try:
                await page.close()
            except Exception:
                pass
        if context is not None:
            try:
                await context.close()
            except Exception:
                pass


def _log_attempt(
    query_text: str,
    language: Language,
    attempt_number: int,
    outcome: str,
    error: BaseException | None = None,
) -> None:
    logger.info(
        "weee_scrape attempt query=%r language=%s attempt=%s outcome=%s error_type=%s",
        query_text,
        language,
        attempt_number,
        outcome,
        type(error).__name__ if error else "none",
        extra={"event": "weee_scrape_attempt", "query": query_text, "attempt": attempt_number},
    )


async def scrape_weee_products(query_text: str, language: Language) -> list[dict[str, str]]:
    last_error: BaseException | None = None
    for attempt_number in range(1, WEEE_MAX_ATTEMPTS + 1):
        try:
            products = await _scrape_once(query_text, language, attempt_number)
            _log_attempt(query_text, language, attempt_number, "empty" if not products else "success")
            return products
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            last_error = exc
            _log_attempt(query_text, language, attempt_number, "failure", exc)
            if attempt_number == WEEE_MAX_ATTEMPTS:
                break
            await asyncio.sleep((0.20 * attempt_number) + random.uniform(0.0, 0.10))
    if isinstance(last_error, StoreScrapeError):
        raise last_error
    raise StoreScrapeError(f"Weee scraping failed for query {query_text!r}.") from last_error
