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

        async def classify(page: Page, expected_query: str = "") -> str:
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
async def test_real_dom_footer_empty_marker_is_not_authoritative(real_browser_page):
    await real_browser_page.set_content(
        """
        <main><h1>Search</h1></main>
        <footer><div data-testid="no-results">No matching footer links</div></footer>
        """
    )

    assert await weee_scraper._classify_search_page(real_browser_page, "rice") == "pending"


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
async def test_real_dom_outer_results_bind_each_anchor_to_its_nearest_leaf_card(
    real_browser_page,
):
    await real_browser_page.set_content(
        """
        <main class="search-results">
          <article data-testid="wid-product-card-container">
            <h3>Premium Rice</h3><span>$15.99</span><span>$1.07/lb</span>
            <div class="product-card-image">
              <a href="https://www.sayweee.com/en/product/rice/1">
                <img alt="weee_dried_rice_10_lb_front_1200x1200" />
              </a>
            </div>
          </article>
          <article data-testid="wid-product-card-container">
            <h3>Jasmine Tea</h3><span>$154.99</span><span>$17.61/lb</span>
            <div class="product-card-image">
              <a href="https://www.sayweee.com/en/product/tea/1">
                <img alt="weee_dried_tea_front_1200x1200" />
              </a>
            </div>
          </article>
        </main>
        """
    )

    assert await weee_scraper._classify_search_page(real_browser_page, "rice") == "results"
    raw = await weee_scraper._extract_weee_search_products(real_browser_page, "en")
    products = [weee_scraper._normalize_weee_product(row) for row in raw]
    assert products == [
        {
            "name": "Premium Rice",
            "price": "$15.99",
            "image": "",
            "url": "https://www.sayweee.com/en/product/rice/1",
        },
        {
            "name": "Jasmine Tea",
            "price": "$154.99",
            "image": "",
            "url": "https://www.sayweee.com/en/product/tea/1",
        },
    ]


@pytest.mark.asyncio
async def test_real_dom_current_exact_empty_ignores_nested_recommendation(
    real_browser_page,
):
    await real_browser_page.set_content(
        """
        <main class="search-results">
          <li class="max-w-[380px] enki-heading-xl text-surface-100-fg-default break-words">
            Sorry, no results were found for "dragon fruit"
          </li>
          <section class="recommendation-carousel">
            <article data-testid="wid-product-card-container">
              <a href="https://www.sayweee.com/en/product/recommended/1">
                <h3>Recommended tofu</h3><span>$2.99</span>
              </a>
            </article>
          </section>
        </main>
        """
    )

    assert (
        await weee_scraper._classify_search_page(real_browser_page, "dragon fruit")
        == "no_results"
    )
    assert await weee_scraper._extract_weee_search_products(real_browser_page, "en") == []
    assert await weee_scraper._classify_search_page(real_browser_page, "mango") == "pending"


def test_product_normalization_prefers_card_title_and_primary_purchase_price():
    assert weee_scraper._normalize_weee_product(
        {
            "href": "https://www.sayweee.com/en/product/rice/1",
            "name": "weee_dried_rice_10_lb_front_1200x1200",
            "image_alt": "weee_dried_rice_10_lb_front_1200x1200",
            "primary_title": "Premium Rice 10 lb",
            "title_hint": "Premium Rice 10 lb",
            "text": "Premium Rice 10 lb $15.99 $1.07/lb",
        }
    ) == {
        "name": "Premium Rice 10 lb",
        "price": "$15.99",
        "image": "",
        "url": "https://www.sayweee.com/en/product/rice/1",
    }
    assert weee_scraper._extract_price("Jasmine Tea $154.99 $17.61/lb") == "$154.99"

    assert weee_scraper._normalize_weee_product(
        {
            "href": "https://www.sayweee.com/en/product/rice/1",
            "name": "weee_dried_rice_10_lb_front_1200x1200",
            "image_alt": "weee_dried_rice_10_lb_front_1200x1200",
            "text": "",
        }
    ) == {
        "name": "rice 10 lb",
        "price": "",
        "image": "",
        "url": "https://www.sayweee.com/en/product/rice/1",
    }


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
async def test_failed_child_cleanup_and_browser_retirement_fence_the_next_launch(
    monkeypatch,
):
    allow_retirement = False
    browsers: list[Any] = []
    peak_connected = 0

    class Response:
        status = 200

    class Page:
        def __init__(self, browser: "Browser"):
            self.browser = browser
            self.url = "about:blank"
            self.closed = False

        async def goto(self, url: str, **kwargs: Any) -> Response:
            self.url = url
            return Response()

        async def close(self) -> None:
            if self.browser.number == 1 and not allow_retirement:
                raise RuntimeError("page close failed")
            self.closed = True

    class Context:
        def __init__(self, browser: "Browser"):
            self.browser = browser
            self.page: Page | None = None

        async def new_page(self) -> Page:
            self.page = Page(self.browser)
            self.browser.pages.append(self.page)
            return self.page

        async def close(self) -> None:
            return None

    class Browser:
        def __init__(self, number: int):
            self.number = number
            self.connected = True
            self.close_calls = 0
            self.pages: list[Page] = []

        def is_connected(self) -> bool:
            return self.connected

        async def new_context(self, **kwargs: Any) -> Context:
            return Context(self)

        async def close(self) -> None:
            self.close_calls += 1
            if self.number == 1 and not allow_retirement:
                raise RuntimeError("browser close failed while still connected")
            self.connected = False
            for page in self.pages:
                page.closed = True

    class Playwright:
        def __init__(self):
            self.stop_calls = 0

        async def stop(self) -> None:
            self.stop_calls += 1

    async def launch_browser() -> tuple[Playwright, Browser]:
        nonlocal peak_connected
        browser = Browser(len(browsers) + 1)
        browsers.append(browser)
        peak_connected = max(
            peak_connected,
            sum(candidate.is_connected() for candidate in browsers),
        )
        return Playwright(), browser

    async def outcome(page: Page, expected_query: str) -> str:
        return "pending" if page.browser.number == 1 else "results"

    async def extract(page: Page, language: str) -> list[dict[str, str]]:
        return [SEARCH_CARD]

    monkeypatch.setattr(weee_scraper, "_launch_browser", launch_browser)
    monkeypatch.setattr(weee_scraper, "_wait_for_search_outcome", outcome)
    monkeypatch.setattr(weee_scraper, "_extract_weee_search_products", extract)
    monkeypatch.setattr(weee_scraper, "WEEE_MAX_ATTEMPTS", 2)
    monkeypatch.setattr(weee_scraper.random, "uniform", lambda *args: -1.0)
    monkeypatch.setattr(weee_scraper, "_shared_browser", None)
    monkeypatch.setattr(weee_scraper, "_playwright_inst", None)

    try:
        with pytest.raises(weee_scraper.StoreScrapeError):
            await weee_scraper.scrape_weee_products("tofu", "en")
        assert len(browsers) == 1
        assert peak_connected == 1
        assert browsers[0].is_connected()

        allow_retirement = True
        assert await weee_scraper.scrape_weee_products("tofu", "en") == [PRODUCT]
        assert len(browsers) == 2
        assert peak_connected == 1
        assert not browsers[0].is_connected()

        await weee_scraper.shutdown_weee_scraper()
        await weee_scraper.shutdown_weee_scraper()
        assert not browsers[1].is_connected()
        assert browsers[1].close_calls == 1
    finally:
        allow_retirement = True
        try:
            await weee_scraper.shutdown_weee_scraper()
        except BaseException:
            pass
        for browser in browsers:
            if browser.is_connected():
                await browser.close()


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
async def test_scrape_does_not_retry_until_a_timed_out_child_reaches_quiescence(monkeypatch):
    child_cancelled = asyncio.Event()
    release_child = asyncio.Event()
    attempts = 0

    async def resistant_child() -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            child_cancelled.set()
            await release_child.wait()

    async def scrape_once(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            await weee_scraper._bounded_await(
                resistant_child(), 0.01, "resistant evaluation"
            )
        return [PRODUCT]

    monkeypatch.setattr(weee_scraper, "_scrape_once", scrape_once)
    monkeypatch.setattr(weee_scraper, "WEEE_MAX_ATTEMPTS", 2)
    monkeypatch.setattr(weee_scraper.random, "uniform", lambda *args: -0.4)

    scrape = asyncio.create_task(weee_scraper.scrape_weee_products("rice", "en"))
    await child_cancelled.wait()
    try:
        await asyncio.sleep(0.02)
        assert attempts == 1
        assert not scrape.done()
    finally:
        release_child.set()
    assert await scrape == [PRODUCT]
    assert attempts == 2


@pytest.mark.asyncio
async def test_scrape_cancellation_waits_for_resistant_nested_operation(monkeypatch):
    child_started = asyncio.Event()
    child_cancelled = asyncio.Event()
    release_child = asyncio.Event()

    async def resistant_child() -> None:
        child_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            child_cancelled.set()
            await release_child.wait()

    async def scrape_once(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        await weee_scraper._bounded_await(resistant_child(), 10.0, "evaluation")
        return [PRODUCT]

    monkeypatch.setattr(weee_scraper, "_scrape_once", scrape_once)
    scrape = asyncio.create_task(weee_scraper.scrape_weee_products("rice", "en"))
    await child_started.wait()
    scrape.cancel()
    await child_cancelled.wait()
    try:
        await asyncio.sleep(0)
        assert not scrape.done()
    finally:
        release_child.set()
    with pytest.raises(asyncio.CancelledError):
        await scrape


@pytest.mark.asyncio
async def test_late_context_acquisition_is_closed_after_timeout(monkeypatch):
    cancelled = asyncio.Event()
    release = asyncio.Event()
    closed = asyncio.Event()

    class Context:
        async def close(self) -> None:
            closed.set()

    async def acquire() -> Context:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            await release.wait()
        return Context()

    with pytest.raises(weee_scraper.StoreScrapeError, match="timed out"):
        await weee_scraper._bounded_call(
            acquire,
            deadline=weee_scraper.time.monotonic() + 0.01,
            label="context acquisition",
            late_result_cleanup=lambda context: context.close(),
        )
    await cancelled.wait()
    release.set()
    await asyncio.wait_for(closed.wait(), timeout=0.05)


@pytest.mark.asyncio
async def test_late_context_cleanup_failure_retires_its_browser_before_quiescence(
    monkeypatch,
):
    acquisition_cancelled = asyncio.Event()
    release_acquisition = asyncio.Event()
    context_close_attempted = asyncio.Event()
    closed: list[str] = []

    class Context:
        async def close(self) -> None:
            context_close_attempted.set()
            raise RuntimeError("late context close failed")

    class Browser:
        connected = True

        def is_connected(self) -> bool:
            return self.connected

        async def new_context(self, **kwargs: Any) -> Context:
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                acquisition_cancelled.set()
                await release_acquisition.wait()
            return Context()

        async def close(self) -> None:
            self.connected = False
            closed.append("browser")

    class Playwright:
        async def stop(self) -> None:
            closed.append("playwright")

    browser = Browser()
    playwright = Playwright()

    async def get_browser() -> Browser:
        return browser

    monkeypatch.setattr(weee_scraper, "_ensure_shared_browser", get_browser)
    monkeypatch.setattr(weee_scraper, "_shared_browser", browser)
    monkeypatch.setattr(weee_scraper, "_playwright_inst", playwright)
    monkeypatch.setattr(weee_scraper, "SCRAPER_OPERATION_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(weee_scraper, "SCRAPER_CLEANUP_TIMEOUT_SECONDS", 0.05)

    try:
        with pytest.raises(weee_scraper.StoreScrapeError, match="timed out"):
            await weee_scraper._scrape_once(
                "tofu",
                "en",
                1,
                weee_scraper.time.monotonic() + 0.01,
                weee_scraper.time.monotonic() + 0.2,
            )
        await acquisition_cancelled.wait()
        release_acquisition.set()
        await context_close_attempted.wait()

        with pytest.raises(weee_scraper.StoreScrapeError, match="late.*cleanup"):
            await weee_scraper.wait_for_scraper_quiescence()

        assert closed == ["browser", "playwright"]
        assert weee_scraper._shared_browser is None
        assert weee_scraper._playwright_inst is None
        assert not weee_scraper._detached_tasks
    finally:
        release_acquisition.set()
        remaining = list(weee_scraper._detached_tasks)
        for task in remaining:
            task.cancel()
        await asyncio.gather(*remaining, return_exceptions=True)
        weee_scraper._detached_tasks.clear()
        weee_scraper._detached_late_cleanups.clear()
        weee_scraper._detached_cleanup_tasks.clear()
        weee_scraper._detached_cleanup_failures.clear()
        if browser.connected:
            await browser.close()
        if weee_scraper._playwright_inst is playwright:
            await playwright.stop()


@pytest.mark.asyncio
async def test_quiescence_rechecks_done_callbacks_for_late_resource_cleanup():
    closed = asyncio.Event()

    class Context:
        async def close(self) -> None:
            closed.set()

    async def acquire() -> Context:
        return Context()

    task = asyncio.create_task(acquire())
    weee_scraper._track_detached_task(
        task,
        late_result_cleanup=lambda context: context.close(),
    )
    await asyncio.sleep(0)
    assert task.done()

    await weee_scraper.wait_for_scraper_quiescence()

    assert closed.is_set()
    assert not weee_scraper._detached_tasks


@pytest.mark.asyncio
async def test_quiescence_propagates_its_callers_cancellation_after_physical_release():
    child_started = asyncio.Event()
    child_cancelled = asyncio.Event()
    release_child = asyncio.Event()

    async def resistant_child() -> None:
        child_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            child_cancelled.set()
            await release_child.wait()

    child = asyncio.create_task(resistant_child())
    weee_scraper._track_detached_task(child)
    await child_started.wait()
    quiescence = asyncio.create_task(weee_scraper.wait_for_scraper_quiescence())
    await asyncio.sleep(0)
    quiescence.cancel()
    await asyncio.sleep(0)

    try:
        assert not quiescence.done()
    finally:
        child.cancel()
        await child_cancelled.wait()
        release_child.set()

    with pytest.raises(asyncio.CancelledError):
        await quiescence


@pytest.mark.asyncio
async def test_shutdown_drain_allows_owned_cleanup_to_finish_before_cancelling():
    completed = asyncio.Event()

    async def cleanup() -> None:
        await asyncio.sleep(0)
        completed.set()

    task = asyncio.create_task(cleanup())
    weee_scraper._track_detached_task(task, cleanup_task=True)

    await weee_scraper._drain_detached_tasks()

    assert completed.is_set()
    assert not weee_scraper._detached_tasks


@pytest.mark.asyncio
async def test_detached_drain_reaches_fixed_point_for_nested_tasks(monkeypatch):
    nested_cancelled = asyncio.Event()

    async def nested() -> None:
        try:
            await asyncio.Event().wait()
        finally:
            nested_cancelled.set()

    async def parent() -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            weee_scraper._track_detached_task(asyncio.create_task(nested()))

    task = asyncio.create_task(parent())
    weee_scraper._track_detached_task(task)
    await asyncio.sleep(0)
    try:
        await weee_scraper._drain_detached_tasks()
        assert nested_cancelled.is_set()
        assert not weee_scraper._detached_tasks
    finally:
        remaining = list(weee_scraper._detached_tasks)
        for pending in remaining:
            pending.cancel()
        await asyncio.gather(*remaining, return_exceptions=True)
        weee_scraper._detached_tasks.clear()


@pytest.mark.asyncio
async def test_shutdown_generation_fences_a_late_browser_launch(monkeypatch):
    launch_started = asyncio.Event()
    release_launch = asyncio.Event()
    closed: list[str] = []

    class Browser:
        def is_connected(self) -> bool:
            return True

        async def close(self) -> None:
            closed.append("browser")

    class Playwright:
        async def stop(self) -> None:
            closed.append("playwright")

    async def launch() -> tuple[Playwright, Browser]:
        launch_started.set()
        await release_launch.wait()
        return Playwright(), Browser()

    monkeypatch.setattr(weee_scraper, "_launch_browser", launch)
    monkeypatch.setattr(weee_scraper, "_shared_browser", None)
    monkeypatch.setattr(weee_scraper, "_playwright_inst", None)
    monkeypatch.setattr(weee_scraper, "SCRAPER_CLEANUP_TIMEOUT_SECONDS", 0.01)

    acquisition = asyncio.create_task(weee_scraper._ensure_shared_browser())
    await launch_started.wait()
    try:
        shutdown_error: BaseException | None = None
        try:
            await weee_scraper.shutdown_weee_scraper()
        except BaseException as exc:
            shutdown_error = exc
    finally:
        release_launch.set()
    if shutdown_error is not None:
        await asyncio.gather(acquisition, return_exceptions=True)
        raise shutdown_error
    with pytest.raises(weee_scraper.StoreScrapeError, match="invalidated"):
        await acquisition
    assert weee_scraper._shared_browser is None
    assert weee_scraper._playwright_inst is None
    assert closed == ["browser", "playwright"]


@pytest.mark.asyncio
async def test_browser_cleanup_attempts_playwright_after_caller_cancellation():
    browser_started = asyncio.Event()
    playwright_stopped = asyncio.Event()

    class Browser:
        async def close(self) -> None:
            browser_started.set()
            await asyncio.Event().wait()

    class Playwright:
        async def stop(self) -> None:
            playwright_stopped.set()

    cleanup = asyncio.create_task(
        weee_scraper._close_browser_resources(Browser(), Playwright())
    )
    await browser_started.wait()
    cleanup.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cleanup
    assert playwright_stopped.is_set()


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
async def test_launch_and_startup_stop_failure_retains_playwright_and_fences_relaunch(
    monkeypatch,
):
    allow_first_stop = False
    playwrights: list[Any] = []

    class Browser:
        def __init__(self):
            self.connected = True
            self.close_calls = 0

        def is_connected(self) -> bool:
            return self.connected

        async def close(self) -> None:
            self.close_calls += 1
            self.connected = False

    class Chromium:
        def __init__(self, owner: "Playwright"):
            self.owner = owner

        async def launch(self, **kwargs: Any) -> Browser:
            if self.owner.number == 1:
                raise RuntimeError("Chromium launch failed")
            return Browser()

    class Playwright:
        def __init__(self, number: int):
            self.number = number
            self.chromium = Chromium(self)
            self.stop_calls = 0
            self.stopped = False

        async def stop(self) -> None:
            self.stop_calls += 1
            if self.number == 1 and not allow_first_stop:
                raise RuntimeError("Playwright stop failed")
            self.stopped = True

    class Starter:
        async def start(self) -> Playwright:
            playwright = Playwright(len(playwrights) + 1)
            playwrights.append(playwright)
            return playwright

    playwright_module = ModuleType("playwright")
    async_api_module = ModuleType("playwright.async_api")
    async_api_module.async_playwright = Starter  # type: ignore[attr-defined]
    playwright_module.async_api = async_api_module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "playwright", playwright_module)
    monkeypatch.setitem(sys.modules, "playwright.async_api", async_api_module)
    monkeypatch.setattr(weee_scraper, "_shared_browser", None)
    monkeypatch.setattr(weee_scraper, "_playwright_inst", None)
    monkeypatch.setattr(weee_scraper, "_retired_browser_resources", {})

    try:
        with pytest.raises(Exception) as first_error:
            await weee_scraper._ensure_shared_browser()
        with pytest.raises(weee_scraper.StoreScrapeError, match="temporarily unavailable"):
            await weee_scraper._ensure_shared_browser()
        assert isinstance(first_error.value, weee_scraper.StoreScrapeError)
        assert len(playwrights) == 1

        allow_first_stop = True
        recovered_browser = await weee_scraper._ensure_shared_browser()
        assert len(playwrights) == 2
        assert playwrights[0].stop_calls >= 3
        assert recovered_browser.is_connected()

        await weee_scraper.shutdown_weee_scraper()
        await weee_scraper.shutdown_weee_scraper()
        assert not recovered_browser.is_connected()
        assert recovered_browser.close_calls == 1
        assert playwrights[1].stop_calls == 1
        assert not weee_scraper._retired_browser_resources
    finally:
        allow_first_stop = True
        try:
            await weee_scraper.shutdown_weee_scraper()
        except BaseException:
            pass
        if playwrights and not playwrights[0].stopped:
            await playwrights[0].stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("termination", ["timeout", "caller-cancel"])
async def test_failed_launch_retains_playwright_during_resistant_startup_stop(
    monkeypatch,
    termination: str,
):
    stop_started = asyncio.Event()
    stop_cancelled = asyncio.Event()
    release_stop = asyncio.Event()
    playwrights: list[Any] = []

    class Browser:
        def __init__(self):
            self.connected = True

        def is_connected(self) -> bool:
            return self.connected

        async def close(self) -> None:
            self.connected = False

    class Chromium:
        def __init__(self, owner: "Playwright"):
            self.owner = owner

        async def launch(self, **kwargs: Any) -> Browser:
            if self.owner.number == 1:
                raise RuntimeError("Chromium launch failed")
            return Browser()

    class Playwright:
        def __init__(self, number: int):
            self.number = number
            self.chromium = Chromium(self)
            self.stop_calls = 0

        async def stop(self) -> None:
            self.stop_calls += 1
            if self.number != 1 or release_stop.is_set():
                return
            stop_started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                stop_cancelled.set()
                await release_stop.wait()

    class Starter:
        async def start(self) -> Playwright:
            playwright = Playwright(len(playwrights) + 1)
            playwrights.append(playwright)
            return playwright

    playwright_module = ModuleType("playwright")
    async_api_module = ModuleType("playwright.async_api")
    async_api_module.async_playwright = Starter  # type: ignore[attr-defined]
    playwright_module.async_api = async_api_module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "playwright", playwright_module)
    monkeypatch.setitem(sys.modules, "playwright.async_api", async_api_module)
    monkeypatch.setattr(weee_scraper, "_shared_browser", None)
    monkeypatch.setattr(weee_scraper, "_playwright_inst", None)
    monkeypatch.setattr(weee_scraper, "_retired_browser_resources", {})
    monkeypatch.setattr(
        weee_scraper,
        "SCRAPER_CLEANUP_TIMEOUT_SECONDS",
        0.01 if termination == "timeout" else 1.0,
    )

    acquisition = asyncio.create_task(weee_scraper._ensure_shared_browser())
    await stop_started.wait()
    if termination == "caller-cancel":
        acquisition.cancel()
    try:
        if termination == "caller-cancel":
            with pytest.raises(asyncio.CancelledError):
                await acquisition
        else:
            with pytest.raises(weee_scraper.StoreScrapeError):
                await acquisition
        await stop_cancelled.wait()
        assert len(playwrights) == 1
        assert weee_scraper._retired_browser_resources

        release_stop.set()
        await weee_scraper.wait_for_scraper_quiescence()
        assert not weee_scraper._retired_browser_resources

        recovered_browser = await weee_scraper._ensure_shared_browser()
        assert len(playwrights) == 2
        assert recovered_browser.is_connected()
        await weee_scraper.shutdown_weee_scraper()
        assert not recovered_browser.is_connected()
    finally:
        release_stop.set()
        await asyncio.gather(acquisition, return_exceptions=True)
        try:
            await weee_scraper.shutdown_weee_scraper()
        except BaseException:
            pass


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
