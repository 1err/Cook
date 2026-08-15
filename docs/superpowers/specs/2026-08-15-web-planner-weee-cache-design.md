# Web Planner and Weee Product Cache Design

**Date:** 2026-08-15

**Status:** Approved design, awaiting written-spec review

**Branch:** `codex/web-planner-cache-design`

## Summary

This project improves three connected parts of Chef World:

1. The desktop weekly planner will fit inside a 1280×800 viewport without document-level vertical scrolling while preserving the visible saved-recipe rail and drag-and-drop workflow.
2. Web grocery-product loading will begin in the same order the user sees the grocery cards: from the top-left column downward, then through the next column, with four requests in flight at once.
3. Weee becomes the prototype's only product store. Fresh results are shared through the existing memory and PostgreSQL caches for exactly 24 hours; uncached or expired ingredients wait for a live scrape, and successful results become available to every user.

Amazon is removed from active UI, client, shared, and backend code. Existing Amazon cache rows are left untouched but become unreachable.

## Goals

- Fit the complete seven-day planner board at desktop widths of 1280 pixels or greater and viewport heights of 800 pixels or greater.
- Keep the saved-recipe rail visible and independently scrollable on desktop.
- Make planned recipes legible without large image cards consuming most of a meal slot.
- Preserve week navigation, add, remove, recipe opening, drag-and-drop, and accessible click-to-add behavior.
- Start bulk Weee requests in visual reading order while retaining safe concurrency.
- Never render a queued or active lookup as a completed empty result.
- Make every successful new Weee scrape reusable by other users for 24 hours.
- Avoid duplicate simultaneous scrapes for the same normalized query within one backend process.
- Keep daily common-ingredient warming from consuming all interactive scraping capacity.
- Remove Amazon from the prototype without destructive database cleanup.

## Non-goals

- Popularity scoring, per-ingredient hit counts, or ranking the common-ingredient catalog from usage data.
- Prefetching every ingredient immediately when a recipe is imported.
- Serving store prices older than 24 hours.
- Distributed scrape locking across multiple backend processes or hosts. The current AWS deployment is treated as a single backend process for this cycle; PostgreSQL remains the shared result store. Distributed locking can be added when horizontal backend scaling is introduced.
- Redesigning the phone planner. Tablet and phone retain their existing responsive scrolling and picker behavior.
- Deleting historical Amazon rows from PostgreSQL or legacy Amazon product keys from user storage as a migration.

## Current State and Problems

### Planner

The planner root already attempts to use the viewport height, but the main area scrolls. The current desktop layout combines:

- a large title and instructional paragraph;
- separate week-navigation buttons below that copy;
- day headers with generous vertical padding;
- day bodies with a 28rem minimum height; and
- meal cards with a 9rem minimum height and images occupying 65 percent of each card.

At the approved 1280×800 boundary, these minimum sizes push lower meal slots below the fold. The saved-recipe rail is useful and should remain visible, but its current 20rem width and roomy cards also reduce the width available to seven day columns.

### Grocery loading

The bento layout renders `Pantry & Dry Goods` in the left column and the remaining categories in the right column. Bulk lookup currently builds its queue from the shared generic category order, beginning with Produce. As a result, requests do not begin where the user's eye starts.

The client runs three workers even though the backend protects itself with a four-scrape semaphore. Product panels can also be opened before their worker begins, and an undefined result is currently collapsed into an empty array in rendering code. That makes queued ingredients appear to have no products.

### Cache

The current cache already has the right core layers:

- an in-process memory cache;
- a PostgreSQL `cached_store_products` cache shared by users; and
- a scheduled curated-ingredient warmer.

Fresh positive results are stored for 24 hours. However, simultaneous misses for the same ingredient can each scrape because there is no keyed in-flight coordinator. The warmer may create five tasks even though only four scrapes can run, allowing background work to occupy all scrape slots. The code also carries Amazon through shared types, UI toggles, API clients, preview tools, and backend scraping branches even though it is not wanted in the prototype.

## Product Decisions

### Approved planner direction

The approved layout is **Compact board + persistent recipe rail** (Option A from the visual review).

- Desktop keeps the recipe rail visible and retains drag-and-drop.
- Planned recipes use compact horizontal thumbnail-and-title tiles.
- The entire week remains visible in one viewport.
- The recipe rail may scroll internally.
- Narrower tablet and phone layouts may scroll normally.

### Multiple recipes in one meal slot

A slot renders at most two compact tiles. If more recipes are planned, a `+N more` button opens the existing picker-style dialog adapted to list every recipe in that slot, with open and remove actions. This protects the viewport-height contract without hiding that more recipes exist.

### Store scope

Weee is the only store in the prototype. There is no store selector. User-facing copy says Weee directly where the store name is useful.

### Cache freshness

- An entry is fresh only while its age is strictly less than 86,400 seconds.
- At 24 hours or older, it is a miss.
- Expired data is never returned to the user.
- If refreshing an expired ingredient fails, the user sees a retryable failure; the older database row may remain for diagnostics but remains ineligible for display.
- Empty scrape results are not cached, so a temporary upstream failure does not create a 24-hour false negative.

## Planner Architecture

### Desktop viewport shell

At `min-width: 1024px`, the planner page becomes a fixed-height application surface:

- root height: `calc(100dvh - var(--app-header-height))`;
- document-level overflow: hidden for the planner surface only;
- recipe rail: independently scrollable list with fixed controls and footer; and
- board: `min-height: 0` and no vertical scrolling at the 1280×800 acceptance boundary.

The header height will be represented by one shared CSS custom property rather than duplicated numeric offsets. The page does not change global overflow for other routes.

### Component boundaries

`apps/web/app/planner/page.tsx` remains the data and mutation coordinator. Presentational behavior moves into focused planner components:

- `PlannerToolbar`: title, week range, previous/next controls, and Shopping link.
- `PlannerRecipeRail`: fixed search/filter controls, internally scrolling recipes, and fixed New Recipe action.
- `PlannerWeekBoard`: seven-day viewport grid.
- `PlannerDayColumn`: compact day header and three equal meal slots.
- `PlannerMealSlot`: drag/drop target, empty state, planned tiles, add-another action, and overflow count.
- `PlannerMealTile`: thumbnail, two-line title, open action, and remove action.

The page owns recipes, filtering, meal-plan state, optimistic mutations, API calls, and router transitions. Child components receive explicit data and callbacks and do not call APIs directly.

### Layout rules

- Recipe rail width uses a constrained desktop width rather than a fixed 20rem: `clamp(15.5rem, 18vw, 18rem)`.
- The toolbar is one compact row. Long instructional copy is removed from the primary desktop flow; the Shopping link remains directly available.
- The week board uses seven equal columns and the remaining vertical height.
- Each day column uses a compact day header followed by three `minmax(0, 1fr)` meal rows.
- Empty slots show a centered add icon and short accessible label without reserving card-sized minimum heights.
- A populated tile uses a small fixed thumbnail, flexible two-line title, and a remove button that is keyboard reachable and visible on focus.
- Up to two tiles render in a slot. Overflow uses `+N more`.
- The existing dialog/picker remains the non-drag fallback and the small-screen path.

### Accessibility and interaction

- Drag-and-drop is an enhancement, not the only way to plan a meal.
- Every slot retains a button for choosing a recipe.
- Open, remove, add another, and overflow controls have date-and-meal-specific accessible names.
- Focus indicators remain visible inside compact cards.
- The overflow dialog traps focus, closes on Escape, and restores focus to its trigger.
- Recipe images remain decorative when the adjacent title provides the accessible name.

## Grocery Loading Architecture

### Visual queue order

The queue is produced by a pure helper from the same category groups and row arrays used for rendering. Its category order is:

1. `Pantry & Dry Goods`, the top-left/primary column;
2. then the existing secondary-column order: Produce, Dairy, Meat & Seafood, Frozen, Bakery, Other.

Within each category, unchecked visible rows keep their rendered order. Duplicate normalized ingredient names are removed without changing the first occurrence.

This ordering is a page-layout concern and will not change the shared generic `GROCERY_CATEGORY_ORDER`, which is still used by other screens and categorization logic.

### Client state machine

Each ingredient has an explicit state:

- `idle`: panel closed and no request scheduled;
- `queued`: bulk loading opened the panel but no worker has started it;
- `loading`: one of the four workers is requesting it;
- `success`: one or more products returned;
- `empty`: the request completed successfully with zero valid products;
- `error`: the request failed and may be retried.

The bulk action opens all relevant panels and marks their ingredients queued. Four workers consume the ordered queue. A worker changes only its current ingredient to loading. Completion transitions to success, empty, or error. The UI never infers status from `products ?? []`.

The bulk progress indicator reports completed requests out of the deduplicated queue total. Switching weeks or leaving smart mode cancels visible client work by generation/store token so late results cannot update the wrong list.

### Concurrency

The web client uses four workers. The backend retains a global per-process scrape semaphore of four. Starting more client workers would not improve uncached throughput and would increase waiting HTTP requests. Cached requests within a four-item wave will complete quickly and allow the next ordered item to start.

The daily warmer is reduced to at most two active warm queries, leaving capacity for interactive requests even while warming is underway.

## Weee-only API and Cache Architecture

### API contract

- The shared `ProductStore` union, `PRODUCT_STORES`, and Amazon label are removed.
- Web and mobile store selectors are removed.
- The API client exposes `storeProducts(query)` without a store argument.
- `/store-products` defaults internally to Weee. A legacy `store=weee` query remains accepted during the transition; `store=amazon` returns HTTP 400.
- Admin/preview controls show Weee only.
- Backend `StoreName`, supported-store lists, URL tables, selectors, normalizers, and fetch helpers remove Amazon branches.
- The database `store` key remains because it is already part of the cache primary key and preserves future extensibility. All new active rows use `weee`.

Existing Amazon database rows are not deleted. Existing client-side Amazon product keys become unreachable. Cleanup code may remove known legacy client keys opportunistically, but no user data migration is required for correctness.

### Lookup flow

For normalized key `(weee, language, cache_version, query)`:

1. Check the in-process memory cache. Return immediately if fresh.
2. Check PostgreSQL. If fresh, repopulate memory and return immediately.
3. If a matching scrape is already in flight in this backend process, await that task.
4. Otherwise register one in-flight task, enter the four-scrape semaphore, and scrape Weee.
5. On a positive valid result, update memory and upsert PostgreSQL before resolving waiting callers.
6. On empty or failure, do not overwrite a positive cached row. Return the terminal empty result or propagate a typed failure for the UI.
7. Remove the in-flight task in `finally` so retries cannot become permanently blocked.

The in-flight registry is protected against races and keyed after query normalization, so equivalent quantity-decorated queries converge on the same work.

### Daily common-ingredient warmer

- The existing curated common-ingredient catalog remains the source of proactive queries.
- The scheduler runs every 24 hours and warms Weee only.
- Scheduled refresh uses the same lookup normalization, persistence, scrape semaphore, and single-flight path as interactive traffic.
- Startup remains stale-only: fresh entries are hits; missing or expired common entries are fetched.
- The daily job force-refreshes the curated list but never serves its expired predecessor while refreshing.
- Warm concurrency is two, not five, to protect interactive capacity.
- A failed warm query is logged and counted but does not stop the remaining catalog.

The job is best effort. If it is delayed or a common query fails, the strict 24-hour rule wins: the next user waits for fresh data.

### Observability

Structured logs and warmer status distinguish:

- memory hit;
- PostgreSQL hit;
- cache miss;
- single-flight wait;
- scrape success, empty, and failure;
- request latency; and
- warmer completed, failed, and skipped counts.

No per-user ingredient history or popularity analytics are stored in this cycle.

## Error Handling

- Planner optimistic updates keep the current behavior but must restore the previous slot state and show a non-blocking error if the meal-plan write fails. Compact layout work must not silently preserve a failed optimistic state.
- A queued grocery row displays `Waiting to load from Weee…`.
- An active row displays `Finding matches on Weee…` with a progress indicator.
- A completed empty row displays `No products found on Weee` and Retry.
- A failed row displays a concise error and Retry.
- Retry re-enters the same cache/single-flight flow and cannot bypass the backend semaphore.
- Invalid or legacy Amazon requests receive a clear 400 response and never reach the scraper.

## Testing Strategy

### Web unit/component tests

- Queue builder returns Pantry rows first, then the secondary column in visual category order.
- Queue builder preserves row order, excludes checked/hidden items, and deduplicates names stably.
- Four-worker runner never exceeds four active calls and starts work in queue order.
- Queued and loading states do not display the empty message.
- Empty and error states display their correct retryable terminal UI.
- Shopping UI and supporting preview tools contain no Amazon selector or label.
- Planner renders compact tiles, two visible recipes plus `+N more`, accessible slot controls, and the overflow dialog.
- Planner mutations retain add, remove, open, and fallback picker behavior.

### Browser tests

At a deterministic 1280×800 desktop viewport with fixture API data:

- `document.documentElement.scrollHeight <= window.innerHeight` on `/planner`;
- all seven day headers and breakfast/lunch/dinner slots are visible;
- the saved-recipe rail scrolls internally when populated;
- empty, single-recipe, two-recipe, and overflow slots match approved visual baselines;
- keyboard focus reaches add, tile, remove, and overflow actions;
- drag/drop and click-to-add both update the correct slot; and
- tablet/phone layouts remain usable with normal page scrolling.

### Backend tests

The repository currently has no tracked backend source tests, so this cycle creates a pytest suite for the cache boundary:

- fresh memory hit does not access PostgreSQL or scrape;
- fresh PostgreSQL hit repopulates memory and does not scrape;
- an entry exactly 24 hours old is expired;
- an expired or missing entry scrapes and persists a positive result;
- empty and failed scrapes do not overwrite a positive row;
- simultaneous identical misses invoke the scraper once per backend process;
- different normalized queries respect the four-scrape ceiling;
- the warmer uses Weee only, runs at concurrency two, and continues after individual failures;
- `store=amazon` returns 400 without invoking the scraper; and
- common Weee entries under 24 hours return immediately.

### Gates

- Web Vitest suite.
- Mobile Jest suite because shared store types and mobile shopping UI change.
- Web and mobile TypeScript checks.
- New backend pytest suite.
- Next.js production build.
- Playwright planner tests at desktop, tablet, and phone breakpoints.
- Existing authenticated-shell visual/accessibility gate.
- `git diff --check` and focused scans confirming Amazon product-store code is removed while unrelated AWS `amazonaws.com` storage URLs remain intact.

## Rollout and Compatibility

Frontend, shared packages, and backend changes should ship as one coordinated release because the API client signature and store options change together. The backend remains tolerant of an explicit `store=weee` during rollout. It rejects Amazon rather than silently mapping it to Weee.

No database migration is required. Existing Weee rows continue to work because their primary keys and data schema do not change. Cache version changes only if product normalization or output semantics change during implementation; UI-only changes do not invalidate product rows.

After deployment:

1. verify planner height and interactions on production at 1280×800;
2. verify a known common Weee ingredient is a cache hit;
3. verify a new ingredient waits once, persists, and is instant on the next authenticated request;
4. verify an Amazon request receives 400;
5. inspect warmer status and runtime logs for hit/miss/failure counts; and
6. confirm backend scrape concurrency does not exceed four during a bulk load plus warmer activity.

## Deferred Follow-up

When the recipe catalog and real usage are large enough, a separate design can add:

- query hit counts and last-access timestamps;
- a popularity-ranked warm set;
- proactive warming of normalized ingredients from newly imported public recipes;
- distributed scrape locking for horizontally scaled backend instances; and
- measured cache-coverage targets such as the proposed 90 percent instant-hit rate.

Those features require real usage data and are intentionally outside this cycle.
