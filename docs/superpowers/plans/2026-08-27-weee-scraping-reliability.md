# Weee Scraping Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make single and bulk shopping-list Weee product loading reliable, strictly fresh for less than 24 hours, and resource-safe without limiting shopping-list length.

**Architecture:** One browser context and one search page implement the live lookup primitive, with explicit page-state classification and up to three internal attempts. A cache/service layer performs mechanical query identity, strict L1/L2 freshness, keyed single-flight, and a one-worker interactive-first live queue; clients obtain all cache hits through one cache-only batch request and send misses through one serial GET queue.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy async, Playwright async, pytest/pytest-asyncio, TypeScript, React 18/Next.js 14, React Native/Expo, Vitest, Jest.

**Spec:** `docs/superpowers/specs/2026-08-27-weee-scraping-reliability-design.md`

## Global Constraints

- Cache entries are displayable only while `now - updated_at < 86_400 seconds`; an entry exactly 24 hours old is expired and no stale fallback is allowed.
- Query preparation only trims outer whitespace, collapses internal whitespace, case-folds cache/single-flight identity, and detects CJK for route selection. It must not remove quantities, descriptors, preparation words, or modifiers.
- There is no business-level ingredient-count cap; request/infrastructure size protections remain in force.
- A live attempt uses one context and one search page and opens no product-detail pages.
- One logical lookup performs at most three internal attempts, uses a fresh context per attempt, and returns `[]` only for an explicit Weee no-results state.
- Exactly one live scrape runs per backend process. Interactive work is selected before the warmer's next queued item; an already-running warmer item may finish.
- Positive products are committed to PostgreSQL before L1 publication or waiter resolution. Empty results and failures are never persisted as 24-hour entries.
- `POST /store-products/batch` is cache-only, preserves cleaned unique query order, and never invokes Playwright.
- Web and mobile use one live-GET worker for manual, expiry, hydration-miss, retry, and bulk-miss work. Cache-only batch requests may run independently.
- Existing `GET /store-products` and explicit legacy `store=weee` response compatibility remain intact.
- Keep unrelated untracked workspace files untouched: `backend/.venv_fresh/`, `backend/pytest 2.ini`, and `backups/`.

---

### Task 1: Reliable One-Page Weee Scraper

**Files:**
- Create: `backend/app/services/weee_scraper.py`
- Create: `backend/tests/test_weee_scraper.py`
- Read/move from: `backend/app/services/store_scraper.py:55-570`

**Interfaces:**
- Consumes: a mechanically cleaned `query_text` and `language: Literal["en", "zh"]` from Task 2.
- Produces: `StoreScrapeError`, `scrape_weee_products(query_text, language) -> list[dict[str, str]]`, and `validate_products(raw_products) -> list[dict[str, str]]`.
- Contract: a returned empty list means only a confirmed no-results page; every ambiguous/blocked/unready state raises `StoreScrapeError` after bounded retries.

- [ ] **Step 1: Write the failing attempt-recovery and page-classification tests**

Create `backend/tests/test_weee_scraper.py` with controlled browser/context/page doubles that expose `goto`, `url`, `evaluate`, `wait_for_timeout`, `close`, `new_page`, `new_context`, and `is_connected`. Add these observable tests:

Define `PRODUCT`, `FIRM_TOFU`, `FRIED_TOFU`, `SEARCH_CARD`, and `SEARCH_CARDS_WITH_DUPLICATES` as literal dictionaries in the test file. Define `Attempt` as a frozen dataclass carrying `navigation_error`, `http_status`, `final_url`, `page_state`, `cards`, and `disconnect_browser`, with the named constructors used below. Define `BrowserHarness.install()` to patch the Playwright launch boundary, `_classify_search_page`, `_extract_weee_search_products`, and `asyncio.sleep`; its browser/context/page doubles increment `browser_launches`, `context_count`, `page_count`, `closed_contexts`, and `max_open_pages`. This keeps the retry/resource lifecycle real while replacing only Playwright and elapsed waiting.

```python
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
```

The test harness must derive expected products from literal fixtures, patch only the external Playwright/browser boundary and retry sleep, and assert page/context lifecycle rather than mock call existence.

- [ ] **Step 2: Run the new tests and verify the missing module/behavior fails**

Run:

```bash
cd backend
.venv_fresh/bin/python -m pytest -q tests/test_weee_scraper.py
```

Expected: FAIL because `app.services.weee_scraper` and the classified retry contract do not exist.

- [ ] **Step 3: Move pure extraction/validation helpers and implement classified attempts**

Move the existing URL/name/image/search-card normalization helpers into `weee_scraper.py`, delete the PDP candidate budget/enrichment functions from the new module, and expose this public surface:

```python
from typing import Any, Literal

Language = Literal["en", "zh"]
PageOutcome = Literal["results", "no_results", "challenge", "pending"]
MAX_RESULTS = 3
WEEE_MAX_ATTEMPTS = 3
PLAYWRIGHT_TIMEOUT_MS = 15_000


class StoreScrapeError(RuntimeError):
    """Weee did not produce a trustworthy result."""


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


async def scrape_weee_products(
    query_text: str,
    language: Language,
) -> list[dict[str, str]]:
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
```

Implement `_scrape_once` so it:

1. obtains a connected shared browser, relaunching under `_browser_lock` when absent/disconnected;
2. creates one context and one page;
3. calls `page.goto(search_url, wait_until="domcontentloaded", timeout=15_000)` and rejects response status `>= 400`;
4. waits until a browser-evaluated state becomes `results`, `no_results`, or `challenge`;
5. returns `[]` only for `no_results`, extracts and validates cards for `results`, and raises for every other outcome; and
6. closes the page and context in `finally`.

When an attempt observes a disconnected browser or Playwright target/context closure, invalidate and close the shared browser under `_browser_lock` and stop its Playwright instance; the next attempt must launch a new shared browser. Ordinary classified page failures use a fresh context without needlessly relaunching Chromium.

The page-state JavaScript must classify visible product anchors first, then explicit visible no-result selectors/text (`no results`, `no products found`, `没有找到`, `暂无商品`), then challenge/access-denied text (`captcha`, `verify you are human`, `access denied`, `unusual traffic`, `安全验证`); an absent product and absent explicit no-results signal remains `pending` until timeout and then raises.

Retain structured `extra` fields and put the same fields in the formatted message:

```python
logger.info(
    "weee_scrape attempt query=%r language=%s attempt=%s outcome=%s error_type=%s",
    query_text,
    language,
    attempt_number,
    outcome,
    type(error).__name__ if error else "none",
    extra={"event": "weee_scrape_attempt", "query": query_text, "attempt": attempt_number},
)
```

- [ ] **Step 4: Run the focused scraper tests and existing URL safety tests**

Run:

```bash
cd backend
.venv_fresh/bin/python -m pytest -q tests/test_weee_scraper.py tests/test_store_cache.py -k 'weee or validation or unsafe or extraction'
```

Expected: PASS; every attempt closes its resources, no PDP page is opened, and ambiguous empty DOM is not returned as a genuine empty result.

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/app/services/weee_scraper.py backend/tests/test_weee_scraper.py
git commit -m "fix: make Weee scraping self-recovering"
```

---

### Task 2: Strict Cache Service, Single-Flight Priority Queue, and Batch Repository Read

**Files:**
- Create: `backend/app/services/store_product_service.py`
- Create: `backend/tests/test_store_product_service.py`
- Modify: `backend/app/db/repo_store_cache.py`
- Modify: `backend/tests/conftest.py`
- Read/move from: `backend/app/services/store_scraper.py:240-741`

**Interfaces:**
- Consumes: `weee_scraper.scrape_weee_products` and `weee_scraper.validate_products` from Task 1.
- Produces: `prepare_store_query`, `fetch_store_products_with_metadata`, `fetch_store_products`, `fetch_cached_store_products_batch`, `StoreProductsResult`, and `BatchStoreProductsEntry`.
- Produces repository interface `get_cached_store_products_batch(session, keys, store, cache_version, max_age_seconds)`.

- [ ] **Step 1: Write failing tests for mechanical identity and strict freshness**

Create `backend/tests/test_store_product_service.py` and move the cache/service behavior tests from `test_store_cache.py` to target the new service module. Add these regression assertions:

Define these test-local helpers before the tests so every referenced value is explicit:

```python
async def async_none(*args: Any, **kwargs: Any) -> None:
    return None


async def async_noop(*args: Any, **kwargs: Any) -> None:
    return None


async def async_typed_failure(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
    raise weee_scraper.StoreScrapeError("controlled upstream failure")


def async_return(value: Any):
    async def result(*args: Any, **kwargs: Any) -> Any:
        return value
    return result


def product_for(query: str) -> dict[str, str]:
    slug = quote_plus(query.casefold())
    return {"name": query, "price": "$1.00", "image": "", "url": f"https://www.weee.com/en/product/{slug}/1"}


async def wait_until(predicate: Callable[[], bool]) -> None:
    for _ in range(100):
        if predicate():
            return
        await asyncio.sleep(0)
    raise AssertionError("condition did not become true")


def cached(products: list[dict[str, str]]) -> repo_store_cache.CachedStoreProducts:
    return repo_store_cache.CachedStoreProducts(products, datetime(2026, 8, 27, tzinfo=timezone.utc))
```

Define `GARLIC`, `GINGER`, `STALE_PRODUCT`, and every expected product as literal dictionaries rather than constructing expectations through production helpers.

```python
def test_prepare_store_query_only_performs_mechanical_cleanup():
    assert service.prepare_store_query("  Two   cloves Garlic  ") == service.PreparedStoreQuery(
        query_text="Two cloves Garlic",
        cache_query="two cloves garlic",
        language="en",
    )
    assert service.prepare_store_query("新鲜  大蒜") == service.PreparedStoreQuery(
        query_text="新鲜 大蒜",
        cache_query="新鲜 大蒜",
        language="zh",
    )


@pytest.mark.asyncio
async def test_expired_refresh_failure_never_returns_stale_products(monkeypatch):
    service.CACHE[("weee", "en", service.CACHE_VERSION, "garlic")] = {
        "data": [STALE_PRODUCT],
        "timestamp": 0,
    }
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_with_metadata", async_none)
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", async_typed_failure)

    with pytest.raises(weee_scraper.StoreScrapeError):
        await service.fetch_store_products("garlic", session=object())
```

Retain the existing literal boundary tests showing `86_399` seconds is fresh and `86_400` seconds is expired.

- [ ] **Step 2: Write failing tests for one live worker, keyed joining, and interactive priority**

Use events around the real service coordinator and patch only `weee_scraper.scrape_weee_products` plus positive persistence:

```python
@pytest.mark.asyncio
async def test_distinct_misses_never_run_more_than_one_live_scrape(monkeypatch):
    active = 0
    peak = 0

    async def scrape(query_text, language):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        return [product_for(query_text)]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    await asyncio.gather(*[
        service.fetch_store_products(f"ingredient {index}", force_refresh=True)
        for index in range(8)
    ])

    assert peak == 1


@pytest.mark.asyncio
async def test_interactive_job_precedes_next_background_job(monkeypatch):
    started = []
    first_release = asyncio.Event()

    async def scrape(query_text, language):
        started.append(query_text)
        if query_text == "warm one":
            await first_release.wait()
        return [product_for(query_text)]

    monkeypatch.setattr(weee_scraper, "scrape_weee_products", scrape)
    monkeypatch.setattr(service, "_persist_positive_result", async_noop)
    first = asyncio.create_task(service.fetch_store_products("warm one", force_refresh=True, priority="background"))
    await wait_until(lambda: started == ["warm one"])
    second = asyncio.create_task(service.fetch_store_products("warm two", force_refresh=True, priority="background"))
    user = asyncio.create_task(service.fetch_store_products("garlic", force_refresh=True, priority="interactive"))
    first_release.set()
    await asyncio.gather(first, second, user)

    assert started == ["warm one", "garlic", "warm two"]
```

Retain existing tests for normalized duplicate joining, cancellation shielding, failed-flight cleanup, and commit-before-publication against the new module.

Add the deterministic production-like probe before implementation: submit 20 distinct interactive misses plus two background jobs to the real service coordinator, hold each patched scrape for one event-loop turn, and concurrently call a FastAPI app containing the existing `/health` handler through `httpx.AsyncClient` with `ASGITransport`. Assert every health response is `200`, all lookups finish, and the shared active-scrape counter peaks at one. The test name is `test_cold_cache_health_probe_keeps_one_live_scrape_and_health_responsive`.

- [ ] **Step 3: Write failing repository/service batch tests**

Add literal ordered inputs with casing/whitespace aliases and 75 distinct ingredients:

```python
@pytest.mark.asyncio
async def test_batch_cache_read_preserves_order_dedupes_and_never_scrapes(monkeypatch):
    rows = {("garlic", "en"): cached([GARLIC]), ("姜", "zh"): cached([GINGER])}
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_batch", async_return(rows))
    monkeypatch.setattr(weee_scraper, "scrape_weee_products", unexpected_scrape)

    result = await service.fetch_cached_store_products_batch(
        [" Garlic ", "garlic", "姜", "missing"],
        session=object(),
    )

    assert [(entry.query, entry.status) for entry in result] == [
        ("Garlic", "fresh"),
        ("姜", "fresh"),
        ("missing", "missing"),
    ]


@pytest.mark.asyncio
async def test_batch_cache_read_accepts_more_than_fifty_queries(monkeypatch):
    queries = [f"ingredient {index}" for index in range(75)]
    monkeypatch.setattr(repo_store_cache, "get_cached_store_products_batch", async_return({}))

    result = await service.fetch_cached_store_products_batch(queries, session=object())

    assert [entry.query for entry in result] == queries
    assert all(entry.status == "missing" for entry in result)
```

Repository tests must assert one `session.execute` call for a normal batch and Python-side strict expiry filtering at the exact boundary.

- [ ] **Step 4: Run the service tests and verify the new interfaces fail**

Run:

```bash
cd backend
.venv_fresh/bin/python -m pytest -q tests/test_store_product_service.py
```

Expected: FAIL because the new service, batch repository method, and one-worker priority behavior do not exist.

- [ ] **Step 5: Implement the service and repository batch read**

Use these exact data contracts:

```python
StoreName = Literal["weee"]
Language = Literal["en", "zh"]
LookupPriority = Literal["interactive", "background"]
CacheKey = tuple[StoreName, Language, str, str]
CACHE_TTL_SECONDS = 86_400
CACHE_VERSION = "v7"


@dataclass(frozen=True)
class PreparedStoreQuery:
    query_text: str
    cache_query: str
    language: Language


@dataclass(frozen=True)
class StoreProductsResult:
    products: list[dict[str, str]]
    cached_at: datetime | None


@dataclass(frozen=True)
class BatchStoreProductsEntry:
    query: str
    status: Literal["fresh", "missing"]
    products: list[dict[str, str]]
    cached_at: datetime | None


def prepare_store_query(query: str) -> PreparedStoreQuery | None:
    query_text = re.sub(r"\s+", " ", query or "").strip()
    if not query_text:
        return None
    return PreparedStoreQuery(
        query_text=query_text,
        cache_query=query_text.casefold(),
        language="zh" if _query_has_cjk(query_text) else "en",
    )
```

Implement `fetch_store_products_with_metadata(query: str, session: AsyncSession | None = None, *, force_refresh: bool = False, priority: LookupPriority = "interactive") -> StoreProductsResult`; `fetch_store_products` has the same arguments and returns only `list[dict[str, str]]`; `fetch_cached_store_products_batch(queries: Sequence[str], session: AsyncSession) -> list[BatchStoreProductsEntry]` is cache-only.

Implement `_LiveLookupCoordinator` with two deques under one `asyncio.Lock`. A keyed job stores its operation, future, current priority, and started flag. Submitting an interactive waiter for a queued background key promotes that same job; submitting any duplicate key joins its shielded future. The worker always pops a valid interactive job before a background job, runs exactly one operation, resolves/rejects all waiters, removes the keyed job, and exits cleanly when both queues are empty.

`fetch_store_products_with_metadata` performs L1, then L2, then a second L1 check before submitting a scrape/persist operation. The operation calls `weee_scraper.scrape_weee_products(prepared.query_text, prepared.language)`, validates, returns uncached `[]` for confirmed empty, commits a positive row through a fresh write session, then publishes L1 and resolves.

Add repository interface:

```python
async def get_cached_store_products_batch(
    session: AsyncSession,
    *,
    keys: Sequence[tuple[str, str]],
    store: str,
    cache_version: str,
    max_age_seconds: int,
) -> dict[tuple[str, str], CachedStoreProducts]:
    unique_keys = list(dict.fromkeys(keys))
    if not unique_keys:
        return {}
    result = await session.execute(
        select(CachedStoreProductModel).where(
            CachedStoreProductModel.store == store,
            CachedStoreProductModel.cache_version == cache_version,
            tuple_(CachedStoreProductModel.query, CachedStoreProductModel.language).in_(unique_keys),
        )
    )
    now = datetime.now(timezone.utc)
    entries: dict[tuple[str, str], CachedStoreProducts] = {}
    for row in result.scalars().all():
        updated_at = row.updated_at.replace(tzinfo=timezone.utc) if row.updated_at.tzinfo is None else row.updated_at
        products = normalize_cached_store_products(row.data)
        if products and is_cache_entry_fresh(updated_at, now, max_age_seconds):
            entries[(row.query, row.language)] = CachedStoreProducts(products, updated_at)
    return entries
```

Batch service order is the first mechanically cleaned spelling for each case-folded cache key. It checks all L1 entries first, performs this single L2 read for remaining keys, warms L1 from fresh L2 rows, returns missing entries for the rest, and never references the live coordinator.

Log parseable message fields while retaining structured extras, for example:

```python
logger.info(
    "store_products event=%s store=weee language=%s cache_version=%s query=%r priority=%s queue_wait_ms=%.1f elapsed_ms=%.1f product_count=%s error_type=%s",
    event,
    language,
    CACHE_VERSION,
    cache_query,
    priority,
    queue_wait_ms,
    elapsed_ms,
    product_count,
    error_type,
    extra=fields,
)
```

- [ ] **Step 6: Run focused and migrated cache tests**

Run:

```bash
cd backend
.venv_fresh/bin/python -m pytest -q tests/test_store_product_service.py tests/test_store_cache.py
```

Expected: PASS with one active live scrape, preserved strict expiry, working cancellation/single-flight semantics, and no live call from batch reads.

- [ ] **Step 7: Commit Task 2**

```bash
git add backend/app/services/store_product_service.py backend/app/db/repo_store_cache.py backend/tests/test_store_product_service.py backend/tests/test_store_cache.py backend/tests/conftest.py
git commit -m "feat: coordinate fresh store product lookups"
```

---

### Task 3: Cache-Only Batch HTTP Contract and Typed 503

**Files:**
- Modify: `backend/app/api/routes_store.py`
- Modify: `backend/tests/test_store_routes.py`
- Modify: `packages/api-client/src/index.ts`
- Modify: `apps/web/app/shopping-list/weeeContract.test.ts`

**Interfaces:**
- Consumes: Task 2 service functions and `weee_scraper.StoreScrapeError`.
- Produces: `POST /store-products/batch`, stable retryable 503 mapping, and shared TypeScript batch types/client method.
- Batch JSON uses `{ "entries": [{ "query", "status", "products", "expires_at" }] }` exactly.

- [ ] **Step 1: Write failing backend route tests**

Add:

```python
CACHED_AT = datetime(2026, 8, 27, tzinfo=timezone.utc)


def authenticated_store_app() -> FastAPI:
    app = FastAPI()
    app.include_router(routes_store.router)
    app.dependency_overrides[routes_store.get_session] = lambda: object()
    app.dependency_overrides[routes_store.get_current_user] = lambda: object()
    return app
```

```python
@pytest.mark.asyncio
async def test_retryable_scrape_failure_maps_to_503_with_retry_after(monkeypatch):
    async def fail(*args, **kwargs):
        raise StoreScrapeError("selector never became trustworthy")

    monkeypatch.setattr(routes_store, "fetch_store_products_with_metadata", fail)
    app = authenticated_store_app()
    with TestClient(app) as client:
        response = client.get("/store-products", params={"query": "garlic"})

    assert response.status_code == 503
    assert response.headers["retry-after"] == "3"
    assert response.json() == {"detail": {"code": "weee_temporarily_unavailable"}}


def test_batch_route_returns_fresh_and_missing_in_cleaned_order(monkeypatch):
    async def batch(*args, **kwargs):
        return [
            BatchStoreProductsEntry("Garlic", "fresh", [PRODUCT], CACHED_AT),
            BatchStoreProductsEntry("ginger", "missing", [], None),
        ]

    monkeypatch.setattr(routes_store, "fetch_cached_store_products_batch", batch)
    app = authenticated_store_app()
    with TestClient(app) as client:
        response = client.post(
            "/store-products/batch",
            json={"queries": [" Garlic ", "garlic", "", "ginger"]},
        )

    assert response.status_code == 200
    assert response.json() == {
        "entries": [
            {"query": "Garlic", "status": "fresh", "products": [PRODUCT], "expires_at": "2026-08-28T00:00:00Z"},
            {"query": "ginger", "status": "missing", "products": [], "expires_at": None},
        ]
    }
```

Also assert the batch route handles 75 inputs and the patched live scraper is never called. Keep the existing modern/legacy GET response-shape tests unchanged.

- [ ] **Step 2: Write the failing shared client contract test**

Extend `weeeContract.test.ts`:

```typescript
test("posts a cache-only product batch without a store selector", async () => {
  const payload = {
    entries: [
      { query: "garlic", status: "missing", products: [], expires_at: null },
    ],
  } satisfies StoreProductsBatchResponse;
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    auth: { kind: "cookie" },
  });

  await expect(client.shopping.storeProductsBatch(["garlic"])).resolves.toEqual(payload);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.example.test/store-products/batch",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ queries: ["garlic"] }),
    }),
  );
});
```

- [ ] **Step 3: Run both contracts and verify they fail for missing route/client support**

Run:

```bash
cd backend
.venv_fresh/bin/python -m pytest -q tests/test_store_routes.py
cd ..
npm --workspace @cooking/web test -- app/shopping-list/weeeContract.test.ts
```

Expected: FAIL on the absent batch route/client and generic 500 behavior.

- [ ] **Step 4: Implement route models, error mapping, and API-client types**

Use:

```python
class StoreProductsBatchBody(BaseModel):
    queries: list[str]


class StoreProductsBatchEntryResponse(BaseModel):
    query: str
    status: Literal["fresh", "missing"]
    products: list[StoreProduct]
    expires_at: datetime | None


class StoreProductsBatchResponse(BaseModel):
    entries: list[StoreProductsBatchEntryResponse]
```

Catch `StoreScrapeError` only around the GET service call and raise:

```python
raise HTTPException(
    status_code=503,
    detail={"code": "weee_temporarily_unavailable"},
    headers={"Retry-After": "3"},
) from exc
```

The authenticated POST calls only `fetch_cached_store_products_batch(body.queries, session)`. Compute positive `expires_at` as `cached_at + timedelta(seconds=86_400)` and force missing entries to `products=[]`, `expires_at=None`.

Use these TypeScript exports:

```typescript
export type StoreProductsBatchEntry = {
  query: string;
  status: "fresh" | "missing";
  products: StoreProduct[];
  expires_at: string | null;
};

export type StoreProductsBatchResponse = {
  entries: StoreProductsBatchEntry[];
};
```

Add `shopping.storeProductsBatch(queries)` as a JSON POST with `{ queries }`.

- [ ] **Step 5: Run route/client tests and type checking**

Run:

```bash
cd backend
.venv_fresh/bin/python -m pytest -q tests/test_store_routes.py
cd ..
npm --workspace @cooking/web test -- app/shopping-list/weeeContract.test.ts
npx tsc -p apps/web/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add backend/app/api/routes_store.py backend/tests/test_store_routes.py packages/api-client/src/index.ts apps/web/app/shopping-list/weeeContract.test.ts
git commit -m "feat: add batch store product cache contract"
```

---

### Task 4: Serial Daily Warmer and Compatibility Facade

**Files:**
- Modify: `backend/app/jobs/cache_warmer.py`
- Modify: `backend/app/jobs/cache_warmer_queries.py`
- Modify: `backend/app/api/admin.py`
- Replace: `backend/app/services/store_scraper.py`
- Modify: `backend/tests/test_cache_warmer.py`
- Modify: `backend/tests/test_store_routes.py`

**Interfaces:**
- Consumes: Task 2 service with `priority="background"`.
- Produces: serial warming, no startup live sweep, and legacy import compatibility without duplicated production logic.

- [ ] **Step 1: Change warmer tests first**

Replace the two-wide test with:

```python
@pytest.mark.asyncio
async def test_warmer_runs_queries_serially_at_background_priority_and_isolates_failures(monkeypatch):
    active = 0
    peak = 0
    priorities = []

    async def fetch(query, session=None, *, force_refresh=False, priority="interactive"):
        nonlocal active, peak
        priorities.append(priority)
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        if query == "failure":
            raise StoreScrapeError("controlled")
        return [] if query == "empty" else [PRODUCT]

    monkeypatch.setattr(cache_warmer, "ALL_QUERIES", ["one", "empty", "failure", "two"])
    monkeypatch.setattr(cache_warmer, "fetch_store_products", fetch)

    summary = await cache_warmer.run_cache_warmer(force_refresh=True)

    assert peak == 1
    assert priorities == ["background"] * 4
    assert summary == {"cache_hit": 0, "cache_miss": 2, "empty": 1, "skipped": 0, "failed": 1, "total": 4}
```

Update the scheduler test to assert `trigger_cache_warmer` is not called during `start_scheduler`, while the registered 24-hour job still calls `run_cache_warmer(force_refresh=True)`.

- [ ] **Step 2: Run warmer tests and observe the old concurrency/startup assertions fail**

Run:

```bash
cd backend
.venv_fresh/bin/python -m pytest -q tests/test_cache_warmer.py
```

Expected: FAIL because warming still gathers two workers and triggers on startup.

- [ ] **Step 3: Implement serial traversal, background priority, and the facade**

Remove `PRECOMPUTE_CONCURRENCY` and replace `asyncio.gather` with one ordered loop. `warm_cache_query` returns `"empty"` when a confirmed live refresh returns no products and calls:

```python
products = await fetch_store_products(
    query,
    session=session,
    force_refresh=force_refresh,
    priority="background",
)
```

Keep failure isolation and progress callback invocation after every query. Remove `trigger_cache_warmer(force_refresh=False)` from `start_scheduler`; retain the existing daily interval job, lock, manual trigger, status endpoint, and forced scheduled refresh.

Change `admin.py` imports to `store_product_service`. Replace `store_scraper.py` with a documented compatibility facade that re-exports only public names:

```python
"""Compatibility imports for callers migrated to store_product_service."""
from app.services.store_product_service import (
    CACHE,
    CACHE_TTL_SECONDS,
    CACHE_VERSION,
    BatchStoreProductsEntry,
    StoreProductsResult,
    fetch_cached_store_products_batch,
    fetch_store_products,
    fetch_store_products_with_metadata,
    prepare_store_query,
)
from app.services.weee_scraper import StoreScrapeError

__all__ = [
    "CACHE",
    "CACHE_TTL_SECONDS",
    "CACHE_VERSION",
    "BatchStoreProductsEntry",
    "StoreProductsResult",
    "StoreScrapeError",
    "fetch_cached_store_products_batch",
    "fetch_store_products",
    "fetch_store_products_with_metadata",
    "prepare_store_query",
]
```

Migrate tests that intentionally exercise private scraper/service helpers to import their owning module. Leave legacy public-import tests passing through the facade.

- [ ] **Step 4: Run backend focused suites**

Run:

```bash
cd backend
.venv_fresh/bin/python -m pytest -q tests/test_weee_scraper.py tests/test_store_product_service.py tests/test_store_cache.py tests/test_store_routes.py tests/test_cache_warmer.py
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add backend/app/jobs/cache_warmer.py backend/app/jobs/cache_warmer_queries.py backend/app/api/admin.py backend/app/services/store_scraper.py backend/tests/test_cache_warmer.py backend/tests/test_store_routes.py backend/tests/test_store_cache.py
git commit -m "fix: warm Weee cache without startup contention"
```

---

### Task 5: Web Batch-First Loading with an Interactive-First Serial Miss Queue

**Files:**
- Modify: `apps/web/app/shopping-list/productLookupCoordinator.ts`
- Modify: `apps/web/app/shopping-list/productLookupCoordinator.test.ts`
- Modify: `apps/web/app/shopping-list/page.tsx`
- Modify: `apps/web/app/shopping-list/page.productLookup.test.tsx`
- Modify: `apps/web/e2e/shopping.spec.ts`

**Interfaces:**
- Consumes: Task 3 `StoreProductsBatchResponse` and POST endpoint.
- Produces: `createProductLookupCoordinator({ load, loadBatch, shouldPublish, onState })` with `request` and `requestBulk`.
- `requestBulk(names, generation)` returns one promise per mechanically unique input so page progress can advance per terminal item.

- [ ] **Step 1: Replace the four-wide coordinator test with failing serial/batch tests**

Add:

```typescript
test("publishes batch hits before draining misses serially in visual order", async () => {
  const releases = new Map<string, ReturnType<typeof deferred<StoreProductsResponse>>>();
  let active = 0;
  let peak = 0;
  const load = vi.fn((query: string) => {
    active += 1;
    peak = Math.max(peak, active);
    const release = deferred<StoreProductsResponse>();
    releases.set(query, release);
    return release.promise.finally(() => { active -= 1; });
  });
  const loadBatch = vi.fn().mockResolvedValue({
    entries: [
      { query: "Rice", status: "fresh", products: [product("Cached rice")], expires_at: FUTURE_EXPIRES_AT },
      { query: "Beans", status: "missing", products: [], expires_at: null },
      { query: "Milk", status: "missing", products: [], expires_at: null },
    ],
  });
  const transitions: Array<[string, string]> = [];
  const coordinator = createProductLookupCoordinator({
    load,
    loadBatch,
    shouldPublish: () => true,
    onState: (key, state) => transitions.push([key, state.status]),
  });

  const requests = coordinator.requestBulk(["Rice", "Beans", "Milk"], 1);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  expect(transitions).toContainEqual(["rice", "success"]);
  expect(load).toHaveBeenNthCalledWith(1, "Beans");
  releases.get("Beans")?.resolve(response([product("Beans")]));
  await vi.waitFor(() => expect(load).toHaveBeenNthCalledWith(2, "Milk"));
  releases.get("Milk")?.resolve(response([product("Milk")]));
  await Promise.all(requests);

  expect(peak).toBe(1);
});
```

Add separate tests proving:

- `" Rice "`, `"rice"`, and repeated internal whitespace share one identity while the first cleaned spelling is sent;
- a manual request queued behind the active bulk miss starts before the next bulk miss;
- an already-running manual alias is excluded from the batch and its promise is joined;
- batch failure or malformed duplicate/missing/unknown entries falls back to the same serial miss queue;
- a non-empty server response containing no safe products becomes `error`, never `empty`;
- generation cancellation suppresses batch and GET completion publication; and
- 75 cache hits resolve without any live GET.

- [ ] **Step 2: Write failing page-level batch/progress tests**

In `page.productLookup.test.tsx`, make the bulk button test return two fresh batch entries and two misses. Assert one POST body in visual order, both cached product names render before the first deferred GET resolves, only one GET is active, and progress advances for cached and then live terminal results. Add a Retry interaction test where the first GET returns HTTP 503, the panel renders the existing generic error, clicking Retry issues a second GET, shows loading, and renders a valid product.

Before production changes, add the same browser-visible contract to `apps/web/e2e/shopping.spec.ts`: prepare a smart list with four ingredients; intercept one batch request with two fresh hits and two misses; defer the miss GET responses; assert the cached choices render before a miss resolves and only the first miss starts; resolve it; return a controlled 503 for the second; click Retry; and return a valid choice. Use request counters and literal JSON fixtures so the test observes behavior rather than source structure.

- [ ] **Step 3: Run the focused web tests and verify old four-wide behavior fails**

Run:

```bash
npm --workspace @cooking/web test -- app/shopping-list/productLookupCoordinator.test.ts app/shopping-list/page.productLookup.test.tsx
npm --workspace @cooking/web run test:e2e -- shopping.spec.ts
```

Expected: FAIL because the coordinator has no batch interface and starts four live requests.

- [ ] **Step 4: Implement mechanical identity, batch parsing, and two-priority serial queues**

Use:

```typescript
export function cleanIngredientQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function canonicalIngredientKey(value: string): string {
  return cleanIngredientQuery(value).toLocaleLowerCase();
}

type QueueEntry = {
  id: string;
  key: string;
  query: string;
  generation: number;
  priority: "interactive" | "bulk";
  started: boolean;
  promise: Promise<ProductLookupState>;
  resolve: (state: ProductLookupState) => void;
};
```

Maintain interactive and bulk deques, `active` as `0 | 1`, and the existing generation-key pending map. `request()` creates/promotes an interactive entry and pumps. `requestBulk()` mechanically dedupes in visual order, joins existing aliases, creates queued bulk entries for new identities, starts one `loadBatch` call for only those new entries, finishes valid fresh entries immediately, and enqueues only missing/fallback entries. `pump()` always chooses interactive first and starts only when `active === 0`.

Batch validation requires exactly one known canonical result per requested identity. Fresh entries must pass `parseStoreProductsResponse`; missing entries must contain `products=[]` and `expires_at=null`. Any malformed batch rejects the preflight as a whole and serially GETs all its unresolved entries.

Change `parseStoreProductsResponse` so a non-empty source array that yields zero safe products throws `Invalid product response`.

In `page.tsx`, add:

```typescript
async function loadProductBatch(queries: string[]): Promise<StoreProductsBatchResponse> {
  const res = await apiFetch("/store-products/batch", {
    method: "POST",
    body: JSON.stringify({ queries }),
  });
  if (!res.ok) throw new Error("Failed to load cached products");
  return (await res.json()) as StoreProductsBatchResponse;
}
```

Pass it to the coordinator. In bulk loading, count currently unexpired `success` states immediately, call `requestBulk` only for unresolved keys, and advance progress as each returned promise settles. Preserve panel opening, visual order, generation guards, and final progress cleanup.

Change `parseProductLookupStorage` to retain sanitized unexpired success states. Its `revalidate` list contains only open keys without a retained success, so a fresh client result renders immediately and an exact-expiry timer still removes and reloads it.

- [ ] **Step 5: Run focused web tests, full web tests, and TypeScript**

Run:

```bash
npm --workspace @cooking/web test -- app/shopping-list/weeeContract.test.ts app/shopping-list/productLookupCoordinator.test.ts app/shopping-list/page.productLookup.test.tsx app/shopping-list/ProductPicks.test.tsx
npm --workspace @cooking/web test
npx tsc -p apps/web/tsconfig.json --noEmit
npm --workspace @cooking/web run test:e2e -- shopping.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/web/app/shopping-list/productLookupCoordinator.ts apps/web/app/shopping-list/productLookupCoordinator.test.ts apps/web/app/shopping-list/page.tsx apps/web/app/shopping-list/page.productLookup.test.tsx apps/web/e2e/shopping.spec.ts
git commit -m "feat: load Weee cache hits before serial misses"
```

---

### Task 6: Mobile Batch Hydration and One Global Live Queue

**Files:**
- Create: `apps/mobile/src/features/shopping/storeProductIdentity.ts`
- Create: `apps/mobile/src/features/shopping/storeProductIdentity.test.ts`
- Modify: `apps/mobile/src/features/shopping/useStoreProductsCache.ts`
- Modify: `apps/mobile/src/features/shopping/useStoreProductsCache.test.ts`
- Modify: `apps/mobile/src/features/shopping/storage.ts`
- Modify: `apps/mobile/src/features/shopping/storage.test.ts`
- Modify: `apps/mobile/src/features/shopping/SmartListCard.tsx`
- Modify: `apps/mobile/src/features/shopping/SmartListCard.test.tsx`

**Interfaces:**
- Consumes: Task 3 shared API client batch method.
- Produces: case-insensitive mechanical identity for UI state, fresh local hydration, one serial live queue, and batch-first bulk loading.

- [ ] **Step 1: Write failing identity and fresh-hydration tests**

Use this desired identity API:

```typescript
expect(prepareStoreProductQueries([" Rice ", "rice", "two  cloves garlic", " "])).toEqual([
  { key: "rice", query: "Rice" },
  { key: "two cloves garlic", query: "two cloves garlic" },
]);
```

Replace the current test that revalidates every persisted positive with assertions that two unexpired stored positives appear immediately after hydration and neither batch nor GET is called. Add a test where one fresh stored product and one open missing key render the fresh product immediately, batch only the missing key, and then serially GET it.

Add a persistence regression test: while `readSmartProducts` is unresolved, `writeSmartProducts` is not called and the existing cache is not overwritten with empty maps.

- [ ] **Step 2: Write failing global serial and batch tests**

Add tests proving:

```typescript
test("bulk publishes batch hits then live-loads misses one at a time", async () => {
  mockReadSmartProducts.mockResolvedValue(null);
  mockStoreProductsBatch.mockResolvedValue({
    entries: [
      { query: "Rice", status: "fresh", products: [RICE], expires_at: FUTURE_EXPIRES_AT },
      { query: "Beans", status: "missing", products: [], expires_at: null },
      { query: "Milk", status: "missing", products: [], expires_at: null },
    ],
  });
  const beans = deferred<StoreProductsResponse>();
  const milk = deferred<StoreProductsResponse>();
  const started: string[] = [];
  mockStoreProducts.mockImplementation((query: string) => {
    started.push(query);
    return query === "Beans" ? beans.promise : milk.promise;
  });
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => { void result.current.loadAll(["Rice", "Beans", "Milk"]); });
  await waitFor(() => expect(result.current.products.rice).toEqual([RICE]));
  expect(started).toEqual(["Beans"]);
  await act(async () => { beans.resolve(response([BEANS])); await beans.promise; });
  await waitFor(() => expect(started).toEqual(["Beans", "Milk"]));
  await act(async () => { milk.resolve(response([MILK])); await milk.promise; });
  await waitFor(() => expect(result.current.bulkLoading).toEqual({ active: false, done: 3, total: 3 }));
});
```

Define `mockStoreProductsBatch` beside `mockStoreProducts`, add it to the mock API client, and define `RICE`, `BEANS`, and `MILK` as literal safe products. Add a separate manual-priority test that holds the first bulk GET, calls `togglePanel("Garlic")`, releases the first request, and asserts the observed GET order is `["Beans", "Garlic", "Milk"]`. Add a 75-item test whose batch response contains 75 literal valid fresh entries and assert `bulkLoading` ends at `{ active: false, done: 75, total: 75 }` while `mockStoreProducts` has zero calls.

Retain exact-expiry tests and add a hydrated-cache variant: a fresh product remains visible one millisecond before expiry, disappears exactly at expiry, and then enters the serial GET queue.

- [ ] **Step 3: Run mobile tests and verify current three-worker/revalidation behavior fails**

Run:

```bash
npm --workspace @cooking/mobile test -- storeProductIdentity.test.ts useStoreProductsCache.test.ts storage.test.ts SmartListCard.test.tsx
```

Expected: FAIL because identity is trim-only/case-sensitive, hydration discards positives, no batch call exists, and live work uses multiple workers.

- [ ] **Step 4: Implement canonical UI identity and strict local hydration**

Create:

```typescript
export type PreparedStoreProductQuery = { key: string; query: string };

export function cleanStoreProductQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function canonicalStoreProductKey(raw: string): string {
  return cleanStoreProductQuery(raw).toLocaleLowerCase();
}

export function prepareStoreProductQueries(
  rawNames: readonly string[],
): PreparedStoreProductQuery[] {
  const seen = new Set<string>();
  const result: PreparedStoreProductQuery[] = [];
  for (const raw of rawNames) {
    const query = cleanStoreProductQuery(raw);
    const key = canonicalStoreProductKey(query);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ key, query });
  }
  return result;
}
```

Use canonical keys in reducer maps, in-flight entries, expiry timers, persistence, and `SmartListCard` map lookup. Preserve the first mechanically cleaned query text for network calls.

Export the existing strict response validator from `storage.ts` as `isFreshStoredProductResponse(value, nowMs)` and use it during storage parse and hook hydration. Hydration populates `products` and `expiresAt` from fresh positives rather than setting them to empty maps. Add `hydratedWeekStart` to state; the persistence effect returns until it equals the active week so it cannot clobber unread storage.

- [ ] **Step 5: Implement the cache-only batch and one global live queue**

Replace `BULK_LOAD_CONCURRENCY` with a ref-backed two-priority serial queue. `loadOne` dedupes by canonical key, publishes loading, and submits a live GET operation tagged `interactive` or `bulk`; the pump starts one operation and selects interactive before bulk. Expiry and Retry submit interactive work. Hydration and bulk misses submit bulk work.

`loadAll`:

1. mechanically prepares/dedupes all names;
2. counts existing unexpired positives as complete;
3. calls `apiClient.shopping.storeProductsBatch` once for unresolved query texts;
4. validates each known unique batch entry and dispatches fresh hits immediately;
5. submits only missing entries to `loadOne` at bulk priority; and
6. advances `bulkLoading.done` after every cached or live terminal result under the active generation.

If batch validation or the POST fails, submit all unresolved entries through the same serial bulk queue. Suppress queued network calls and publications after week/generation change.

- [ ] **Step 6: Run focused mobile tests, full mobile tests, and TypeScript**

Run:

```bash
npm --workspace @cooking/mobile test -- storeProductIdentity.test.ts useStoreProductsCache.test.ts storage.test.ts SmartListCard.test.tsx StoreProductPicks.test.tsx
npm run test:mobile
npx tsc -p apps/mobile/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 7: Run the React quality checklist because TSX behavior changed**

Read and apply `vercel:react-best-practices` to `page.tsx` and `SmartListCard.tsx`. Resolve only findings introduced by this plan and re-run both TypeScript checks plus their focused tests.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/mobile/src/features/shopping/storeProductIdentity.ts apps/mobile/src/features/shopping/storeProductIdentity.test.ts apps/mobile/src/features/shopping/useStoreProductsCache.ts apps/mobile/src/features/shopping/useStoreProductsCache.test.ts apps/mobile/src/features/shopping/storage.ts apps/mobile/src/features/shopping/storage.test.ts apps/mobile/src/features/shopping/SmartListCard.tsx apps/mobile/src/features/shopping/SmartListCard.test.tsx
git commit -m "feat: make mobile Weee loading batch first"
```

---

### Task 7: Documentation and Complete Verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/qa/2026-08-15-web-planner-weee-cache-checklist.md`

**Interfaces:**
- Consumes: completed backend, web, and mobile contracts.
- Produces: current operational documentation and a complete verification record.

- [ ] **Step 1: Update operational documentation**

Document in `CLAUDE.md` and the QA checklist:

- strict `<24h` expiry and no stale display;
- batch cache read + serial misses;
- three internal scraper attempts, one page per attempt, and no PDP enrichment;
- one backend live worker with interactive-before-warmer selection;
- serial daily force refresh and no startup sweep;
- confirmed empty `200` versus exhausted transient `503`; and
- the exact smoke checks below.

- [ ] **Step 2: Run complete verification**

Run:

```bash
cd backend
.venv_fresh/bin/python -m pytest -q
cd ..
npm run tokens:test
npm run tokens:build
git diff --exit-code -- packages/design-tokens
npm run test:web
npm run test:mobile
npx tsc -p apps/web/tsconfig.json --noEmit
npx tsc -p apps/mobile/tsconfig.json --noEmit
npm run web:build
npm --workspace @cooking/web run test:e2e
git diff --check
```

Expected: every command exits `0`; token build does not create an uncommitted generated diff.

- [ ] **Step 3: Re-run the production-like cold-cache concurrency probe locally**

Run the focused backend test that launches 20 distinct cache misses plus a background warmer job against controlled scrape doubles, while polling the FastAPI `/health` route. Assert peak live scrape count is one, every request terminates, and health returns `200` throughout. This is deterministic and must not contact or load-test the real Weee site.

```bash
cd backend
.venv_fresh/bin/python -m pytest -q tests/test_store_product_service.py -k 'cold_cache_health_probe'
```

Expected: PASS.

- [ ] **Step 4: Commit Task 7**

```bash
git add CLAUDE.md docs/qa/2026-08-15-web-planner-weee-cache-checklist.md
git commit -m "docs: record reliable Weee shopping workflow"
```
