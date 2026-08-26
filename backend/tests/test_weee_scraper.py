import asyncio
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

import pytest

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
    final_url: str = "https://www.sayweee.com/en/search?keyword=tofu"
    _page_state: str = "results"
    cards: list[dict[str, str]] = field(default_factory=list)
    disconnect_browser: bool = False

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

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        harness = self

        class Response:
            def __init__(self, status: int):
                self.status = status

        class Page:
            def __init__(self, browser: "Browser", attempt: Attempt):
                self.browser = browser
                self.attempt = attempt
                self.url = attempt.final_url
                self.closed = False

            async def goto(self, *args: Any, **kwargs: Any) -> Response:
                if self.attempt.disconnect_browser:
                    self.browser.connected = False
                if self.attempt.navigation_error is not None:
                    raise self.attempt.navigation_error
                return Response(self.attempt.http_status)

            async def evaluate(self, *args: Any, **kwargs: Any) -> object:
                return None

            async def wait_for_timeout(self, *args: Any, **kwargs: Any) -> None:
                return None

            async def close(self) -> None:
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
        monkeypatch.setattr(weee_scraper, "_classify_search_page", classify)
        monkeypatch.setattr(weee_scraper, "_extract_weee_search_products", extract)
        monkeypatch.setattr(weee_scraper.asyncio, "sleep", no_sleep)
        monkeypatch.setattr(weee_scraper, "_shared_browser", None)
        monkeypatch.setattr(weee_scraper, "_playwright_inst", None)


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
@pytest.mark.parametrize("state", ["challenge", "unexpected_route", "http_error"])
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
    harness.install(monkeypatch)

    with pytest.raises(weee_scraper.StoreScrapeError):
        await weee_scraper.scrape_weee_products("tofu", "en")
    assert harness.context_count == 3


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
