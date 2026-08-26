# Web planner and Weee cache production evidence

This is an evidence record, not permission to deploy. Leave every item unchecked until the named environment has been observed. Do not paste passwords, cookies, access tokens, AWS account identifiers, or other credentials into this file or its artifacts.

## Release identity

- Reviewed commit SHA: `TBD`
- GitHub pull request: `TBD`
- GitHub Actions run: `TBD`
- AWS region: `us-east-1`
- ECS cluster/service: `cooking-cluster` / `cooking-backend-service`
- Previous backend image SHA or digest: `TBD`
- AWS ECS deployment identifier: `TBD`
- Deployed backend image SHA or digest: `TBD`
- Backend URL: `https://api.chef-world.com`
- Vercel production deployment URL: `TBD`
- Public web URL: `https://chef-world.com`
- Production smoke-test timestamp (UTC): `TBD`
- Reviewer: `TBD`

## Pre-deployment release gate

- [ ] The reviewed pull request is approved, every GitHub Actions job is green, and the release checkout is clean at the exact reviewed SHA above.
- [ ] From the exact reviewed SHA, freshly run the complete deterministic matrix below. Every command exits `0`; record exact test counts and every warning in the release evidence. The token build leaves no diff under `packages/design-tokens`.

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

- [ ] Run the controlled cold-cache probe below. It launches 20 distinct cache misses plus background warmer work against scrape doubles, polls the FastAPI `/health` route, and proves every request terminates, every health response is HTTP 200, and peak live scrape count is exactly one. It must never contact or load-test the real Weee site.

  ```bash
  cd backend
  .venv_fresh/bin/python -m pytest -q tests/test_store_product_service.py -k 'cold_cache_health_probe'
  ```

- [ ] Backend compatibility tests prove an omitted `store` returns `{products, expires_at}`, explicit legacy `store=weee` returns the matching `StoreProduct[]`, positive expiry comes from the service cache timestamp, and empty modern responses use `expires_at: null`.
- [ ] Backend route tests prove a confirmed explicit no-results outcome is HTTP 200, while exhausted transient scraper failures are HTTP 503 with detail code `weee_temporarily_unavailable` and `Retry-After: 3`; scraper exceptions never escape as generic HTTP 500 responses.
- [ ] Backend scraper tests prove one logical lookup makes at most three internal attempts, creates a new context and one search page per attempt, returns up to three safe unique Weee links from search cards, and never opens product-detail pages.
- [ ] Cache/service tests prove age `86,399` seconds is fresh, age `86,400` seconds is expired, no stale fallback is displayed after refresh failure, same-key callers join one job, interactive work runs before the warmer's next queued item, and a positive row commits before publication.
- [ ] Batch/client tests prove cache-only batch reads publish every fresh hit before the first live miss, live misses run one at a time in visual order, mechanically identical queries retain the first cleaned spelling, and a 75-item list is not capped.
- [ ] Warmer tests prove the 24-hour scheduled run is forced and serial, per-query failures do not stop later queries, and backend startup schedules the job without starting a live-scrape sweep.
- [ ] The focused Amazon-removal scan has no active product-store matches; the intentional S3 `amazonaws.com` URL remains.
- [ ] Review confirms this release intentionally requires no database schema change and adds no Alembic migration; do not apply ad-hoc DDL. The existing `store` primary-key field remains in place and active cache rows use `weee`.
- [ ] The previous stable ECS image SHA/digest and current Vercel production deployment are recorded above before rollout begins.

## Local and preview acceptance evidence

Record artifact URLs or paths beside each checked result.

- [ ] At 1280×800, `/planner` has no document-level vertical scroll and all seven day columns and 21 meal slots are visible. Evidence: `TBD`
- [ ] The saved-recipe rail remains visible and scrolls internally. Evidence: `TBD`
- [ ] Recipe add, remove, open, drag/drop, and `+N more` overflow interactions work; overflow closes with Escape and restores focus. Evidence: `TBD`
- [ ] The grocery bento card layout, category placement, column widths, and card presentation are unchanged. Evidence: `TBD`
- [ ] Web and iOS send one cache-only batch for the complete visually ordered, mechanically deduplicated ingredient list; every fresh hit renders before any live miss starts, and misses then use exactly one live-GET worker in rendered top-left-to-bottom order. Evidence: `TBD`
- [ ] Query identity only trims outer whitespace, collapses internal whitespace, and compares case-insensitively. Quantities, descriptors, preparation words, and modifiers remain in the first cleaned spelling sent by batch and live requests; semantically similar ingredients are not merged. Evidence: `TBD`
- [ ] A list larger than 50 ingredients is fully queued with no business-level cap, and each ingredient displays at most three validated product choices. Evidence: `TBD`
- [ ] Queued and loading ingredients show waiting states and never show the completed-empty message early. Evidence: `TBD`
- [ ] A retained positive remains visible only while its authoritative expiry is in the future. At the exact expiry boundary it is cleared and reloaded through the same serial live queue; an expired or refresh-failed row is never shown as fallback. Evidence: `TBD`
- [ ] A confirmed no-results response renders the completed-empty state, while a typed 503 renders the generic retryable error and Retry re-enters the same queue. A transient first attempt recovered inside the original backend request never flashes an error. Evidence: `TBD`
- [ ] Web and iOS contain no Amazon store selector or active Amazon product source. Evidence: `TBD`

## Coordinated production rollout

Deploy the backend first. Do not promote the frontend until the backend is stable and its compatibility checks pass. Backend-first compatibility is intentionally limited: deployed clients that explicitly request `store=weee` keep their legacy array response, while new clients that omit `store` receive expiry metadata. A deployed client that requests Amazon is not compatible with this backend and intentionally receives HTTP 400; confirm no release client still depends on that path before rollout.

### 1. Deploy and verify the AWS backend

- [ ] From a clean checkout of the reviewed merged SHA, run `bash scripts/deploy-backend.sh`. This builds Linux/amd64 ECR tags `latest` and the git SHA, forces a deployment of `cooking-backend-service` in `cooking-cluster`, waits for ECS stability, and checks the API health endpoint.
- [ ] Record the returned ECS deployment identifier and deployed immutable image SHA/digest above; confirm running tasks use that image.
- [ ] `GET https://api.chef-world.com/health` returns HTTP 200 with `{"status":"ok"}` on repeated checks after ECS reports stable.
- [ ] Backend logs show scheduler registration but no startup cache-warming sweep or startup live scrape.
- [ ] An authenticated known-fresh `GET /store-products?query=<known-query>` returns immediately with a JSON object containing one to three safe Weee products and a future ISO-8601 `expires_at`.
- [ ] One authenticated novel query completes as one logical request (with up to three internal attempts) and returns up to three HTTPS product links on official `sayweee.com` or `weee.com` hosts (including subdomains). Do not turn this smoke into a concurrency or load test against the real Weee site.
- [ ] An authenticated `POST /store-products/batch` containing the known-fresh query and a novel missing query returns the fresh entry and a `missing` entry in cleaned request order; logs show that the batch itself starts no Playwright work.
- [ ] An authenticated `GET /store-products?query=rice&store=weee` returns the legacy JSON array, and its product rows match the omitted-store response's `products` for the same fresh lookup.
- [ ] Authenticated requests with `store=amazon` and an unknown explicit store return HTTP 400 before scraper/service work; this is intentional incompatibility, not a backend-first compatibility claim.
- [ ] If a genuine confirmed empty is naturally available, it returns HTTP 200 with `products: []` and `expires_at: null`. Use the controlled route tests—not induced production failure—to prove exhausted transient failures return typed HTTP 503 plus `Retry-After: 3`.
- [ ] Backend logs show no startup, database, scheduler, scraper, or uncaught request errors during the smoke window, and `/health` remains responsive during the single novel live lookup.

If any backend check fails, stop before Vercel promotion. Restore the recorded previous ECR SHA tag as `latest`, force a new ECS deployment, wait for `aws ecs wait services-stable`, recheck `/health`, and record the rollback deployment identifier and reason under **Exceptions and rollback evidence**.

### 2. Warm and verify the production cache

Use an authenticated admin browser session or an approved secret-safe HTTP client. Do not record the session cookie.

- [ ] Trigger `POST https://api.chef-world.com/admin/cache-refresh` with `{"stale_only":false}` once; a concurrent trigger reports that a run is already active rather than starting a duplicate run.
- [ ] Poll authenticated `GET https://api.chef-world.com/admin/cache-refresh-status` until `running` is false. Record the final `summary` counts for `cache_hit`, `cache_miss`, `empty`, `skipped`, `failed`, and `total`: `TBD`.
- [ ] The warmer status shows progress after a deliberately failed or observed failed query and later queries still complete; final `current` reaches `total`. Evidence: `TBD`
- [ ] Automated evidence from `test_distinct_misses_never_run_more_than_one_live_scrape`, `test_interactive_job_precedes_next_background_job`, and `test_cold_cache_health_probe_keeps_one_live_scrape_and_health_responsive` is the authority for the one-live-scrape ceiling and priority behavior. Do not reproduce the 20-miss probe against real Weee. CI run/test evidence: `TBD`. Production telemetry, if available, may be linked as supplemental evidence: `TBD / not available`.
- [ ] Production logs for this single manual warmer run show serial background lookups only; an interactive request, if naturally made while warming, runs before the next queued warmer query. Evidence: `TBD`
- [ ] A curated common Weee ingredient returns immediately from fresh cache. Query and latency: `TBD`
- [ ] A novel uncached ingredient makes one requester wait for the live lookup, commits the positive result before publication, and returns immediately on a second authenticated request, including from a different authenticated user if available. Same-key overlap, if naturally observed, joins the in-flight lookup rather than starting another scrape. Query and first/second latency: `TBD`
- [ ] A completed empty result appears only after explicit no-results classification; an empty or failed refresh does not overwrite a previous positive cache row, and an expired previous row remains ineligible for display. Evidence: `TBD`
- [ ] Automated backend evidence confirms a row exactly 86,400 seconds old is rejected and no expired price is served during refresh. Test/run URL: `TBD`

If warming causes elevated errors or resource pressure, do not deploy the frontend. Stop further manual refreshes, roll back the backend as described above if the new service is responsible, and verify the restored service health before continuing.

### 3. Deploy and verify the Vercel frontend

- [ ] After backend health, compatibility, and cache checks pass, promote the Vercel deployment built from the exact reviewed SHA above to production; record its immutable deployment URL.
- [ ] Confirm `https://chef-world.com` resolves to that production deployment and uses `https://api.chef-world.com`.
- [ ] In a fresh authenticated browser session, repeat the 1280×800 planner, recipe-rail, planner-interaction, grocery-order, waiting-state, and Weee-only checks from **Local and preview acceptance evidence**.
- [ ] Confirm known fresh ingredients render from the batch before a newly rendered uncached ingredient starts its serial live GET; the miss transitions from queued/loading to up to three products or a true terminal empty/error state without requiring a user retry for a recoverable first attempt.
- [ ] Confirm there is no Amazon selector or Amazon product link in production web; verify the release iOS build also has none before App Store submission.
- [ ] Check Vercel runtime/build logs, browser console, failed network requests, and backend logs for new errors during the smoke window.

If the web smoke fails while backend checks remain healthy, immediately promote the recorded previous Vercel production deployment, confirm `chef-world.com` resolves to it, and repeat a minimal Library/Planner/Shopping smoke. If the failure crosses both tiers, roll back Vercel first to stop new client traffic patterns, then restore the previous ECS image and verify backend health.

## Production acceptance summary

- [ ] AWS backend and Vercel frontend both run the recorded reviewed release.
- [ ] `/planner` meets the 1280×800 viewport contract in production.
- [ ] The recipe rail and every add/remove/open/overflow workflow pass in production.
- [ ] Common cached ingredients render before novel misses; misses finish serially with up to three safe Weee choices, a confirmed empty state, or a typed retryable error.
- [ ] Strict `<24h` expiry with no stale fallback, same-key single-flight, serial warmer failure isolation, interactive priority, no startup sweep, and the one-live-scrape ceiling have automated or production evidence.
- [ ] Legacy explicit Weee clients receive arrays, omitted-store clients receive authoritative expiry metadata, `store=amazon`/unknown return HTTP 400, and no Amazon store selector exists on web or iOS.
- [ ] No rollback was required, or rollback evidence below shows service restoration.

## Exceptions and rollback evidence

- Result: `TBD — success / rolled back / blocked`
- Exception or rollback reason: `TBD`
- Rollback deployment identifiers/URLs: `TBD`
- Post-rollback health and smoke evidence: `TBD`
- Follow-up owner and issue: `TBD`
