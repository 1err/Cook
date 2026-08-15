# Weee Product Loading and Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Weee the only prototype product source, load grocery matches in visible top-left-to-bottom order with four concurrent requests, and share strictly fresh 24-hour results across users through memory and PostgreSQL caches.

**Architecture:** A typed frontend state machine distinguishes queued, active, successful, empty, and failed requests without changing the current grocery bento layout. The backend keeps memory and PostgreSQL cache reads ahead of scraping, coordinates identical in-process misses through one keyed task, limits all live scrapes to four, and refreshes the curated Weee catalog daily with two warmer workers.

**Tech Stack:** React 18, Next.js 14, Expo/React Native, TypeScript, Vitest, Jest/RNTL, FastAPI, async SQLAlchemy/PostgreSQL, asyncio, Playwright for Weee scraping, pytest/pytest-asyncio, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-15-web-planner-weee-cache-design.md`

## Global Constraints

- Preserve the current grocery bento layout, column widths, category placement, and card presentation exactly; loading-order changes are data-flow only.
- The visual request order is Pantry & Dry Goods first, then Produce, Dairy, Meat & Seafood, Frozen, Bakery, and Other; rows retain rendered order.
- Run four interactive client workers and keep the backend scrape semaphore at four.
- Use Weee only in web, mobile, shared types, API clients, admin tools, and backend scraping.
- Continue accepting an explicit legacy `store=weee`; reject `store=amazon` with HTTP 400.
- A result is displayable only while its age is strictly less than 86,400 seconds; exactly 24 hours old is expired.
- Never serve an expired price while refreshing. Empty or failed refreshes never overwrite a positive cache row.
- Deduplicate simultaneous equivalent misses within one backend process; distributed locking remains deferred.
- Run the daily curated warmer with concurrency two and continue after individual failures.
- Do not delete historical Amazon database rows or unrelated AWS/S3 `amazonaws.com` URLs.
- Do not add a database migration; retain the existing `store` primary-key field and write `weee` for every new active row.
- Do not add popularity scoring, import-time prefetch, or distributed locking in this cycle.

## File Structure

- `packages/shared/src/store.ts` — fixed Weee identifier and label; no store union.
- `packages/api-client/src/index.ts` — product lookup without a caller-selected store.
- `apps/web/app/shopping-list/productLoading.ts` — pure visual-order queue builder and four-worker state machine.
- `apps/web/app/shopping-list/ProductPicks.tsx` — queued/loading/success/empty/error presentation shared by every web grocery card.
- `apps/web/app/shopping-list/page.tsx` — existing bento layout plus product-panel state, generation cancellation, and bulk progress.
- `apps/mobile/src/features/shopping/*` — Weee-only native presentation and ephemeral per-week result storage.
- `backend/app/services/store_scraper.py` — cache lookup, keyed single-flight, global scrape limit, Weee scraping, and event logs.
- `backend/app/db/repo_store_cache.py` — strict PostgreSQL freshness and Weee-filtered admin queries.
- `backend/app/jobs/cache_warmer*.py` — curated daily source, two-worker execution, and failure-tolerant status.
- `backend/app/api/routes_store.py` and `backend/app/api/admin.py` — Weee-only public/admin boundaries while retaining legacy `store=weee` tolerance.
- `backend/tests/` — strict TTL, persistence, single-flight, concurrency, route, and warmer regression coverage.
- `.github/workflows/frontend-ui.yml` — existing frontend gate plus an independent backend pytest job.

---

### Task 1: Weee-only shared and application contract

**Files:**
- Modify: `packages/shared/src/store.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/api-client/src/index.ts`
- Test: `apps/web/app/shopping-list/weeeContract.test.ts`
- Modify: `apps/web/app/shopping-list/page.tsx`
- Modify: `apps/web/app/preview/page.tsx`
- Modify: `apps/mobile/src/features/shopping/storage.ts`
- Modify: `apps/mobile/src/features/shopping/useStoreProductsCache.ts`
- Modify: `apps/mobile/src/features/shopping/ShoppingListScreen.tsx`
- Modify: `apps/mobile/src/features/shopping/SmartListCard.tsx`
- Modify: `apps/mobile/src/features/shopping/SmartListItem.tsx`
- Modify: `apps/mobile/src/features/shopping/StoreProductPicks.tsx`
- Modify: `apps/mobile/src/features/shopping/StoreProductPicks.test.tsx`

**Interfaces:**
- Produces: `WEEE_STORE = "weee"`, `WEEE_STORE_LABEL = "Weee"`, and `apiClient.shopping.storeProducts(query: string)`.
- Removes: `ProductStore`, `PRODUCT_STORES`, `PRODUCT_STORE_LABELS`, all store selectors, and all frontend `store` parameters.

- [ ] **Step 1: Write the failing API contract test**

```ts
import { afterEach, expect, test, vi } from "vitest";
import { createApiClient } from "@cooking/api-client";

afterEach(() => vi.unstubAllGlobals());

test("requests Weee products without a store selector", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = createApiClient({ baseUrl: "https://api.example.test", auth: { kind: "cookie" } });
  await client.shopping.storeProducts("silken tofu");
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.example.test/store-products?query=silken%20tofu",
    expect.objectContaining({ credentials: "include" }),
  );
});
```

Update `StoreProductPicks.test.tsx` so the component has no `store` prop, still shows `Finding matches on Weee…`, and renders `View on Weee` for a successful result.

- [ ] **Step 2: Run web and mobile focused tests to verify RED**

Run: `npm --workspace @cooking/web test -- app/shopping-list/weeeContract.test.ts`

Run: `npm --workspace @cooking/mobile test -- StoreProductPicks.test.tsx --runInBand`

Expected: web test fails because `storeProducts` requires a store; mobile test fails because the component still requires `store`.

- [ ] **Step 3: Replace the shared store union with Weee constants**

Use this complete `packages/shared/src/store.ts` contract:

```ts
export const WEEE_STORE = "weee" as const;
export const WEEE_STORE_LABEL = "Weee";
```

Keep exporting `./store` from the shared barrel. Change the API client to:

```ts
storeProducts: (query: string) =>
  json<StoreProduct[]>(`/store-products?query=${encodeURIComponent(query)}`),
```

- [ ] **Step 4: Remove selectors and store parameters from web and mobile**

In web shopping, remove `productStore`, `productStoreRef`, the product-source chip group, and store-switch effects. Use a single storage key `${SMART_SHOPPING_PRODUCTS_PREFIX}:${weekStart}:weee`. Historical keys for removed stores are never read and remain inert.

In mobile storage, make `smartProductsKey(weekStart)` Weee-only and make `clearSmartProducts` remove only that active key. Historical keys for removed stores are never read and remain inert. Remove store props/state from the cache hook and components. Use `WEEE_STORE_LABEL` for user-facing copy.

In preview, remove the store filter and Amazon label branch; request and display only Weee rows returned by the backend.

The storage and presentation APIs become:

```ts
export const smartProductsKey = (weekStart: string) =>
  `${SMART_SHOPPING_PRODUCTS_PREFIX}:${weekStart}:weee`;

export type StoreProductPicksProps = {
  loading: boolean;
  error: string | null;
  products: StoreProduct[] | undefined;
  onRetry: () => void;
};

const data = await apiClient.shopping.storeProducts(query);
```

- [ ] **Step 5: Verify the contract and absence of active Amazon product code**

Run: `npm --workspace @cooking/web test -- app/shopping-list/weeeContract.test.ts`

Run: `npm --workspace @cooking/mobile test -- StoreProductPicks.test.tsx --runInBand`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Run:

```bash
! rg -n 'ProductStore|PRODUCT_STORES|PRODUCT_STORE_LABELS|fetch_amazon_products|"amazon"|Amazon' packages apps --glob '!**/node_modules/**' --glob '!**/.next/**'
```

Expected: focused tests pass, both typechecks exit 0, and the scan finds no active frontend/shared Amazon product code.

- [ ] **Step 6: Commit the Weee-only application contract**

```bash
git add packages/shared/src/store.ts packages/shared/src/index.ts packages/api-client/src/index.ts apps/web/app/shopping-list apps/web/app/preview/page.tsx apps/mobile/src/features/shopping
git commit -m "refactor(store): make product lookup Weee only"
```

---

### Task 2: Ordered four-worker frontend loading engine

**Files:**
- Create: `apps/web/app/shopping-list/productLoading.ts`
- Test: `apps/web/app/shopping-list/productLoading.test.ts`

**Interfaces:**
- Produces: `ProductLookupStatus`, `ProductLookupState`, `buildVisualProductQueue(groups)`, and `runOrderedProductQueue(options)`.
- Consumes later: the existing primary and secondary category arrays in their rendered order.

- [ ] **Step 1: Write failing queue-order, stable-dedupe, and concurrency tests**

```ts
import { expect, test, vi } from "vitest";
import { buildVisualProductQueue, runOrderedProductQueue } from "./productLoading";

test("builds the queue from rendered groups without changing the layout", () => {
  const queue = buildVisualProductQueue([
    { category: "Pantry & Dry Goods", rows: [
      { name: "Rice", checked: false },
      { name: "Soy sauce", checked: true },
    ] },
    { category: "Produce", rows: [
      { name: "Bok choy", checked: false },
      { name: " rice ", checked: false },
    ] },
  ]);
  expect(queue).toEqual(["Rice", "Bok choy"]);
});

test("starts in queue order and never exceeds four active loads", async () => {
  const started: string[] = [];
  let active = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const load = vi.fn(async (key: string) => {
    started.push(key);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
    return [{ name: key, price: "$1", image: "", url: `https://example.test/${key}` }];
  });
  const promise = runOrderedProductQueue({
    keys: ["a", "b", "c", "d", "e"],
    load,
    onState: vi.fn(),
    onProgress: vi.fn(),
  });
  await vi.waitFor(() => expect(started).toEqual(["a", "b", "c", "d"]));
  releases.shift()?.();
  await vi.waitFor(() => expect(started).toEqual(["a", "b", "c", "d", "e"]));
  releases.splice(0).forEach((release) => release());
  await promise;
  expect(peak).toBe(4);
});
```

- [ ] **Step 2: Run the helper test to verify RED**

Run: `npm --workspace @cooking/web test -- app/shopping-list/productLoading.test.ts`

Expected: FAIL because `productLoading.ts` does not exist.

- [ ] **Step 3: Implement the typed loading engine**

Define:

```ts
export type ProductLookupStatus = "idle" | "queued" | "loading" | "success" | "empty" | "error";
export type ProductLookupState = {
  status: ProductLookupStatus;
  products?: StoreProduct[];
  error?: string;
};
export type ProductQueueGroup = {
  category: GroceryCategory;
  rows: readonly { name: string; checked: boolean }[];
};
```

`buildVisualProductQueue` trims names, excludes checked rows, and deduplicates case-insensitively while preserving the first spelling and first rendered occurrence.

`runOrderedProductQueue` uses four workers by default. It emits `queued` for every key before starting workers, emits `loading` immediately before `load`, and emits `success`, `empty`, or `error` only after completion. It accepts `shouldContinue?: () => boolean`; workers stop before starting another key when it returns false. `onProgress(done, total)` increments once for each terminal request.

```ts
export async function runOrderedProductQueue({
  keys,
  load,
  onState,
  onProgress,
  shouldContinue = () => true,
  concurrency = 4,
}: {
  keys: string[];
  load: (key: string) => Promise<StoreProduct[]>;
  onState: (key: string, state: ProductLookupState) => void;
  onProgress: (done: number, total: number) => void;
  shouldContinue?: () => boolean;
  concurrency?: number;
}): Promise<void> {
  keys.forEach((key) => onState(key, { status: "queued" }));
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (shouldContinue()) {
      const index = cursor++;
      if (index >= keys.length) return;
      const key = keys[index];
      onState(key, { status: "loading" });
      try {
        const products = await load(key);
        onState(key, products.length ? { status: "success", products } : { status: "empty", products: [] });
      } catch (error) {
        onState(key, {
          status: "error",
          error: error instanceof Error ? error.message : "Failed to load products",
        });
      }
      done += 1;
      onProgress(done, keys.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), keys.length) }, () => worker()),
  );
}
```

- [ ] **Step 4: Add terminal-state assertions and run GREEN**

Extend the test with one empty result and one rejected request. Assert their transitions end in `empty` and `error`, never in the other terminal state.

Run: `npm --workspace @cooking/web test -- app/shopping-list/productLoading.test.ts`

Expected: all helper tests PASS.

- [ ] **Step 5: Commit the loading engine**

```bash
git add apps/web/app/shopping-list/productLoading.ts apps/web/app/shopping-list/productLoading.test.ts
git commit -m "test(shopping): define ordered product loading"
```

---

### Task 3: Integrate explicit loading states without changing grocery layout

**Files:**
- Create: `apps/web/app/shopping-list/ProductPicks.tsx`
- Test: `apps/web/app/shopping-list/ProductPicks.test.tsx`
- Modify: `apps/web/app/shopping-list/page.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Consumes: Task 2 loading engine and the existing rendered category groups.
- Produces: a `lookupByIngredient: Record<string, ProductLookupState>` map and uniform queued/loading/success/empty/error presentation.

- [ ] **Step 1: Write the false-empty regression tests**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { ProductPicks } from "./ProductPicks";

function renderPicks(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

test.each([
  ["queued", "Waiting to load from Weee…"],
  ["loading", "Finding matches on Weee…"],
] as const)("renders %s without the empty message", (status, message) => {
  renderPicks(<ProductPicks state={{ status }} onRetry={vi.fn()} />);
  expect(screen.getByText(message)).toBeVisible();
  expect(screen.queryByText("No products found on Weee")).not.toBeInTheDocument();
});

test("shows empty only after a completed empty response", () => {
  renderPicks(<ProductPicks state={{ status: "empty", products: [] }} onRetry={vi.fn()} />);
  expect(screen.getByText("No products found on Weee")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});
```

- [ ] **Step 2: Run the component test to verify RED**

Run: `npm --workspace @cooking/web test -- app/shopping-list/ProductPicks.test.tsx`

Expected: FAIL because `ProductPicks` does not exist.

- [ ] **Step 3: Implement uniform state rendering**

`ProductPicks` accepts only `{ state: ProductLookupState; onRetry: () => void }`. Idle renders nothing. Queued and loading render distinct localized status copy. Success maps up to three existing product cards. Empty and error render Retry. Add `shopping.waitingProducts`, `shopping.findingProducts`, and `shopping.productLoadFailed` to English and Chinese messages; retain the existing empty/retry/view-on-store keys with Weee passed as the fixed label.

```tsx
export function ProductPicks({ state, onRetry }: ProductPicksProps) {
  const t = useT();
  if (state.status === "idle") return null;
  if (state.status === "queued") return <p className="shop-bento-products__status">{t("shopping.waitingProducts")}</p>;
  if (state.status === "loading") return <p className="shop-bento-products__status">{t("shopping.findingProducts")}</p>;
  if (state.status === "error" || state.status === "empty") {
    const message = state.status === "error"
      ? state.error ?? t("shopping.productLoadFailed")
      : t("shopping.noProductsFound", { store: WEEE_STORE_LABEL });
    return (
      <div className="shop-bento-products__status">
        <p>{message}</p>
        <button type="button" className="shop-bento-products__toggle font-headline" onClick={onRetry}>
          {t("shopping.retryProducts")}
        </button>
      </div>
    );
  }
  return (
    <>
      {(state.products ?? []).slice(0, 3).map((product) => (
        <div key={product.url} className="shop-bento-product-card">
          {product.image ? <img src={product.image} alt={product.name} /> : <div className="shop-bento-product-card__img-placeholder" aria-hidden />}
          <div className="shop-bento-product-card__body">
            <p className="shop-bento-product-card__name">{product.name}</p>
            <p className="shop-bento-product-card__price">{product.price || t("shopping.seeListing")}</p>
            <a href={product.url} target="_blank" rel="noreferrer" className="shop-bento-product-card__link font-headline">
              {t("shopping.viewOnStore", { store: WEEE_STORE_LABEL })}
            </a>
          </div>
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Replace page booleans with the state map and ordered queue**

Keep `shop-bento-grid`, `shop-bento-column--primary`, `shop-bento-column--secondary`, category arrays, and card markup in their current positions. Replace the separate products/loading/errors maps with `lookupByIngredient` and reuse `ProductPicks` in every existing product panel.

Build queue groups in this exact rendered order:

```ts
const productQueueGroups = [...SHOPPING_PRIMARY_CATEGORIES, ...SHOPPING_SECONDARY_CATEGORIES]
  .map((category) => ({
    category,
    rows: (purchaseByCategory.get(category) ?? []).map(({ item, origIndex }) => ({
      name: item.name,
      checked: smartChecked.has(origIndex),
    })),
  }));
```

On bulk load, open every deduplicated panel, run `runOrderedProductQueue`, and guard it with an incrementing generation ref so a week/smart-mode change stops late updates. Manual panel opens and Retry use the same `loadProduct` parser and state transitions. Persist only terminal success/empty/error data in session storage; hydrated positive results enter success immediately.

```ts
const generation = ++productLoadGenerationRef.current;
const keys = buildVisualProductQueue(productQueueGroups);
setOpenProductsByIngredient((current) => ({
  ...current,
  ...Object.fromEntries(keys.map((key) => [key, true])),
}));
await runOrderedProductQueue({
  keys,
  load: loadProduct,
  shouldContinue: () => productLoadGenerationRef.current === generation,
  onState: (key, state) => {
    if (productLoadGenerationRef.current !== generation) return;
    setLookupByIngredient((current) => ({ ...current, [key]: state }));
  },
  onProgress: (current, total) => setBulkLoadProgress({ current, total }),
});
```

- [ ] **Step 5: Run focused, full web, and type gates**

Run: `npm --workspace @cooking/web test -- app/shopping-list/productLoading.test.ts app/shopping-list/ProductPicks.test.tsx app/shopping-list/weeeContract.test.ts`

Run: `npm run test:web`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: queued/loading tests prove no false empty; all commands exit 0.

- [ ] **Step 6: Commit integrated web loading**

```bash
git add apps/web/app/shopping-list/page.tsx apps/web/app/shopping-list/ProductPicks.tsx apps/web/app/shopping-list/ProductPicks.test.tsx packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(shopping): load Weee picks in visual order"
```

---

### Task 4: Backend test foundation and strict 24-hour freshness

**Files:**
- Create: `backend/requirements-dev.txt`
- Create: `backend/pytest.ini`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_store_cache.py`
- Modify: `backend/app/db/repo_store_cache.py`
- Modify: `backend/app/services/store_scraper.py`

**Interfaces:**
- Produces: `is_cache_entry_fresh(updated_at, now, max_age_seconds)` and strict memory/DB cache boundaries.
- Consumes later: Weee cache key `(weee, language, CACHE_VERSION, normalized_query)`.

- [ ] **Step 1: Create the isolated backend test environment**

Write `backend/requirements-dev.txt`:

```text
pytest==8.3.3
pytest-asyncio==0.24.0
```

Write `backend/pytest.ini`:

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
```

Run:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
```

- [ ] **Step 2: Write failing exact-expiry and cache-hit tests**

```py
from datetime import datetime, timedelta, timezone
from app.db.repo_store_cache import is_cache_entry_fresh

def test_cache_entry_expires_at_exactly_24_hours():
    now = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    assert is_cache_entry_fresh(now - timedelta(seconds=86399), now, 86400)
    assert not is_cache_entry_fresh(now - timedelta(seconds=86400), now, 86400)
```

Add async service tests that monkeypatch PostgreSQL lookup, upsert, and the scrape function. A fresh memory hit must call neither PostgreSQL nor scrape. A fresh PostgreSQL hit must repopulate memory and skip scraping. An expired row must reach scraping and never be returned. A positive scrape must call upsert with `store="weee"` before resolving, and a second caller must receive the positive cached result without another scrape.

- [ ] **Step 3: Run the backend tests to verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_store_cache.py -q`

Expected: FAIL because `is_cache_entry_fresh` and the testable Weee lookup boundary do not exist.

- [ ] **Step 4: Implement strict freshness in both cache layers**

Add:

```py
def is_cache_entry_fresh(
    updated_at: datetime,
    now: datetime,
    max_age_seconds: int,
) -> bool:
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    return now - updated_at < timedelta(seconds=max_age_seconds)
```

Use it in `get_cached_store_products`. For memory, retain the equivalent strict expression `time.time() - timestamp < CACHE_TTL_SECONDS`; pop and miss at equality or greater. Do not return stale fallback data after a refresh failure.

- [ ] **Step 5: Run the strict freshness tests to verify GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_store_cache.py -q`

Expected: freshness, memory-hit, PostgreSQL-hit, and expired-miss tests PASS.

- [ ] **Step 6: Commit the cache boundary**

```bash
git add backend/requirements-dev.txt backend/pytest.ini backend/tests/conftest.py backend/tests/test_store_cache.py backend/app/db/repo_store_cache.py backend/app/services/store_scraper.py
git commit -m "test(cache): enforce strict product freshness"
```

---

### Task 5: Weee scraper single-flight, bounded concurrency, and typed failures

**Files:**
- Modify: `backend/app/services/store_scraper.py`
- Modify: `backend/tests/test_store_cache.py`

**Interfaces:**
- Produces: `fetch_store_products(query, session=None, *, force_refresh=False)`, `StoreScrapeError`, and a per-process `dict[CacheKey, asyncio.Task]` registry.
- Removes: Amazon store types, URL/selector branches, extraction script, normalizer branch, and `fetch_amazon_products`.

- [ ] **Step 1: Write failing simultaneous-miss and failure tests**

Use an `asyncio.Event` to hold a monkeypatched `_scrape_weee_products`. Start five `fetch_store_products("tofu")` tasks, release the event, and assert the patched scraper was awaited once and all five callers received the same products.

Start six distinct normalized queries with a patched scraper that records active calls; assert peak activity is four. Add a test where the scraper raises `StoreScrapeError`; assert all waiters receive the failure and a later retry invokes a fresh task. Seed a positive database row, then force an empty refresh and a failed refresh; in both cases assert the cache persistence helper is not called and the positive row remains unchanged. Use `caplog` to assert cache-hit, single-flight-wait, scrape-success, scrape-empty, and scrape-failure event names are distinguishable.

- [ ] **Step 2: Run simultaneous-miss tests to verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_store_cache.py -q -k 'single_flight or scrape_ceiling or failed_flight'`

Expected: FAIL because duplicate misses currently scrape independently and failures collapse to empty lists.

- [ ] **Step 3: Remove Amazon and isolate the Weee scrape operation**

Set `StoreName = Literal["weee"]`, keep the cache DB key value `weee`, and make `prepare_store_query(query)` infer `en`/`zh` without a store argument. Remove all Amazon constants and extraction/normalization branches. Rename the live operation to `_scrape_weee_products(cleaned_query, language)`; it returns a valid list, returns `[]` only for a completed empty Weee result, and raises `StoreScrapeError` for missing Playwright, navigation/extraction failure after retries, or invalid upstream payload.

```py
StoreName = Literal["weee"]
CacheKey = tuple[StoreName, str, str, str]

class StoreScrapeError(RuntimeError):
    pass

def prepare_store_query(query: str) -> tuple[str, str] | None:
    original = _clean_query(_normalize_space(query))
    cleaned = (_clean_query(_clean_search_query(query)) or original).lower().strip()
    if not cleaned:
        return None
    return cleaned, "zh" if _query_has_cjk(cleaned) else "en"

async def fetch_store_products(
    query: str,
    session: AsyncSession | None = None,
    *,
    force_refresh: bool = False,
) -> list[dict[str, str]]:
    prepared = prepare_store_query(query)
    if prepared is None:
        return []
    cleaned_query, language = prepared
    cache_key: CacheKey = ("weee", language, CACHE_VERSION, cleaned_query)
    if not force_refresh:
        memory = _memory_cache_get(cache_key)
        if memory is not None:
            return memory
        if session is not None:
            persisted = await repo_store_cache.get_cached_store_products(
                session,
                query=cleaned_query,
                store="weee",
                language=language,
                cache_version=CACHE_VERSION,
                max_age_seconds=CACHE_TTL_SECONDS,
            )
            if persisted is not None:
                _memory_cache_set(cache_key, persisted)
                return persisted

    async def scrape_and_persist() -> list[dict[str, str]]:
        products = await _scrape_weee_products(cleaned_query, language)
        if products:
            await _persist_positive_result(cleaned_query, language, products)
            _memory_cache_set(cache_key, products)
        return products

    return await _join_or_start_scrape(cache_key, scrape_and_persist)
```

`_persist_positive_result` must open a short independent session from `db_session.async_session_maker`, call `upsert_cached_store_products`, and commit before returning. The single-flight task must not capture or retain the first caller's request-scoped session; that session is used only for the caller's initial PostgreSQL cache read. Tests monkeypatch the independent persistence helper.

```py
async def _persist_positive_result(
    cleaned_query: str,
    language: str,
    products: list[dict[str, str]],
) -> None:
    maker = db_session.async_session_maker
    if maker is None:
        raise RuntimeError("Database session maker is not initialized.")
    async with maker() as write_session:
        await repo_store_cache.upsert_cached_store_products(
            write_session,
            query=cleaned_query,
            store="weee",
            language=language,
            cache_version=CACHE_VERSION,
            data=products,
        )
        await write_session.commit()
```

- [ ] **Step 4: Implement cancellation-safe keyed single-flight**

Use:

```py
CacheKey = tuple[str, str, str, str]
_inflight: dict[CacheKey, asyncio.Task[list[dict[str, str]]]] = {}
_inflight_lock = asyncio.Lock()

async def _join_or_start_scrape(cache_key: CacheKey, operation):
    async with _inflight_lock:
        task = _inflight.get(cache_key)
        leader = task is None
        if task is None:
            task = asyncio.create_task(operation())
            _inflight[cache_key] = task
    try:
        return await asyncio.shield(task)
    finally:
        if leader:
            async with _inflight_lock:
                if _inflight.get(cache_key) is task:
                    _inflight.pop(cache_key, None)
```

The operation enters the existing global four-slot semaphore, scrapes Weee, validates/deduplicates products, commits positive results through the independent writer session, updates memory, and returns. Empty and exceptions do not call the persistence helper. Emit structured log fields for `memory_hit`, `postgres_hit`, `cache_miss`, `single_flight_wait`, `scrape_success`, `scrape_empty`, `scrape_failure`, and elapsed milliseconds.

- [ ] **Step 5: Run the complete backend cache suite**

Run: `cd backend && .venv/bin/python -m pytest tests/test_store_cache.py -q`

Expected: identical misses scrape once, distinct queries peak at four, failures propagate, retries are unblocked, and strict cache tests remain green.

- [ ] **Step 6: Commit single-flight and Weee-only scraping**

```bash
git add backend/app/services/store_scraper.py backend/tests/test_store_cache.py
git commit -m "feat(cache): deduplicate Weee scrape misses"
```

---

### Task 6: Weee-only routes, resilient daily warmer, and admin view

**Files:**
- Modify: `backend/app/api/routes_store.py`
- Modify: `backend/app/api/admin.py`
- Modify: `backend/app/db/repo_store_cache.py`
- Modify: `backend/app/jobs/cache_warmer.py`
- Modify: `backend/app/jobs/cache_warmer_queries.py`
- Create: `backend/tests/test_store_routes.py`
- Create: `backend/tests/test_cache_warmer.py`
- Modify: `apps/web/app/preview/page.tsx`

**Interfaces:**
- Consumes: Task 5 `fetch_store_products(query, session, force_refresh=False)` and `prepare_store_query(query)`.
- Produces: public Weee-only route validation, admin Weee-only filtering/refresh, and warmer summary `{cache_hit, cache_miss, skipped, failed, total}`.

- [ ] **Step 1: Write failing route and warmer tests**

Route tests call `store_products` directly with dummy authenticated user/session. Assert omitted store and `store="weee"` call `fetch_store_products(query, session=session)`. Assert `store="amazon"` raises `HTTPException` with status 400 before the fetch mock is called.

Warmer tests monkeypatch `ALL_QUERIES` to four values and `warm_cache_query` so one raises. Track active calls, assert peak is two, remaining queries complete, and summary is:

```py
{
    "cache_hit": 1,
    "cache_miss": 2,
    "skipped": 0,
    "failed": 1,
    "total": 4,
}
```

Patch `AsyncIOScheduler` with a recording fake, call `start_scheduler()`, and assert `add_job` receives `trigger="interval"`, `hours=24`, `max_instances=1`, and `coalesce=True`; also assert the startup trigger is stale-only.

- [ ] **Step 2: Run route and warmer tests to verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_store_routes.py tests/test_cache_warmer.py -q`

Expected: FAIL because Amazon is accepted and one warmer exception currently aborts `gather`.

- [ ] **Step 3: Enforce Weee at public and admin boundaries**

In `/store-products`, normalize the optional legacy `store` query and accept only empty/omitted or `weee`; respond 400 to every other value. Call `fetch_store_products(query, session=session)` without a store argument.

```py
normalized_store = (store or "weee").strip().lower()
if normalized_store != "weee":
    raise HTTPException(status_code=400, detail="Unsupported store. Use weee.")
return await fetch_store_products(query, session=session)
```

Remove `store` from `CacheRefreshOneBody`; admin refresh-one always prepares and fetches Weee. Extend repository list/count functions with `store: str | None = None`, and have all admin preview queries pass `store="weee"` so historical Amazon rows remain stored but invisible and unreachable.

- [ ] **Step 4: Make the warmer Weee-only, two-wide, and failure tolerant**

Set `PRECOMPUTE_CONCURRENCY = 2` and keep `DEFAULT_STORE = "weee"` only if required for database keys; remove public warmer store parameters. Extend `WarmStatus` with `failed`. Catch exceptions inside each `warm` task, increment `failed`, log the query, call progress, and let all other tasks continue. Keep scheduled refresh at 24 hours with `force_refresh=True`; keep startup stale-only.

```py
PRECOMPUTE_CONCURRENCY = 2
WarmStatus = Literal["skipped", "cache_hit", "cache_miss", "failed"]

async def warm(index: int, query: str) -> None:
    nonlocal completed
    async with semaphore:
        try:
            status, _ = await warm_cache_query(query, force_refresh=force_refresh)
        except Exception:
            logger.exception("cache warmer query failed", extra={"query": query})
            status = "failed"
        summary[status] += 1
        completed += 1
        _warmer_status.update({"current": completed, "last_query": query, "last_status": status})
        if progress_callback is not None:
            result = progress_callback(index, summary["total"], query, status)
            if inspect.isawaitable(result):
                await result
```

Update preview status typing/rendering to display the failed count and remove all store filters or refresh store fields.

- [ ] **Step 5: Run backend, web, and static contract gates**

Run: `cd backend && .venv/bin/python -m pytest -q`

Run: `npm run test:web`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run:

```bash
! rg -n 'SUPPORTED_STORES|fetch_amazon_products|"amazon"|Amazon' backend/app/services/store_scraper.py backend/app/api/routes_store.py backend/app/api/admin.py backend/app/jobs
```

Expected: all tests/typechecks pass and active backend product code contains no Amazon branch.

- [ ] **Step 6: Commit route and warmer behavior**

```bash
git add backend/app/api/routes_store.py backend/app/api/admin.py backend/app/db/repo_store_cache.py backend/app/jobs/cache_warmer.py backend/app/jobs/cache_warmer_queries.py backend/tests/test_store_routes.py backend/tests/test_cache_warmer.py apps/web/app/preview/page.tsx
git commit -m "feat(cache): warm fresh Weee results daily"
```

---

### Task 7: CI, full release gate, and coordinated rollout checklist

**Files:**
- Modify: `.github/workflows/frontend-ui.yml`
- Modify: `backend/README.md`
- Create: `docs/qa/2026-08-15-web-planner-weee-cache-checklist.md`

**Interfaces:**
- Consumes: both implementation plans in this project.
- Produces: required backend CI and an evidence checklist for coordinated Vercel/AWS deployment.

- [ ] **Step 1: Add a failing backend CI expectation locally**

Run: `rg -n 'pytest|setup-python' .github/workflows/frontend-ui.yml`

Expected: no backend pytest job is present.

- [ ] **Step 2: Add the backend CI job**

Add a sibling `backend` job using `actions/checkout@v4`, `actions/setup-python@v5` with Python 3.12 and pip cache, install `backend/requirements.txt` plus `backend/requirements-dev.txt`, then run `cd backend && python -m pytest -q`. Keep the existing frontend UI job unchanged except for any planner baseline files it now validates.

```yaml
  backend:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: |
            backend/requirements.txt
            backend/requirements-dev.txt
      - run: pip install -r backend/requirements.txt -r backend/requirements-dev.txt
      - run: cd backend && python -m pytest -q
```

Document the same test setup and command in `backend/README.md`.

- [ ] **Step 3: Create the production evidence checklist**

The checklist must record commit SHA and deployment URLs, then require evidence for:

- `/planner` at 1280×800 has no document scroll and all seven days/21 slots are visible;
- the recipe rail scrolls internally and add/remove/open/overflow interactions work;
- a curated common Weee ingredient returns immediately;
- a new ingredient waits once, persists, and returns immediately on a second authenticated request;
- a result exactly 24 hours old is rejected in automated tests;
- `store=amazon` returns HTTP 400;
- warmer status reports hits/misses/failures and continues after a failed query;
- interactive plus warmer activity never exceeds four live scrapes; and
- production contains no Amazon store selector on web or iOS.

- [ ] **Step 4: Run the complete local acceptance sequence**

Run: `npm run tokens:test`

Run: `npm run tokens:build`

Run: `git diff --exit-code packages/design-tokens/src/generated apps/web/app/generated apps/mobile/src/generated`

Run: `npm run test:web`

Run: `npm run test:mobile`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Run: `npm run web:build`

Run: `PORT=3100 npm --workspace @cooking/web run test:e2e`

Run: `cd backend && .venv/bin/python -m pytest -q`

Run: `git diff --check`

Expected: every command exits 0 with no failed test or screenshot comparison.

- [ ] **Step 5: Perform the focused Amazon-removal scan**

Run:

```bash
! rg -n 'ProductStore|PRODUCT_STORES|PRODUCT_STORE_LABELS|SUPPORTED_STORES|fetch_amazon_products|"amazon"|Amazon' packages apps backend/app --glob '!backend/app/services/storage_service.py' --glob '!**/node_modules/**' --glob '!**/.next/**'
```

Run: `rg -n 'amazonaws\.com' backend/app/services/storage_service.py`

Expected: active product-store scan has no matches; the intentional S3 URL remains.

- [ ] **Step 6: Commit CI and QA documentation**

```bash
git add .github/workflows/frontend-ui.yml backend/README.md docs/qa/2026-08-15-web-planner-weee-cache-checklist.md
git commit -m "ci: gate planner and Weee cache release"
```

- [ ] **Step 7: Deploy only after merge approval and verify both tiers**

Push the reviewed branch and open a pull request. After checks pass and the user approves merge, deploy the backend commit to the existing AWS service before or together with the Vercel frontend because the client signature and store options change together. Record the AWS deployment identifier, Vercel production deployment URL, `chef-world.com` smoke-test timestamp, and each production checklist result in the QA document; commit only factual evidence collected after deployment.
