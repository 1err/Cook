# Weee Scraping Reliability Design

**Date:** 2026-08-27

**Status:** Approved in chat; awaiting written-spec review

## Summary

Chef World's store-product workflow will be rebuilt around one reliable live Weee lookup. A single ingredient lookup must either return up to three validated Weee product choices, return a confirmed genuine no-results response, or return an explicit retryable service failure after internal recovery attempts. A transient navigation, hydration, browser, or parsing problem must not be reported as "no products," and the user must not need to press Retry merely because the first browser attempt was slow.

Bulk shopping-list loading will reuse that same primitive for any number of ingredients. Fresh cache entries will be loaded in one batch and rendered immediately. Only cache misses will enter an ordered, serial live-scrape queue. The configured daily warmer will use the same queue at background priority. Cache entries remain eligible for display for strictly less than 24 hours; expired products are never returned as fallback.

## Evidence and Root Cause

The intermittent behavior was reproduced in production logs and ECS metrics on 2026-08-27 (Asia/Shanghai):

- The deployed backend task has 0.5 vCPU and 1 GB memory.
- A bulk lookup produced several simultaneous cache misses while the background warmer was also scraping.
- Each active scrape could open a search page and three concurrent product-detail pages. Four live scrapes could therefore create roughly sixteen active Weee pages in one shared Chromium process.
- Service memory rose from about 60 percent to 95-100 percent. Playwright `page.goto` calls timed out, uncaught `StoreScrapeError` exceptions became HTTP 500 responses, load-balancer health checks failed, and the ECS container exited with code 137.
- The replacement task immediately started the cache warmer. During the same user workflow, first attempts timed out or failed while later attempts returned memory-cache hits and HTTP 200 responses.
- A selector timeout is currently swallowed. An unexplained empty DOM can consequently become a normal empty product response even though a fresh browser attempt later finds products.

Parallel cache reads were not the problem. Parallel live Chromium work exceeded the CPU and memory available to the single backend task and increased burst traffic to Weee. The redesign therefore separates cheap parallel/batch cache access from resource-bounded live scraping.

## Goals

- Make one uncached ingredient lookup reliable without requiring a user-initiated retry for a transient first attempt.
- Return up to three safe, browser-navigable Weee product choices when Weee exposes them.
- Distinguish a confirmed Weee no-results page from navigation, hydration, challenge, and parser failures.
- Keep cache freshness strict: an entry is valid only while its age is less than 86,400 seconds.
- Load fresh cached products for an arbitrary-length shopping list immediately through one batch cache read.
- Process only cache misses through one ordered live-scrape worker, with no shopping-list item-count cap.
- Give interactive misses priority over background warming.
- Keep web and mobile behavior compatible so either client cannot recreate backend scraper fan-out.
- Make scraper attempts, queueing, cache outcomes, and failures diagnosable from production logs.
- Split scraping, orchestration, persistence, and HTTP concerns into focused modules with explicit interfaces.

## Non-goals

- Semantic ingredient normalization or aliasing. The system will not map `garlic cloves`, `two cloves garlic`, or `fresh garlic` to `garlic` in this project.
- Rewriting or improving the smart shopping list produced upstream.
- Serving stale products after the 24-hour cache boundary.
- Adding a fixed maximum such as 50 ingredients to bulk loading.
- Tracking per-user ingredient history, query popularity, or automatically evolving the warmer catalog.
- Adding an external scraping vendor, distributed task queue, or horizontally scaled scraper service.
- Guaranteeing that Weee itself is always reachable. Repeated upstream failure will remain a truthful, explicit error after bounded internal retries.

## Query Identity

The shopping-list ingredient is already the search input. Query preparation may only perform mechanical identity cleanup:

- trim leading and trailing whitespace;
- collapse repeated internal whitespace;
- use a case-insensitive form for cache and single-flight identity; and
- detect CJK text to select the existing English or Chinese Weee search route.

The exact mechanically cleaned ingredient text is sent to Weee. Preparation must not remove quantities, descriptors, preparation words, or ingredient modifiers, and must not consult an alias table. Duplicate mechanically identical items may share one lookup, but the system must not merge semantically similar strings.

## Architecture

### Focused backend boundaries

The current `store_scraper.py` mixes browser lifecycle, DOM extraction, retry behavior, cache policy, persistence, concurrency, and single-flight coordination. It will be separated into these responsibilities:

- `weee_scraper.py`: one live query, browser/context lifecycle, page classification, DOM extraction, product validation, and bounded internal retries.
- `store_product_service.py`: query identity, L1/L2 cache lookup, strict freshness, per-key single-flight, interactive/background priority, and positive-result publication.
- `repo_store_cache.py`: batch and single-row PostgreSQL reads plus positive upsert operations.
- `routes_store.py`: request validation, response shaping, batch-cache endpoint, and typed HTTP error mapping.
- `cache_warmer.py`: daily traversal of the configured catalog through the background-priority service interface.

Compatibility imports may temporarily remain in `store_scraper.py` if needed to avoid an unsafe flag-day change, but production responsibilities must live behind the new focused interfaces.

### Reliable single-query scraper

For one mechanically cleaned query:

1. Obtain the shared Chromium browser, relaunching it if it is absent or disconnected.
2. Create one isolated browser context and one search page.
3. Navigate to the language-appropriate Weee search URL and retain the navigation response.
4. Wait for one of three classified outcomes:
   - a product-result selector is present;
   - an explicit Weee no-results state is present; or
   - the attempt times out or exposes a challenge/error state.
5. For a result page, extract search cards, validate official HTTPS Weee product URLs, deduplicate by stable URL/name, and continue the existing bounded scroll behavior only when needed to obtain up to three valid choices.
6. Return fewer than three choices only when the rendered result set genuinely exposes fewer than three valid products.
7. Close the page and context in `finally` on every outcome.

Normal results will use search-card name, price, image, and product link data. The scraper will not open parallel product-detail pages. Detail-page enrichment is removed from the request path because it is optional presentation enrichment and was the largest page-count multiplier.

### Page outcome classification

The scraper may return an empty list only after recognizing an explicit Weee no-results state. These conditions are failures, not empty results:

- navigation timeout or HTTP error;
- final navigation to a challenge, verification, or unexpected route;
- access-denied, CAPTCHA, or verification content;
- product selector absent without an explicit no-results marker;
- non-list extraction payload;
- a non-empty payload from which no safe valid product can be produced; or
- browser/context disconnection.

This removes the existing path where selector timeout is logged and swallowed before an unexplained empty DOM becomes a normal empty response.

### Internal recovery

A single API lookup owns bounded recovery; the user does not initiate attempt two:

- use at most three attempts;
- create a fresh context for every attempt;
- apply short increasing backoff with jitter between attempts;
- relaunch the shared browser when it is disconnected or a browser-level failure indicates it is unhealthy; and
- stop retrying immediately for a confirmed no-results page.

If a later attempt succeeds, the original API request succeeds and publishes the positive result once. If every attempt fails, the service raises a typed retryable upstream error. Attempt failures never become cache entries.

### Global live-scrape coordination

Exactly one live Weee scrape may run per backend process. The coordinator also retains per-query single-flight behavior so duplicate requests join the same future.

The coordinator has two priorities:

1. interactive user lookup;
2. background cache warming.

A warmer item already being scraped may finish, but the warmer must not take the next slot while interactive work is waiting. This protects user latency without reintroducing parallel Chromium work. The design does not cap the number of shopping-list ingredients; it bounds only the number of expensive live browser operations.

## Cache Contract

### Strict freshness

- `CACHE_TTL_SECONDS` remains 86,400.
- A row is fresh only when `now - updated_at < 86,400 seconds`.
- A row exactly 24 hours old is expired.
- Expired L1 and L2 data is never included in an API response.
- A failed refresh does not delete or overwrite the previous positive database row, but that expired row remains ineligible for display.
- Empty results and failures are not persisted as 24-hour cache entries.
- A positive scrape is committed to PostgreSQL before it is published to L1 or returned to waiters.

### Batch cache read

A new authenticated endpoint accepts an arbitrary-length list of ingredient queries and performs cache work only; it never starts live scraping:

```http
POST /store-products/batch
Content-Type: application/json

{"queries":["garlic","ginger","bok choy"]}
```

The response preserves the mechanically cleaned unique query order and reports each entry as fresh or missing:

```json
{
  "entries": [
    {
      "query": "garlic",
      "status": "fresh",
      "products": [
        {"name": "Fresh Garlic", "price": "$1.99", "image": "https://...", "url": "https://www.weee.com/..."}
      ],
      "expires_at": "2026-08-28T00:00:00Z"
    },
    {
      "query": "ginger",
      "status": "missing",
      "products": [],
      "expires_at": null
    }
  ]
}
```

There is no business-level ingredient-count cap. Normal HTTP request-size and infrastructure protections still apply. Invalid or blank entries are ignored rather than sent to the scraper.

The existing `GET /store-products?query=` endpoint remains the single-query cache-or-live lookup. Existing explicit legacy `store=weee` compatibility remains unchanged.

## Bulk Client Flow

Web and mobile use the same behavior for any number of visible unchecked ingredients:

1. Build the existing visually ordered, mechanically deduplicated query list.
2. Mark rows queued and open their product panels.
3. Send the complete query list to `/store-products/batch`.
4. Publish every fresh result immediately with its authoritative expiry.
5. Retain missing rows in their original order.
6. Use one worker to call the existing single-query endpoint for each miss.
7. Publish progress after each miss reaches success, confirmed empty, or terminal error.

No live lookup concurrency greater than one remains in web or mobile. Cache speed comes from the single batch read, not from opening many HTTP requests. Individual panel loading and Retry use the same single-query service and its internal retry behavior.

Client session/ephemeral cache hydration retains the current authoritative-expiry validation. Expired client entries are dropped and included as misses in the next batch.

## Daily Warmer

- The configured common-ingredient catalog remains unchanged in this project.
- The daily warmer force-refreshes entries serially through the background-priority service API.
- The warmer no longer launches two simultaneous browser scrapes.
- Backend startup does not immediately launch a live-scrape sweep. PostgreSQL survives task replacement, and an automatic startup sweep previously amplified crash recovery into another resource spike.
- The scheduled warmer and manual admin refresh continue after individual typed failures and report success, confirmed empty, and failure separately.
- Interactive requests are serviced before the next background query.

No popularity collection, catalog expansion, or semantic aliasing is added here. Those can be designed independently later.

## Error and HTTP Behavior

- A confirmed no-results page returns HTTP 200 with `products: []` and `expires_at: null`.
- Exhausted transient Weee/browser failures map to HTTP 503 with a stable machine-readable detail and `Retry-After` guidance.
- Invalid request data remains HTTP 4xx.
- Scraper exceptions must not escape as generic ASGI 500 stack traces.
- The UI continues to distinguish queued, loading, empty, and error states.
- A normal first-attempt failure followed by internal success never enters the visible error state.
- After a true 503, Retry re-enters the same cache, single-flight, priority, and internal-recovery flow.

## Observability

The current logging formatter does not include structured `extra` fields in CloudWatch messages. Store-product logs will therefore emit parseable message content containing at least:

- event name;
- mechanically cleaned query;
- language and cache version;
- cache source (`memory`, `postgres`, or `miss`);
- queue priority and queue-wait milliseconds;
- scrape attempt number;
- classified attempt outcome;
- elapsed milliseconds;
- returned valid-product count; and
- terminal error type without credentials, cookies, or page content.

The warmer summary retains hit/miss/failure counts. Logs must make one client request with multiple internal attempts distinguishable from separate user retries.

## Testing Strategy

### Backend unit and service tests

- A fresh L1 or L2 entry returns without entering the scrape queue.
- An entry at 86,399 seconds is eligible; one at exactly 86,400 seconds is not.
- Expired products are not returned after refresh failure.
- Attempt one navigation failure followed by attempt two success returns products from the original service call.
- Attempt one unexplained empty DOM followed by attempt two success is treated as recovery, not a confirmed empty result.
- An explicit no-results page returns an empty result without further attempts.
- Challenge, selector timeout, invalid payload, and browser disconnect are retryable failures.
- All attempts close their context and page.
- Search-card extraction returns up to three safe unique product links without opening product-detail pages.
- Distinct simultaneous misses never create more than one active live scrape.
- Duplicate simultaneous queries share one scrape.
- Interactive work runs before the warmer's next queued item.
- Positive persistence completes before L1 publication and waiter resolution.
- Batch cache lookup preserves input order, mechanically deduplicates, accepts more than 50 entries, and does not invoke the scraper.
- `StoreScrapeError` maps to HTTP 503; confirmed empty remains HTTP 200.

### Web and mobile tests

- Bulk load publishes all fresh batch results before starting a miss.
- Missing queries start in visual order with exactly one active single-query request.
- An arbitrary list larger than 50 is fully queued rather than truncated.
- Progress counts cached and live terminal results correctly.
- A transient backend attempt recovered inside one HTTP call never renders `Could not load products from Weee.`
- A true 503 renders the error state and Retry performs a new request.
- Strict server and client expiries trigger a new lookup at the 24-hour boundary.
- Week/generation changes prevent late results from mutating the wrong shopping list.

### Verification gates

- Focused backend cache, route, scraper, and warmer pytest suites.
- Complete backend pytest suite.
- Focused web shopping-list Vitest suite and complete web suite.
- Focused mobile shopping tests and complete mobile Jest suite.
- Web and mobile TypeScript checks.
- Next.js production build.
- Shopping-list browser test covering batch hits, serial misses, progress, and Retry.
- A production-like cold-cache stress test proving the active live-page count remains one while health checks continue to respond.
- `git diff --check` and documentation consistency review.

## Rollout

Backend ships first because it adds `/store-products/batch` and typed 503 behavior while retaining the existing GET contract. After the backend route is verified, web and mobile clients may use the batch endpoint and serial miss queue.

The deploy smoke check must cover:

1. one known fresh query returning immediately;
2. one novel query succeeding through a live search and returning up to three safe Weee links;
3. a forced first-attempt timeout recovering inside the same logical request in a controlled test environment;
4. a bulk list showing cache hits immediately and processing misses one at a time;
5. strict expiry at 24 hours; and
6. backend health remaining responsive during live scraping and warming.

Changing production ECS CPU or memory may be considered separately as defense in depth, but additional capacity is not the correctness mechanism for this design and is not authorized by this implementation scope.
