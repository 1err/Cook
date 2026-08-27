"""A self-recovering, one-page scraper for Weee search results."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import inspect
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
SCRAPER_TOTAL_CLEANUP_TIMEOUT_SECONDS = 15.0
SCRAPER_DETACHED_DRAIN_TIMEOUT_SECONDS = 5.0
_PAGE_STATE_POLLS = 15
_PAGE_STATE_POLL_MS = 500

WEEE_BASE_URL = "https://www.sayweee.com"
WEEE_SEARCH_URL = WEEE_BASE_URL + "/en/search?keyword={query}"

_browser_lock = asyncio.Lock()
_retirement_lock = asyncio.Lock()
_playwright_inst: Any = None
_shared_browser: Any = None
_detached_tasks: set[asyncio.Task[Any]] = set()
_detached_late_cleanups: dict[asyncio.Task[Any], Any] = {}
_detached_cleanup_tasks: set[asyncio.Task[Any]] = set()
_detached_cleanup_failures: list[BaseException] = []
_browser_generation = 0
_retired_browser_resources: dict[int, "_BrowserRetirement"] = {}


class StoreScrapeError(RuntimeError):
    """Weee did not produce a trustworthy result."""


class _BrowserRetirementError(StoreScrapeError):
    """A prior browser remains physically owned and blocks another launch."""


@dataclass
class _BrowserRetirement:
    browser: Any
    playwright: Any
    resources: list[tuple[Any, str]] = field(default_factory=list)
    browser_closed: bool = False
    playwright_stopped: bool = False


def _consume_background_task(task: asyncio.Task[Any]) -> None:
    was_cleanup = task in _detached_cleanup_tasks
    _detached_tasks.discard(task)
    _detached_cleanup_tasks.discard(task)
    cleanup = _detached_late_cleanups.pop(task, None)
    if task.cancelled():
        if was_cleanup:
            error = StoreScrapeError("Weee late resource cleanup was cancelled.")
            _detached_cleanup_failures.append(error)
            logger.error("weee_scraper: late resource cleanup was cancelled")
        return
    try:
        result = task.result()
    except asyncio.CancelledError:
        return
    except BaseException as exc:
        if was_cleanup:
            _detached_cleanup_failures.append(exc)
            logger.error(
                "weee_scraper: late resource cleanup failed",
                exc_info=(type(exc), exc, exc.__traceback__),
            )
        return
    if cleanup is None:
        return

    async def run_cleanup() -> None:
        maybe_awaitable = cleanup(result)
        if inspect.isawaitable(maybe_awaitable):
            await maybe_awaitable

    cleanup_task = asyncio.create_task(run_cleanup())
    _track_detached_task(cleanup_task, cleanup_task=True)


async def _event_loop_checkpoint() -> None:
    """Yield without relying on ``asyncio.sleep``, which tests replace."""
    loop = asyncio.get_running_loop()
    checkpoint = loop.create_future()

    def resume() -> None:
        if not checkpoint.done():
            checkpoint.set_result(None)

    loop.call_soon(resume)
    await checkpoint


def _track_detached_task(
    task: asyncio.Task[Any],
    *,
    late_result_cleanup: Any = None,
    cleanup_task: bool = False,
) -> None:
    if task.done():
        if late_result_cleanup is not None:
            _detached_late_cleanups[task] = late_result_cleanup
        _consume_background_task(task)
        return
    _detached_tasks.add(task)
    if late_result_cleanup is not None:
        _detached_late_cleanups[task] = late_result_cleanup
    if cleanup_task:
        _detached_cleanup_tasks.add(task)
    task.add_done_callback(_consume_background_task)


def _raise_detached_cleanup_failures() -> None:
    if not _detached_cleanup_failures:
        return
    failures = list(_detached_cleanup_failures)
    _detached_cleanup_failures.clear()
    if len(failures) == 1:
        raise StoreScrapeError("Weee late resource cleanup failed.") from failures[0]
    raise BaseExceptionGroup(
        "Weee late resource cleanup failures.",
        failures,
    )


async def _bounded_await(
    awaitable: Any,
    timeout_seconds: float,
    label: str,
    *,
    late_result_cleanup: Any = None,
) -> Any:
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
        _track_detached_task(task, late_result_cleanup=late_result_cleanup)
        await asyncio.sleep(0)
        raise
    if task in done:
        return task.result()
    task.cancel()
    _track_detached_task(task, late_result_cleanup=late_result_cleanup)
    await asyncio.sleep(0)
    raise StoreScrapeError(f"Weee {label} timed out.")


async def _bounded_call(
    factory: Any,
    *,
    deadline: float,
    label: str,
    limit_seconds: float | None = None,
    late_result_cleanup: Any = None,
) -> Any:
    remaining = deadline - time.monotonic()
    operation_limit = (
        SCRAPER_OPERATION_TIMEOUT_SECONDS
        if limit_seconds is None
        else limit_seconds
    )
    return await _bounded_await(
        factory(),
        min(operation_limit, remaining),
        label,
        late_result_cleanup=late_result_cleanup,
    )


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _extract_price(text: str) -> str:
    normalized = _normalize_space(text)
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
    return 1 <= len(cleaned) <= 120


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
    for raw in (primary, title_hint, _extract_weee_search_card_title_block(text), image_alt):
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


def _cleanup_machine_image_name(raw: str) -> str:
    name = _normalize_space(raw)
    if not re.match(r"^weee_(?:dried_)?", name, re.IGNORECASE):
        return name
    name = re.sub(r"^weee_(?:dried_)?", "", name, flags=re.IGNORECASE)
    name = re.sub(
        r"_(?:front|back|side)(?:_\d+x\d+)?$",
        "",
        name,
        flags=re.IGNORECASE,
    )
    return _normalize_space(name.replace("_", " "))


def _normalize_weee_product(candidate: dict[str, Any], *, prefer_zh: bool = False) -> dict[str, str] | None:
    href = _normalize_space(str(candidate.get("href") or ""))
    url = normalize_weee_product_url(href, base_url=WEEE_BASE_URL)
    if url is None:
        return None

    text = _normalize_space(str(candidate.get("text") or ""))
    link_name = _normalize_space(str(candidate.get("name") or ""))
    image_alt = _normalize_space(str(candidate.get("image_alt") or ""))
    primary_title = _normalize_space(str(candidate.get("primary_title") or ""))
    title_hint = _normalize_space(str(candidate.get("title_hint") or ""))
    name = ""
    if prefer_zh:
        name = _resolve_weee_zh_product_name(candidate)
    if not name:
        for candidate_name in (primary_title, title_hint, _cleanup_name(text)):
            cleaned = _cleanup_name(candidate_name)
            if _is_valid_name(cleaned):
                name = cleaned
                break
    if not name:
        fallback_name = _cleanup_machine_image_name(link_name or image_alt)
        if _is_valid_name(fallback_name):
            name = fallback_name
    if not _is_valid_name(name):
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
    except BaseException as launch_error:
        # The exact Playwright owner remains a physical lifecycle fence until
        # stop is confirmed. A failed/timed-out/cancelled first cleanup must not
        # permit a second driver process to start beside it.
        _register_browser_retirement(None, playwright)
        try:
            await _retry_retired_browser_resources()
        except asyncio.CancelledError:
            raise
        except _BrowserRetirementError as cleanup_error:
            raise cleanup_error from launch_error
        raise
    logger.info("weee_scraper: launched shared Playwright browser")
    return playwright, browser


def _browser_is_connected(browser: Any) -> bool:
    try:
        connected = browser.is_connected()
        return bool(connected)
    except Exception:
        return False


def _cleanup_timeout(deadline: float | None) -> float:
    if deadline is None:
        return SCRAPER_CLEANUP_TIMEOUT_SECONDS
    return min(SCRAPER_CLEANUP_TIMEOUT_SECONDS, deadline - time.monotonic())


def _register_browser_retirement(
    browser: Any,
    playwright: Any,
    resources: tuple[tuple[Any, str], ...] = (),
) -> None:
    if browser is None and playwright is None:
        return
    identity = id(browser) if browser is not None else id(playwright)
    retirement = _retired_browser_resources.get(identity)
    if retirement is None:
        retirement = _BrowserRetirement(
            browser=browser,
            playwright=playwright,
            browser_closed=browser is None,
            playwright_stopped=playwright is None,
        )
        _retired_browser_resources[identity] = retirement
    elif retirement.playwright is None and playwright is not None:
        retirement.playwright = playwright
        retirement.playwright_stopped = False
    for resource, label in resources:
        if resource is None:
            continue
        if any(owned is resource for owned, _ in retirement.resources):
            continue
        retirement.resources.append((resource, label))


async def _attempt_browser_retirement(
    retirement: _BrowserRetirement,
    *,
    deadline: float | None = None,
) -> tuple[bool, bool]:
    """Attempt every retirement substage and retain anything unconfirmed."""
    caller_cancelled = False
    remaining_resources: list[tuple[Any, str]] = []
    for resource, label in list(retirement.resources):
        try:
            await _bounded_await(
                resource.close(),
                _cleanup_timeout(deadline),
                label,
            )
        except asyncio.CancelledError:
            current = asyncio.current_task()
            caller_cancelled = caller_cancelled or bool(
                current is not None and current.cancelling()
            )
            remaining_resources.append((resource, label))
        except BaseException as exc:
            remaining_resources.append((resource, label))
            logger.warning(
                "weee_scraper: retained %s after cleanup failure: %s",
                label,
                type(exc).__name__,
            )
    retirement.resources = remaining_resources

    browser = retirement.browser
    if browser is not None and not retirement.browser_closed:
        try:
            await _bounded_await(
                browser.close(),
                _cleanup_timeout(deadline),
                "browser retirement",
            )
        except asyncio.CancelledError:
            current = asyncio.current_task()
            caller_cancelled = caller_cancelled or bool(
                current is not None and current.cancelling()
            )
        except BaseException as exc:
            if _browser_is_connected(browser):
                logger.warning(
                    "weee_scraper: retained connected browser after retirement failure: %s",
                    type(exc).__name__,
                )
            else:
                retirement.browser_closed = True
        else:
            retirement.browser_closed = True
        if retirement.browser_closed or not _browser_is_connected(browser):
            retirement.browser_closed = True
            retirement.browser = None
            retirement.resources.clear()

    playwright = retirement.playwright
    if playwright is not None and not retirement.playwright_stopped:
        try:
            await _bounded_await(
                playwright.stop(),
                _cleanup_timeout(deadline),
                "retired Playwright cleanup",
            )
        except asyncio.CancelledError:
            current = asyncio.current_task()
            caller_cancelled = caller_cancelled or bool(
                current is not None and current.cancelling()
            )
        except BaseException as exc:
            logger.warning(
                "weee_scraper: retained Playwright after cleanup failure: %s",
                type(exc).__name__,
            )
        else:
            retirement.playwright_stopped = True
            retirement.playwright = None

    browser = retirement.browser
    if browser is not None and not _browser_is_connected(browser):
        retirement.browser_closed = True
        retirement.browser = None
        retirement.resources.clear()
    complete = (
        retirement.browser_closed
        and retirement.playwright_stopped
        and not retirement.resources
    )
    return complete, caller_cancelled


async def _retry_retired_browser_resources(
    *,
    deadline: float | None = None,
) -> None:
    if any(not task.done() for task in _detached_tasks):
        raise _BrowserRetirementError(
            "Prior Weee browser cleanup is still in progress."
        )
    caller_cancelled = False
    async with _retirement_lock:
        if any(not task.done() for task in _detached_tasks):
            raise _BrowserRetirementError(
                "Prior Weee browser cleanup is still in progress."
            )
        for identity, retirement in list(_retired_browser_resources.items()):
            complete, cancelled = await _attempt_browser_retirement(
                retirement,
                deadline=deadline,
            )
            caller_cancelled = caller_cancelled or cancelled
            if complete and _retired_browser_resources.get(identity) is retirement:
                _retired_browser_resources.pop(identity, None)
    if caller_cancelled:
        raise asyncio.CancelledError
    if _retired_browser_resources:
        raise _BrowserRetirementError(
            "A prior Weee browser could not be retired; scraping is temporarily unavailable."
        )


async def _close_browser_resources(
    browser: Any,
    playwright: Any,
    *,
    deadline: float | None = None,
) -> None:
    caller_cancelled = False
    substages = (
        (browser, "close", "browser cleanup"),
        (playwright, "stop", "Playwright cleanup"),
    )
    for resource, method_name, label in substages:
        if resource is None:
            continue
        try:
            await _bounded_await(
                getattr(resource, method_name)(),
                _cleanup_timeout(deadline),
                label,
            )
        except asyncio.CancelledError:
            current = asyncio.current_task()
            caller_cancelled = caller_cancelled or bool(
                current is not None and current.cancelling()
            )
        except Exception as exc:
            logger.warning("weee_scraper: %s failed: %s", label, type(exc).__name__)
    if caller_cancelled:
        raise asyncio.CancelledError


async def _invalidate_shared_browser(
    observed_browser: Any | None = None,
    *,
    deadline: float | None = None,
    failed_resources: tuple[tuple[Any, str], ...] = (),
) -> bool:
    global _shared_browser, _playwright_inst, _browser_generation
    lock_timeout = _cleanup_timeout(deadline)
    if lock_timeout <= 0:
        raise StoreScrapeError("Weee browser resource lock timed out.")
    try:
        await asyncio.wait_for(_browser_lock.acquire(), timeout=lock_timeout)
    except TimeoutError as exc:
        raise StoreScrapeError("Weee browser resource lock timed out.") from exc
    try:
        if observed_browser is not None and _shared_browser is not observed_browser:
            matched = False
            browser, playwright = observed_browser, None
        else:
            matched = True
            _browser_generation += 1
            browser, playwright = _shared_browser, _playwright_inst
            _shared_browser = None
            _playwright_inst = None
        _register_browser_retirement(
            browser,
            playwright,
            failed_resources,
        )
    finally:
        _browser_lock.release()
    await _retry_retired_browser_resources(deadline=deadline)
    return matched


async def _cleanup_late_browser_resource(
    resource: Any,
    browser: Any,
    label: str,
) -> None:
    """Close a late page/context and retire the exact browser if that close fails."""
    try:
        await resource.close()
        return
    except BaseException as exc:
        logger.error(
            "weee_scraper: late %s failed; retiring its browser",
            label,
            exc_info=(type(exc), exc, exc.__traceback__),
        )
        try:
            await _invalidate_shared_browser(
                browser,
                failed_resources=((resource, label),),
            )
        except BaseException as retirement_error:
            logger.error(
                "weee_scraper: browser retirement after late cleanup failure failed",
                exc_info=(
                    type(retirement_error),
                    retirement_error,
                    retirement_error.__traceback__,
                ),
            )
        raise StoreScrapeError(f"Weee late {label} failed.") from exc


async def _drain_detached_tasks() -> None:
    deadline = asyncio.get_running_loop().time() + SCRAPER_DETACHED_DRAIN_TIMEOUT_SECONDS
    cancel_requested: set[asyncio.Task[Any]] = set()
    empty_passes = 0
    pending: set[asyncio.Task[Any]] = set()
    while True:
        pending = {task for task in _detached_tasks if not task.done()}
        if not pending:
            if empty_passes >= 2:
                await _retry_retired_browser_resources(deadline=deadline)
                _raise_detached_cleanup_failures()
                return
            empty_passes += 1
            if asyncio.get_running_loop().time() >= deadline:
                return
            await _event_loop_checkpoint()
            continue
        empty_passes = 0
        for task in pending - _detached_cleanup_tasks - cancel_requested:
            task.cancel()
            cancel_requested.add(task)
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        done, _ = await asyncio.wait(
            pending,
            timeout=remaining,
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in done:
            _consume_background_task(task)
        await _event_loop_checkpoint()
    pending = {task for task in _detached_tasks if not task.done()}
    for task in pending - cancel_requested:
        task.cancel()
    if pending:
        logger.error(
            "weee_scraper: %s detached Playwright operation(s) outlived shutdown deadline",
            len(pending),
        )


async def shutdown_weee_scraper() -> None:
    """Close the process-shared browser resources; safe to call repeatedly."""
    errors: list[BaseException] = []
    caller_cancelled = False
    for phase in (
        _invalidate_shared_browser,
        _drain_detached_tasks,
        _retry_retired_browser_resources,
    ):
        try:
            await phase()
        except asyncio.CancelledError as exc:
            current = asyncio.current_task()
            if current is not None and current.cancelling():
                caller_cancelled = True
            else:
                errors.append(exc)
        except BaseException as exc:
            errors.append(exc)
    if not _retired_browser_resources:
        errors = [
            error
            for error in errors
            if not isinstance(error, _BrowserRetirementError)
        ]
    if caller_cancelled:
        raise asyncio.CancelledError
    if len(errors) == 1:
        raise errors[0]
    if errors:
        raise BaseExceptionGroup("Weee scraper shutdown failures", errors)


async def _ensure_shared_browser() -> Any:
    global _shared_browser, _playwright_inst
    while True:
        await _retry_retired_browser_resources()
        retry_retirement = False
        async with _browser_lock:
            if _retired_browser_resources:
                retry_retirement = True
            elif _shared_browser is not None and _browser_is_connected(_shared_browser):
                return _shared_browser
            else:
                stale_browser, stale_playwright = _shared_browser, _playwright_inst
                _shared_browser = None
                _playwright_inst = None
                generation = _browser_generation
                _register_browser_retirement(stale_browser, stale_playwright)
        if retry_retirement:
            continue
        await _retry_retired_browser_resources()
        break
    playwright, browser = await _launch_browser()
    winner: Any = None
    publish = False
    async with _browser_lock:
        current = asyncio.current_task()
        if (
            generation == _browser_generation
            and _shared_browser is None
            and not _retired_browser_resources
            and not (current is not None and current.cancelling())
        ):
            _playwright_inst, _shared_browser = playwright, browser
            publish = True
        elif generation == _browser_generation and _browser_is_connected(_shared_browser):
            winner = _shared_browser
        if not publish:
            _register_browser_retirement(browser, playwright)
    if publish:
        return browser
    await _retry_retired_browser_resources()
    if winner is not None:
        return winner
    raise StoreScrapeError("Weee browser acquisition was invalidated by lifecycle shutdown.")


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
    expected_path = f"/{language}/search"
    keyword_values = [value for key, value in query_pairs if key == "keyword"]
    return (
        is_official_host
        and parsed.path in {expected_path, f"{expected_path}/"}
        and keyword_values == [expected_query]
    )


def _weee_search_scope_javascript() -> str:
    """Return the one DOM scope shared by classification and extraction."""
    return r"""
      const visible = (element) => Boolean(element) && !!(
        element.offsetWidth || element.offsetHeight || element.getClientRects().length
      );
      const excludedRegionSelector = [
        '[data-testid*="recommend" i]', '[data-testid*="carousel" i]',
        '[data-section*="recommend" i]', '[data-section*="carousel" i]',
        '[id*="recommend" i]', '[id*="carousel" i]',
        '[aria-label*="recommend" i]', '[aria-label*="carousel" i]',
        '[class*="recommend" i]', '[class*="carousel" i]',
        '[class*="similar" i]', '[class*="recently" i]'
      ].join(',');
      const currentProductCardSelector = '[data-testid="wid-product-card-container"]';
      const fallbackProductCardSelector = [
        '[data-testid*="product-card" i]',
        '[data-testid*="search-product" i]',
        '[class~="product-card" i]', '[class~="productCard"]',
        '[class~="search-result-card" i]',
        '[class~="SearchResultCard"]'
      ].join(',');
      const seenAnchors = new Set();
      const scopedProducts = [];
      for (const anchor of document.querySelectorAll('a[href*="/product/"]')) {
        if (!visible(anchor) || seenAnchors.has(anchor)) continue;
        if (anchor.closest(excludedRegionSelector)) continue;
        const card = anchor.closest(currentProductCardSelector)
          || anchor.closest(fallbackProductCardSelector);
        if (!card || !visible(card) || card.closest(excludedRegionSelector)) continue;
        seenAnchors.add(anchor);
        scopedProducts.push({anchor, card});
      }
    """


async def _classify_search_page(page: Any, expected_query: str = "") -> PageOutcome:
    """Classify visible signals, with challenge and conflicts always untrusted."""
    script = r"""
        (expectedQuery) => {
          const text = (document.body?.innerText || "").replace(/\\s+/g, " ").toLowerCase();
          if (/captcha|verify you are human|access denied|unusual traffic|安全验证/.test(text)) return "challenge";
          __WEEE_SEARCH_SCOPE__
          const excludedEmptyRegionSelector = [
            excludedRegionSelector, 'footer', 'header', 'nav', 'aside'
          ].join(',');
          const scopedVisibleEmpty = (element) => (
            visible(element) && !element.closest(excludedEmptyRegionSelector)
          );
          const noResultsSelector = [
            '[data-testid*="no-result"]', '[data-testid*="no_result"]',
            '[data-testid*="search-empty"]', '[class*="no-result"]',
            '[class*="empty-result"]', '[class*="search-empty"]'
          ].some((selector) => Array.from(document.querySelectorAll(selector)).some(scopedVisibleEmpty));
          const exactEmptyClasses = [
            'max-w-[380px]', 'enki-heading-xl',
            'text-surface-100-fg-default', 'break-words'
          ];
          const normalizedExpected = String(expectedQuery || '').replace(/\s+/g, ' ').trim();
          const expectedEmptyText = normalizedExpected
            ? `Sorry, no results were found for "${normalizedExpected}"`.toLocaleLowerCase()
            : '';
          const currentExactEmpty = Boolean(expectedEmptyText) && Array.from(
            document.querySelectorAll('li')
          ).some((element) => (
            scopedVisibleEmpty(element)
            && exactEmptyClasses.every((token) => element.classList.contains(token))
            && (element.textContent || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
              === expectedEmptyText
          ));
          const hasEmpty = noResultsSelector || currentExactEmpty;
          if (scopedProducts.length && hasEmpty) return "pending";
          if (scopedProducts.length) return "results";
          if (hasEmpty) return "no_results";
          return "pending";
        }
        """.replace("__WEEE_SEARCH_SCOPE__", _weee_search_scope_javascript())
    result = await page.evaluate(script, expected_query)
    if result in ("results", "no_results", "challenge", "pending"):
        return result
    return "pending"


async def _wait_for_search_outcome(page: Any, expected_query: str = "") -> PageOutcome:
    for poll in range(_PAGE_STATE_POLLS):
        outcome = await _classify_search_page(page, expected_query)
        if outcome != "pending":
            return outcome
        if poll + 1 < _PAGE_STATE_POLLS:
            await page.wait_for_timeout(_PAGE_STATE_POLL_MS)
    return "pending"


def _weee_extract_script() -> str:
    return """
    () => {
      __WEEE_SEARCH_SCOPE__
      return scopedProducts.map(({anchor, card}) => {
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
    }
    """.replace("__WEEE_SEARCH_SCOPE__", _weee_search_scope_javascript())


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
    cleanup_deadline: float,
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
            late_result_cleanup=lambda late_context, owned_browser=browser: (
                _cleanup_late_browser_resource(
                    late_context,
                    owned_browser,
                    "context cleanup",
                )
            ),
        )
        page = await _bounded_call(
            context.new_page,
            deadline=deadline,
            label="search page creation",
            late_result_cleanup=lambda late_page, owned_browser=browser: (
                _cleanup_late_browser_resource(
                    late_page,
                    owned_browser,
                    "page cleanup",
                )
            ),
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
            lambda: _wait_for_search_outcome(page, query_text),
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
            await _invalidate_shared_browser(browser, deadline=cleanup_deadline)
        raise
    finally:
        failed_resources: list[tuple[Any, str]] = []
        cleanup_error: BaseException | None = None
        caller_cancelled = False
        for resource, label in (
            (page, "page cleanup"),
            (context, "context cleanup"),
        ):
            if resource is None:
                continue
            try:
                await _bounded_await(
                    resource.close(),
                    min(
                        SCRAPER_CLEANUP_TIMEOUT_SECONDS,
                        cleanup_deadline - time.monotonic(),
                    ),
                    label,
                )
            except asyncio.CancelledError:
                current = asyncio.current_task()
                caller_cancelled = caller_cancelled or bool(
                    current is not None and current.cancelling()
                )
                failed_resources.append((resource, label))
                cleanup_error = cleanup_error or StoreScrapeError(
                    f"Weee {label} was cancelled before completion."
                )
            except Exception as exc:
                failed_resources.append((resource, label))
                cleanup_error = cleanup_error or StoreScrapeError(
                    f"Weee {label} failed."
                )
                logger.warning(
                    "weee_scraper: retained %s after attempt failure: %s",
                    label,
                    type(exc).__name__,
                )
        if failed_resources and browser is not None:
            try:
                await _invalidate_shared_browser(
                    browser,
                    deadline=cleanup_deadline,
                    failed_resources=tuple(failed_resources),
                )
            except asyncio.CancelledError:
                current = asyncio.current_task()
                caller_cancelled = caller_cancelled or bool(
                    current is not None and current.cancelling()
                )
            except BaseException as exc:
                cleanup_error = exc
                logger.warning(
                    "weee_scraper: browser retirement remains fenced after attempt cleanup",
                    exc_info=(type(exc), exc, exc.__traceback__),
                )
        if caller_cancelled:
            raise asyncio.CancelledError
        if cleanup_error is not None:
            raise cleanup_error


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
    cleanup_deadline = total_deadline + SCRAPER_TOTAL_CLEANUP_TIMEOUT_SECONDS
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
                cleanup_deadline,
            )
            await wait_for_scraper_quiescence()
            _log_attempt(query_text, language, attempt_number, "empty" if not products else "success")
            return products
        except asyncio.CancelledError:
            await wait_for_scraper_quiescence()
            raise
        except Exception as exc:
            await wait_for_scraper_quiescence()
            last_error = exc
            _log_attempt(query_text, language, attempt_number, "failure", exc)
            if (
                isinstance(exc, _BrowserRetirementError)
                or attempt_number == WEEE_MAX_ATTEMPTS
                or time.monotonic() >= total_deadline
            ):
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


async def wait_for_scraper_quiescence() -> None:
    """Hold the process-local serial permit until every owned child is finished."""
    current = asyncio.current_task()
    caller_cancelled = bool(current is not None and current.cancelling())
    empty_passes = 0
    while True:
        tasks = {task for task in _detached_tasks if not task.done()}
        if not tasks:
            if empty_passes >= 2:
                retirement_error: BaseException | None = None
                try:
                    await _retry_retired_browser_resources()
                except asyncio.CancelledError:
                    current = asyncio.current_task()
                    caller_cancelled = caller_cancelled or bool(
                        current is not None and current.cancelling()
                    )
                except BaseException as exc:
                    retirement_error = exc
                if any(not task.done() for task in _detached_tasks):
                    empty_passes = 0
                    continue
                if caller_cancelled:
                    raise asyncio.CancelledError
                if retirement_error is not None:
                    raise retirement_error
                _raise_detached_cleanup_failures()
                return
            empty_passes += 1
            try:
                await _event_loop_checkpoint()
            except asyncio.CancelledError:
                current = asyncio.current_task()
                caller_cancelled = caller_cancelled or bool(
                    current is not None and current.cancelling()
                )
            continue
        empty_passes = 0
        for task in tasks:
            while not task.done():
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    current = asyncio.current_task()
                    caller_cancelled = caller_cancelled or bool(
                        current is not None and current.cancelling()
                    )
                    if task.done():
                        break
                except BaseException:
                    break
        try:
            await _event_loop_checkpoint()
        except asyncio.CancelledError:
            current = asyncio.current_task()
            caller_cancelled = caller_cancelled or bool(
                current is not None and current.cancelling()
            )
