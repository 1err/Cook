import asyncio
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from types import ModuleType
from typing import Any

import pytest
import pytest_asyncio

from app.services import weee_scraper


PRODUCT = {
    "name": "Silken tofu",
    "price": "$2.99",
    "image": "https://images.example.test/tofu.jpg",
    "url": "https://www.sayweee.com/product/tofu",
}
FIRM_TOFU = {
    "name": "Firm tofu",
    "price": "$3.99",
    "image": "https://images.example.test/firm-tofu.jpg",
    "url": "https://www.sayweee.com/product/firm-tofu",
}
FRIED_TOFU = {
    "name": "Fried tofu",
    "price": "$4.99",
    "image": "https://images.example.test/fried-tofu.jpg",
    "url": "https://www.sayweee.com/product/fried-tofu",
}
SEARCH_CARD = {
    "href": PRODUCT["url"],
    "name": PRODUCT["name"],
    "price": PRODUCT["price"],
    "image": PRODUCT["image"],
}
SEARCH_CARDS_WITH_DUPLICATES = [
    SEARCH_CARD,
    {**SEARCH_CARD, "name": "Silken tofu duplicate"},
    {
        "href": FIRM_TOFU["url"],
        "name": FIRM_TOFU["name"],
        "price": FIRM_TOFU["price"],
        "image": FIRM_TOFU["image"],
    },
    {
        "href": FRIED_TOFU["url"],
        "name": FRIED_TOFU["name"],
        "price": FRIED_TOFU["price"],
        "image": FRIED_TOFU["image"],
    },
]


class _NavigationError:
    def __get__(self, attempt: "Attempt | None", owner: type["Attempt"]) -> Any:
        if attempt is None:
            return lambda error: owner(_navigation_error=error)
        return attempt._navigation_error


class _PageState:
    def __get__(self, attempt: "Attempt | None", owner: type["Attempt"]) -> Any:
        if attempt is None:
            return lambda state: owner(_page_state=state)
        return attempt._page_state


@dataclass(frozen=True)
class Attempt:
    _navigation_error: BaseException | None = None
    http_status: int = 200
    final_url: str | None = None
    _page_state: str = "results"
    cards: list[dict[str, str]] = field(default_factory=list)
    disconnect_browser: bool = False
    hang_evaluate: bool = False
    hang_page_close: bool = False

    navigation_error = _NavigationError()
    page_state = _PageState()

    @classmethod
    def results(cls, cards: list[dict[str, str]]) -> "Attempt":
        return cls(_page_state="results", cards=cards)

    @classmethod
    def browser_disconnect(cls) -> "Attempt":
        return cls(
            _navigation_error=RuntimeError("Target page, context or browser has been closed"),
            disconnect_browser=True,
        )


class BrowserHarness:
    def __init__(self, attempts: Iterable[Attempt]):
        self.attempts = iter(attempts)
        self.browser_launches = 0
        self.context_count = 0
        self.page_count = 0
        self.closed_contexts = 0
        self.max_open_pages = 0
        self._open_pages = 0

    def install(self, monkeypatch: pytest.MonkeyPatch, *, patch_classifier: bool = True) -> None:
        harness = self

        class Response:
            def __init__(self, status: int):
                self.status = status

        class Page:
            def __init__(self, browser: "Browser", attempt: Attempt):
                self.browser = browser
                self.attempt = attempt
                self.url = attempt.final_url or "about:blank"
                self.closed = False

            async def goto(self, *args: Any, **kwargs: Any) -> Response:
                if self.attempt.final_url is None:
                    self.url = str(args[0])
                if self.attempt.disconnect_browser:
                    self.browser.connected = False
                if self.attempt.navigation_error is not None:
                    raise self.attempt.navigation_error
                return Response(self.attempt.http_status)

            async def evaluate(self, *args: Any, **kwargs: Any) -> object:
                if self.attempt.hang_evaluate:
                    await asyncio.Event().wait()
                return self.attempt.page_state

            async def wait_for_timeout(self, *args: Any, **kwargs: Any) -> None:
                return None

            async def close(self) -> None:
                if self.attempt.hang_page_close:
                    await asyncio.Event().wait()
                if not self.closed:
                    self.closed = True
                    harness._open_pages -= 1

        class Context:
            def __init__(self, browser: "Browser", attempt: Attempt):
                self.browser = browser
                self.attempt = attempt
                self.closed = False

            async def new_page(self) -> Page:
                harness.page_count += 1
                harness._open_pages += 1
                harness.max_open_pages = max(harness.max_open_pages, harness._open_pages)
                return Page(self.browser, self.attempt)

            async def close(self) -> None:
                if not self.closed:
                    self.closed = True
                    harness.closed_contexts += 1

        class Browser:
            def __init__(self):
                self.connected = True
                self.closed = False

            def is_connected(self) -> bool:
                return self.connected

            async def new_context(self, **kwargs: Any) -> Context:
                harness.context_count += 1
                return Context(self, next(harness.attempts))

            async def close(self) -> None:
                self.closed = True
                self.connected = False

        class Playwright:
            async def stop(self) -> None:
                return None

        async def launch_browser() -> tuple[Playwright, Browser]:
            harness.browser_launches += 1
            return Playwright(), Browser()

        async def classify(page: Page) -> str:
            return page.attempt.page_state

        async def extract(page: Page, language: str) -> list[dict[str, str]]:
            return page.attempt.cards

        async def no_sleep(*args: Any, **kwargs: Any) -> None:
            return None

        monkeypatch.setattr(weee_scraper, "_launch_browser", launch_browser)
        if patch_classifier:
            monkeypatch.setattr(weee_scraper, "_classify_search_page", classify)
        monkeypatch.setattr(weee_scraper, "_extract_weee_search_products", extract)
        monkeypatch.setattr(weee_scraper.asyncio, "sleep", no_sleep)
        monkeypatch.setattr(weee_scraper, "_shared_browser", None)
        monkeypatch.setattr(weee_scraper, "_playwright_inst", None)


@pytest_asyncio.fixture
async def real_browser_page():
    """Exercise the exact browser JavaScript used in production."""
    from playwright.async_api import async_playwright

    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(headless=True)
    page = await browser.new_page()
    try:
        yield page
    finally:
        await page.close()
        await browser.close()
        await playwright.stop()


@pytest.mark.parametrize(
    ("url", "expected_query", "accepted"),
    [
        ("https://www.sayweee.com/en/search?keyword=rice+noodles", "rice noodles", True),
        ("https://www.sayweee.com/en/search/?utm_source=qa&keyword=rice%20noodles&sort=popular", "rice noodles", True),
        ("https://www.sayweee.com/en/search?keyword=%72ice&ref=header", "rice", True),
        ("https://shop.weee.com/zh/search?keyword=%E6%96%B0%E9%B2%9C+%E5%A4%A7%E8%92%9C", "新鲜 大蒜", True),
        ("http://www.sayweee.com/en/search?keyword=rice", "rice", False),
        ("https://user@www.sayweee.com/en/search?keyword=rice", "rice", False),
        ("https://@www.sayweee.com/en/search?keyword=rice", "rice", False),
        ("https://www.sayweee.com:444/en/search?keyword=rice", "rice", False),
        ("https://www.sayweee.com/en/search", "rice", False),
        ("https://www.sayweee.com/en/search?keyword=beans", "rice", False),
        ("https://www.sayweee.com/en/search?keyword=rice&keyword=beans", "rice", False),
        ("https://www.sayweee.com/en/search?keyword=rice&keyword=rice&utm_source=qa", "rice", False),
        ("https://sayweee.com.evil.test/en/search/?keyword=rice&utm_source=qa", "rice", False),
        ("https://www.sayweee.com/en/product/rice?keyword=rice", "rice", False),
    ],
)
def test_final_search_url_requires_the_exact_safe_query(
    url: str,
    expected_query: str,
    accepted: bool,
):
    language = "zh" if "/zh/" in url else "en"
    assert weee_scraper._is_weee_search_route(url, language, expected_query) is accepted


@pytest.mark.asyncio
async def test_real_dom_challenge_dominates_a_visible_product(real_browser_page):
    await real_browser_page.set_content(
        """
        <main>
          <p>Verify you are human</p>
          <article data-testid="product-card">
            <a href="https://www.sayweee.com/en/product/tofu/1">Tofu</a>
          </article>
        </main>
        """
    )
    assert await weee_scraper._classify_search_page(real_browser_page) == "challenge"


@pytest.mark.asyncio
async def test_real_dom_challenge_dominates_a_visible_empty_state(real_browser_page):
    await real_browser_page.set_content(
        '<main><p>Captcha required</p><div data-testid="no-results">No results</div></main>'
    )
    assert await weee_scraper._classify_search_page(real_browser_page) == "challenge"


@pytest.mark.asyncio
async def test_real_dom_generic_empty_copy_is_not_authoritative(real_browser_page):
    await real_browser_page.set_content(
        "<main><h1>Search</h1><p>No products found in this featured collection.</p></main>"
    )
    assert await weee_scraper._classify_search_page(real_browser_page) == "pending"


@pytest.mark.asyncio
async def test_real_dom_unrelated_empty_element_is_not_authoritative(real_browser_page):
    await real_browser_page.set_content(
        '<main><div data-testid="empty-cart">Your cart is empty</div></main>'
    )
    assert await weee_scraper._classify_search_page(real_browser_page) == "pending"


@pytest.mark.asyncio
async def test_real_dom_visible_specific_empty_element_is_authoritative(real_browser_page):
    await real_browser_page.set_content(
        '<main><div data-testid="no-results">Nothing matched</div></main>'
    )
    assert await weee_scraper._classify_search_page(real_browser_page) == "no_results"


@pytest.mark.asyncio
async def test_real_dom_no_results_ignores_recommendation_carousel_products(real_browser_page):
    await real_browser_page.set_content(
        """
        <main>
          <div data-testid="no-results">Nothing matched</div>
          <section data-testid="recommendation-carousel" aria-label="Recommended for you">
            <article data-testid="product-card">
              <a href="https://www.sayweee.com/en/product/recommended-tofu/1">
                <img alt="Recommended tofu" />
              </a>
            </article>
          </section>
        </main>
        """
    )

    assert await weee_scraper._classify_search_page(real_browser_page) == "no_results"
    assert await weee_scraper._extract_weee_search_products(real_browser_page, "en") == []


@pytest.mark.asyncio
async def test_real_dom_no_results_ignores_data_section_recommendations(real_browser_page):
    await real_browser_page.set_content(
        """
        <main>
          <div data-testid="no-results">Nothing matched</div>
          <section data-section="recommendations">
            <article data-testid="product-card">
              <a href="https://www.sayweee.com/en/product/recommended-beans/1">
                <img alt="Recommended beans" />
              </a>
            </article>
          </section>
        </main>
        """
    )

    assert await weee_scraper._classify_search_page(real_browser_page) == "no_results"
    assert await weee_scraper._extract_weee_search_products(real_browser_page, "en") == []


@pytest.mark.asyncio
async def test_real_dom_conflicting_search_product_and_empty_marker_is_pending(real_browser_page):
    await real_browser_page.set_content(
        """
        <main>
          <div data-testid="search-empty">Nothing matched</div>
          <article data-testid="product-card">
            <a href="https://www.sayweee.com/en/product/scoped-rice/1">
              <img alt="Scoped rice" />
            </a>
          </article>
        </main>
        """
    )

    assert await weee_scraper._classify_search_page(real_browser_page) == "pending"
    extracted = await weee_scraper._extract_weee_search_products(real_browser_page, "en")
    assert [row["href"] for row in extracted] == [
        "https://www.sayweee.com/en/product/scoped-rice/1"
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "card_markup",
    [
        '<li class="search-result-card"><a href="https://www.sayweee.com/en/product/rice/1"><img alt="Rice" /></a></li>',
        '<div data-testid="search-product-card"><a href="https://www.sayweee.com/en/product/beans/1"><h3>Beans</h3></a></div>',
        '<article data-testid="product-card-42"><a href="https://www.sayweee.com/en/product/tofu/1"><img alt="Tofu" /></a></article>',
        '<a data-testid="search-product-card" href="https://www.sayweee.com/en/product/ginger/1"><img alt="Ginger" /></a>',
    ],
)
async def test_real_dom_realistic_scoped_search_cards_classify_and_extract(
    real_browser_page,
    card_markup: str,
):
    await real_browser_page.set_content(f"<main>{card_markup}</main>")

    assert await weee_scraper._classify_search_page(real_browser_page) == "results"
    assert len(await weee_scraper._extract_weee_search_products(real_browser_page, "en")) == 1


@pytest.mark.asyncio
async def test_real_dom_extracts_and_normalizes_a_visible_product(real_browser_page):
    await real_browser_page.set_content(
        """
        <article data-testid="product-card">
          <a href="https://www.sayweee.com/en/product/silken-tofu/1">
            <img alt="Silken tofu" src="https://images.example.test/tofu.jpg" />
            <h3>Silken tofu</h3>
            <span>$2.99</span>
          </a>
        </article>
        """
    )
    raw = await weee_scraper._extract_weee_search_products(real_browser_page, "en")
    normalized = [
        product
        for card in raw
        if isinstance(card, dict)
        if (product := weee_scraper._normalize_weee_product(card)) is not None
    ]
    assert weee_scraper.validate_products(normalized) == [
        {
            "name": "Silken tofu",
            "price": "$2.99",
            "image": "https://images.example.test/tofu.jpg",
            "url": "https://www.sayweee.com/en/product/silken-tofu/1",
        }
    ]


@pytest.mark.asyncio
async def test_navigation_failure_then_success_recovers_in_one_logical_call(monkeypatch):
    harness = BrowserHarness([
        Attempt.navigation_error(TimeoutError("first navigation timed out")),
        Attempt.results([SEARCH_CARD]),
    ])
    harness.install(monkeypatch)

    assert await weee_scraper.scrape_weee_products("garlic", "en") == [PRODUCT]
    assert harness.context_count == 2
    assert harness.max_open_pages == 1
    assert harness.closed_contexts == 2


@pytest.mark.asyncio
async def test_unexplained_empty_dom_then_success_is_retried(monkeypatch):
    harness = BrowserHarness([
        Attempt.page_state("pending"),
        Attempt.results([SEARCH_CARD]),
    ])
    harness.install(monkeypatch)

    assert await weee_scraper.scrape_weee_products("garlic", "en") == [PRODUCT]
    assert harness.context_count == 2


@pytest.mark.asyncio
async def test_explicit_no_results_stops_without_another_attempt(monkeypatch):
    harness = BrowserHarness([Attempt.page_state("no_results")])
    harness.install(monkeypatch)

    assert await weee_scraper.scrape_weee_products("impossible ingredient", "en") == []
    assert harness.context_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["challenge"])
async def test_untrusted_page_states_exhaust_as_typed_failure(monkeypatch, state):
    harness = BrowserHarness([Attempt.page_state(state)] * 3)
    harness.install(monkeypatch)

    with pytest.raises(weee_scraper.StoreScrapeError):
        await weee_scraper.scrape_weee_products("garlic", "en")
    assert harness.context_count == 3
    assert harness.closed_contexts == 3


@pytest.mark.asyncio
async def test_redirected_product_route_is_never_accepted_as_search_results(monkeypatch):
    harness = BrowserHarness([
        Attempt(
            final_url="https://www.sayweee.com/en/product/tofu/1",
            cards=[SEARCH_CARD],
        )
    ] * 3)
    harness.install(monkeypatch, patch_classifier=False)

    with pytest.raises(weee_scraper.StoreScrapeError):
        await weee_scraper.scrape_weee_products("tofu", "en")
    assert harness.context_count == 3


@pytest.mark.asyncio
async def test_http_error_response_exhausts_as_typed_failure(monkeypatch):
    harness = BrowserHarness([Attempt(http_status=503)] * 3)
    harness.install(monkeypatch, patch_classifier=False)

    with pytest.raises(weee_scraper.StoreScrapeError, match="HTTP 503"):
        await weee_scraper.scrape_weee_products("tofu", "en")
    assert harness.context_count == 3
    assert harness.closed_contexts == 3


@pytest.mark.asyncio
async def test_results_with_empty_extraction_exhaust_as_typed_failure(monkeypatch):
    harness = BrowserHarness([Attempt.results([])] * 3)
    harness.install(monkeypatch)

    with pytest.raises(weee_scraper.StoreScrapeError, match="no usable products"):
        await weee_scraper.scrape_weee_products("tofu", "en")
    assert harness.context_count == 3


@pytest.mark.asyncio
async def test_results_with_only_invalid_cards_exhaust_as_typed_failure(monkeypatch):
    invalid_card = {**SEARCH_CARD, "href": "https://sayweee.com.evil.test/product/tofu"}
    harness = BrowserHarness([Attempt.results([invalid_card])] * 3)
    harness.install(monkeypatch)

    with pytest.raises(weee_scraper.StoreScrapeError, match="no usable products"):
        await weee_scraper.scrape_weee_products("tofu", "en")
    assert harness.context_count == 3


@pytest.mark.asyncio
async def test_hung_page_evaluation_exhausts_as_a_typed_timeout(monkeypatch):
    harness = BrowserHarness([Attempt(hang_evaluate=True)] * 3)
    harness.install(monkeypatch, patch_classifier=False)
    monkeypatch.setattr(weee_scraper, "SCRAPER_OPERATION_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(weee_scraper, "SCRAPER_ATTEMPT_TIMEOUT_SECONDS", 0.03)
    monkeypatch.setattr(weee_scraper, "SCRAPER_TOTAL_TIMEOUT_SECONDS", 0.15)

    with pytest.raises(weee_scraper.StoreScrapeError, match="timed out"):
        await asyncio.wait_for(
            weee_scraper.scrape_weee_products("tofu", "en"),
            timeout=0.5,
        )
    assert harness.context_count == 3
    assert harness.closed_contexts == 3


@pytest.mark.asyncio
async def test_cleanup_timeout_does_not_prevent_the_next_attempt(monkeypatch):
    harness = BrowserHarness([
        Attempt(_page_state="pending", hang_page_close=True),
        Attempt.results([SEARCH_CARD]),
    ])
    harness.install(monkeypatch)
    monkeypatch.setattr(weee_scraper, "SCRAPER_CLEANUP_TIMEOUT_SECONDS", 0.01)

    assert await asyncio.wait_for(
        weee_scraper.scrape_weee_products("tofu", "en"),
        timeout=0.5,
    ) == [PRODUCT]
    assert harness.context_count == 2
    assert harness.closed_contexts == 2


@pytest.mark.asyncio
async def test_shared_browser_shutdown_is_idempotent(monkeypatch):
    calls: list[str] = []

    class Browser:
        async def close(self) -> None:
            calls.append("browser")

    class Playwright:
        async def stop(self) -> None:
            calls.append("playwright")

    monkeypatch.setattr(weee_scraper, "_shared_browser", Browser())
    monkeypatch.setattr(weee_scraper, "_playwright_inst", Playwright())

    await weee_scraper.shutdown_weee_scraper()
    await weee_scraper.shutdown_weee_scraper()

    assert calls == ["browser", "playwright"]


@pytest.mark.asyncio
async def test_scraper_shutdown_drains_detached_tasks_after_resource_close_error(monkeypatch):
    events: list[str] = []

    async def fail_close(*args, **kwargs) -> None:
        events.append("close")
        raise RuntimeError("browser close failed")

    async def drain() -> None:
        events.append("drain")

    monkeypatch.setattr(weee_scraper, "_invalidate_shared_browser", fail_close)
    monkeypatch.setattr(weee_scraper, "_drain_detached_tasks", drain)

    with pytest.raises(RuntimeError, match="browser close failed"):
        await weee_scraper.shutdown_weee_scraper()
    assert events == ["close", "drain"]


@pytest.mark.asyncio
async def test_cancellation_resistant_playwright_task_is_tracked_and_drained(monkeypatch):
    cancelled = asyncio.Event()
    release = asyncio.Event()

    async def resistant_operation() -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            while not release.is_set():
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    continue

    monkeypatch.setattr(weee_scraper, "SCRAPER_DETACHED_DRAIN_TIMEOUT_SECONDS", 0.01, raising=False)

    try:
        with pytest.raises(weee_scraper.StoreScrapeError, match="timed out"):
            await weee_scraper._bounded_await(resistant_operation(), 0.01, "resistant operation")
        assert cancelled.is_set()
        assert weee_scraper._detached_tasks

        await weee_scraper.shutdown_weee_scraper()
        assert weee_scraper._detached_tasks
    finally:
        release.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
    assert not weee_scraper._detached_tasks


@pytest.mark.asyncio
async def test_scraper_shutdown_is_bounded_when_a_detached_acquisition_holds_the_lock(
    monkeypatch,
):
    acquired = asyncio.Event()
    cancelled = asyncio.Event()
    release = asyncio.Event()

    async def resistant_acquisition() -> None:
        async with weee_scraper._browser_lock:
            acquired.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                while not release.is_set():
                    try:
                        await release.wait()
                    except asyncio.CancelledError:
                        continue

    monkeypatch.setattr(weee_scraper, "SCRAPER_CLEANUP_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(weee_scraper, "SCRAPER_DETACHED_DRAIN_TIMEOUT_SECONDS", 0.01)
    acquisition = asyncio.create_task(resistant_acquisition())
    weee_scraper._track_detached_task(acquisition)
    await acquired.wait()

    shutdown = asyncio.create_task(weee_scraper.shutdown_weee_scraper())
    try:
        with pytest.raises(weee_scraper.StoreScrapeError, match="resource lock"):
            await asyncio.wait_for(asyncio.shield(shutdown), timeout=0.2)
        assert cancelled.is_set()
        assert not shutdown.cancelled()
    finally:
        acquisition.cancel()
        release.set()
        await asyncio.gather(acquisition, return_exceptions=True)
        if not shutdown.done():
            shutdown.cancel()
        await asyncio.gather(shutdown, return_exceptions=True)


@pytest.mark.asyncio
async def test_total_scraper_budget_explicitly_includes_bounded_cleanup(monkeypatch):
    harness = BrowserHarness([Attempt(_page_state="pending", hang_page_close=True)] * 3)
    harness.install(monkeypatch)
    monkeypatch.setattr(weee_scraper, "SCRAPER_OPERATION_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(weee_scraper, "SCRAPER_ATTEMPT_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(weee_scraper, "SCRAPER_TOTAL_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(weee_scraper, "SCRAPER_CLEANUP_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(weee_scraper, "SCRAPER_TOTAL_CLEANUP_TIMEOUT_SECONDS", 0.02, raising=False)

    with pytest.raises(weee_scraper.StoreScrapeError):
        await asyncio.wait_for(
            weee_scraper.scrape_weee_products("tofu", "en"),
            timeout=0.08,
        )


@pytest.mark.asyncio
async def test_launch_failure_stops_started_playwright(monkeypatch):
    stopped = False

    class Chromium:
        async def launch(self, **kwargs: Any) -> object:
            raise RuntimeError("Chromium launch failed")

    class Playwright:
        chromium = Chromium()

        async def stop(self) -> None:
            nonlocal stopped
            stopped = True

    class Starter:
        async def start(self) -> Playwright:
            return Playwright()

    playwright_module = ModuleType("playwright")
    async_api_module = ModuleType("playwright.async_api")
    async_api_module.async_playwright = Starter  # type: ignore[attr-defined]
    playwright_module.async_api = async_api_module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "playwright", playwright_module)
    monkeypatch.setitem(sys.modules, "playwright.async_api", async_api_module)

    with pytest.raises(RuntimeError, match="Chromium launch failed"):
        await weee_scraper._launch_browser()
    assert stopped


@pytest.mark.asyncio
async def test_disconnected_browser_is_relaunched_before_retry(monkeypatch):
    harness = BrowserHarness([
        Attempt.browser_disconnect(),
        Attempt.results([SEARCH_CARD]),
    ])
    harness.install(monkeypatch)

    assert await weee_scraper.scrape_weee_products("garlic", "en") == [PRODUCT]
    assert harness.browser_launches == 2


@pytest.mark.asyncio
async def test_search_cards_return_three_safe_unique_products_without_pdp_pages(monkeypatch):
    harness = BrowserHarness([Attempt.results(SEARCH_CARDS_WITH_DUPLICATES)])
    harness.install(monkeypatch)

    products = await weee_scraper.scrape_weee_products("tofu", "en")

    assert products == [PRODUCT, FIRM_TOFU, FRIED_TOFU]
    assert harness.page_count == 1


def test_validation_rejects_unsafe_urls_and_keeps_three_unique_products():
    invalid = {**SEARCH_CARD, "href": "https://sayweee.com.evil.test/product/tofu"}

    with pytest.raises(weee_scraper.StoreScrapeError, match="no valid products"):
        weee_scraper.validate_products([
            {"name": "x", "price": "$1", "image": "", "url": invalid["href"]},
        ])

    assert weee_scraper.validate_products([
        PRODUCT,
        {**PRODUCT, "url": PRODUCT["url"] + "?duplicate=true"},
        FIRM_TOFU,
        FRIED_TOFU,
    ]) == [PRODUCT, FIRM_TOFU, FRIED_TOFU]
