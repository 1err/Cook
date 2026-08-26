"""A self-recovering, one-page scraper for Weee search results."""
from __future__ import annotations

import asyncio
import logging
import random
import re
import time
from typing import Any, Literal
from urllib.parse import parse_qsl, quote_plus, urljoin, urlsplit

from app.core.store_products import normalize_store_products, normalize_weee_product_url

logger = logging.getLogger(__name__)

Language = Literal["en", "zh"]
PageOutcome = Literal["results", "no_results", "challenge", "pending"]

MAX_RESULTS = 3
WEEE_MAX_ATTEMPTS = 3
PLAYWRIGHT_TIMEOUT_MS = 15_000
SCRAPER_OPERATION_TIMEOUT_SECONDS = 20.0
SCRAPER_CLEANUP_TIMEOUT_SECONDS = 5.0
SCRAPER_ATTEMPT_TIMEOUT_SECONDS = 35.0
SCRAPER_TOTAL_TIMEOUT_SECONDS = 110.0
_PAGE_STATE_POLLS = 15
_PAGE_STATE_POLL_MS = 500

WEEE_BASE_URL = "https://www.sayweee.com"
WEEE_SEARCH_URL = WEEE_BASE_URL + "/en/search?keyword={query}"

_browser_lock = asyncio.Lock()
_playwright_inst: Any = None
_shared_browser: Any = None


class StoreScrapeError(RuntimeError):
    """Weee did not produce a trustworthy result."""


def _consume_background_task(task: asyncio.Task[Any]) -> None:
    if not task.cancelled():
        task.exception()


async def _bounded_await(awaitable: Any, timeout_seconds: float, label: str) -> Any:
    """Bound even cancellation-resistant Playwright awaits by a monotonic timer."""
    if timeout_seconds <= 0:
        if asyncio.iscoroutine(awaitable):
            awaitable.close()
        raise StoreScrapeError(f"Weee {label} timed out.")
    task = asyncio.ensure_future(awaitable)
    try:
        done, _ = await asyncio.wait({task}, timeout=timeout_seconds)
    except asyncio.CancelledError:
        task.cancel()
        task.add_done_callback(_consume_background_task)
        raise
    if task in done:
        return task.result()
    task.cancel()
    task.add_done_callback(_consume_background_task)
    raise StoreScrapeError(f"Weee {label} timed out.")


async def _bounded_call(
    factory: Any,
    *,
    deadline: float,
    label: str,
    limit_seconds: float | None = None,
) -> Any:
    remaining = deadline - time.monotonic()
    operation_limit = (
        SCRAPER_OPERATION_TIMEOUT_SECONDS
        if limit_seconds is None
        else limit_seconds
    )
    return await _bounded_await(factory(), min(operation_limit, remaining), label)


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
    products = normalize_store_products(raw_products)
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
        try:
            await _bounded_await(
                playwright.stop(),
                SCRAPER_CLEANUP_TIMEOUT_SECONDS,
                "Playwright startup cleanup",
            )
        except StoreScrapeError:
            logger.warning("weee_scraper: Playwright startup cleanup timed out")
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
            await _bounded_await(
                browser.close(),
                SCRAPER_CLEANUP_TIMEOUT_SECONDS,
                "browser cleanup",
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("weee_scraper: browser cleanup failed: %s", type(exc).__name__)
    if playwright is not None:
        try:
            await _bounded_await(
                playwright.stop(),
                SCRAPER_CLEANUP_TIMEOUT_SECONDS,
                "Playwright cleanup",
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("weee_scraper: Playwright cleanup failed: %s", type(exc).__name__)


async def _invalidate_shared_browser(observed_browser: Any | None = None) -> None:
    global _shared_browser, _playwright_inst
    async with _browser_lock:
        if observed_browser is not None and _shared_browser is not observed_browser:
            return
        browser, playwright = _shared_browser, _playwright_inst
        _shared_browser = None
        _playwright_inst = None
    await _close_browser_resources(browser, playwright)


async def shutdown_weee_scraper() -> None:
    """Close the process-shared browser resources; safe to call repeatedly."""
    await _invalidate_shared_browser()


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


def _is_weee_search_route(url: str, language: Language, expected_query: str) -> bool:
    try:
        parsed = urlsplit(url)
        hostname = (parsed.hostname or "").casefold()
        port = parsed.port
        query_pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        return False
    if (
        parsed.scheme.casefold() != "https"
        or parsed.username is not None
        or parsed.password is not None
    ):
        return False
    if port not in (None, 443):
        return False
    is_official_host = hostname in {"sayweee.com", "weee.com"} or hostname.endswith(
        (".sayweee.com", ".weee.com")
    )
    return (
        is_official_host
        and parsed.path == f"/{language}/search"
        and query_pairs == [("keyword", expected_query)]
    )


async def _classify_search_page(page: Any) -> PageOutcome:
    """Classify visible signals, with challenge and conflicts always untrusted."""
    result = await page.evaluate(
        """
        () => {
          const visible = (element) => Boolean(element) && !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
          const text = (document.body?.innerText || "").replace(/\\s+/g, " ").toLowerCase();
          if (/captcha|verify you are human|access denied|unusual traffic|安全验证/.test(text)) return "challenge";

          const productAnchors = Array.from(document.querySelectorAll('[data-testid*="product"] a[href*="/product/"], a[href*="/product/"]'));
          if (productAnchors.some(visible)) return "results";

          const noResultsSelector = [
            '[data-testid*="no-result"]', '[data-testid*="no_result"]',
            '[data-testid*="search-empty"]', '[class*="no-result"]',
            '[class*="empty-result"]', '[class*="search-empty"]'
          ].some((selector) => Array.from(document.querySelectorAll(selector)).some(visible));
          if (noResultsSelector) return "no_results";
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


async def _scrape_once(
    query_text: str,
    language: Language,
    attempt_number: int,
    deadline: float,
) -> list[dict[str, str]]:
    browser: Any = None
    context: Any = None
    page: Any = None
    try:
        browser = await _bounded_call(
            _ensure_shared_browser,
            deadline=deadline,
            label="browser acquisition",
        )
        context_options: dict[str, Any] = {
            "locale": "zh-CN" if language == "zh" else "en-US",
            "user_agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        }
        if language == "zh":
            context_options["extra_http_headers"] = {"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
        context = await _bounded_call(
            lambda: browser.new_context(**context_options),
            deadline=deadline,
            label="browser context creation",
        )
        page = await _bounded_call(
            context.new_page,
            deadline=deadline,
            label="search page creation",
        )
        response = await _bounded_call(
            lambda: page.goto(
                _weee_search_url(query_text, language),
                wait_until="domcontentloaded",
                timeout=PLAYWRIGHT_TIMEOUT_MS,
            ),
            deadline=deadline,
            label="search navigation",
        )
        status = getattr(response, "status", 200) if response is not None else 200
        if status >= 400:
            raise StoreScrapeError(f"Weee search returned HTTP {status}.")
        if not _is_weee_search_route(
            str(getattr(page, "url", "")),
            language,
            query_text,
        ):
            raise StoreScrapeError("Weee search was redirected to an unexpected route.")

        outcome = await _bounded_call(
            lambda: _wait_for_search_outcome(page),
            deadline=deadline,
            label="search page evaluation",
        )
        if outcome == "no_results":
            return []
        if outcome != "results":
            raise StoreScrapeError(f"Weee search page was not trustworthy: {outcome}.")
        raw_cards = await _bounded_call(
            lambda: _extract_weee_search_products(page, language),
            deadline=deadline,
            label="product extraction",
        )
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
        cleanup_failed = False
        if page is not None:
            try:
                await _bounded_await(
                    page.close(),
                    SCRAPER_CLEANUP_TIMEOUT_SECONDS,
                    "page cleanup",
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                cleanup_failed = True
        if context is not None:
            try:
                await _bounded_await(
                    context.close(),
                    SCRAPER_CLEANUP_TIMEOUT_SECONDS,
                    "context cleanup",
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                cleanup_failed = True
        if cleanup_failed and browser is not None:
            await _invalidate_shared_browser(browser)


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
    total_deadline = time.monotonic() + SCRAPER_TOTAL_TIMEOUT_SECONDS
    for attempt_number in range(1, WEEE_MAX_ATTEMPTS + 1):
        attempt_deadline = min(
            total_deadline,
            time.monotonic() + SCRAPER_ATTEMPT_TIMEOUT_SECONDS,
        )
        try:
            products = await _scrape_once(
                query_text,
                language,
                attempt_number,
                attempt_deadline,
            )
            _log_attempt(query_text, language, attempt_number, "empty" if not products else "success")
            return products
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            last_error = exc
            _log_attempt(query_text, language, attempt_number, "failure", exc)
            if attempt_number == WEEE_MAX_ATTEMPTS or time.monotonic() >= total_deadline:
                break
            try:
                await _bounded_call(
                    lambda: asyncio.sleep((0.20 * attempt_number) + random.uniform(0.0, 0.10)),
                    deadline=total_deadline,
                    label="retry backoff",
                    limit_seconds=1.0,
                )
            except StoreScrapeError as timeout:
                last_error = timeout
                break
    if isinstance(last_error, StoreScrapeError):
        raise last_error
    raise StoreScrapeError(f"Weee scraping failed for query {query_text!r}.") from last_error
