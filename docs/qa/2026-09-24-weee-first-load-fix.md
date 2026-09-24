# Weee first-load expiry correction

Local fix based on deployed source `a590b3b`, isolated on `codex/weee-first-load-fix-20260924`. No production deployment has been performed for this fix.

## Evidence

- Read-only production inspection confirmed API `cooking-backend:13` and worker `cooking-store-worker:1` on September 24.
- In the screenshot interval, cold queries for 淀粉 and 老抽 completed with HTTP 200 at 17:41:40 and 17:41:52 UTC. Retries at 17:42:46 were fresh PostgreSQL hits. Other cold lookups in the same interval also returned 200; the observed UI failure was not an HTTP scraper error.
- Bounded public API Date-header probes showed the API clock approximately 1–2 seconds ahead of the local device (HTTP Date has one-second resolution).
- The original client rejects any expiry more than 24 hours ahead of its own clock. A deterministic reproduction with an otherwise valid response at device-now + 24 hours + 1.5 seconds produced an error; advancing the device clock two seconds accepted the identical response.
- Durable worker responses also bypassed the existing database-age-to-API-clock translation by returning raw job timestamps. The regression reproduces this with database clocks both ahead and behind the API.

## Change

The API now returns its response time alongside expiry. Web and mobile translate remaining lifetime to the device clock before existing product validation and local persistence, conservatively charging request latency. Metadata is removed after translation. Strict expiry, product URL checks, selections, serial lookup, and legacy response compatibility remain covered. A stale entry in a batch becomes a miss without discarding valid neighboring hits.

Durable positive completions read the current fresh database winner through the ordinary timestamp translation. They do not replay obsolete products or timestamps from completed jobs. No database migration, worker change, scraping concurrency increase, or infrastructure change is required.

## Verification

- Regression tests failed before implementation for the reported first-load condition and now pass for single lookup, bulk hits, automatic default selection, persistence and reload without another lookup.
- Shared API-client suite: 31 passed, including device clock offsets in both directions, request latency, expired/future/malformed metadata, mixed-validity batches, empty results, and old-server compatibility.
- Backend full suite: 741 passed, 85 skipped (database/Redis/Linux opt-in tests). Sandbox browser-launch errors were resolved by rerunning with browser access.
- Web full suite: 432 passed with two workers. An initial concurrent run had one unrelated recipe duration-input test failure; it passed independently and in the complete bounded-concurrency rerun.
- Mobile product-cache, storage and product-pick suites: 66 passed. Mobile TypeScript check passed.
- Web TypeScript check and Next.js production build passed (26 static pages generated).
- Independent code review found no actionable defects.

Rollout requires API and web updates together; native clients receive the correction in their next app build. Deploy the additive API response first, then updated clients. This record documents local evidence, not a live post-deployment verification.
