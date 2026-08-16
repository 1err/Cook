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
- [ ] `npm run tokens:test` passes.
- [ ] `npm run tokens:build` passes.
- [ ] `git diff --exit-code` passes immediately after `npm run tokens:build`, proving generated design-token output and all other tracked files are reproducible.
- [ ] `npm run test:web` and `npm run test:mobile` pass.
- [ ] Web and mobile TypeScript checks pass.
- [ ] `npm run web:build` passes.
- [ ] Planner and shell Playwright tests pass, including committed Linux baselines.
- [ ] `cd backend && .venv/bin/python -W error -m pytest -q` passes.
- [ ] The focused Amazon-removal scan has no active product-store matches; the intentional S3 `amazonaws.com` URL remains.
- [ ] Review confirms this release intentionally requires no database schema change and adds no Alembic migration; do not apply ad-hoc DDL. The existing `store` primary-key field remains in place and active cache rows use `weee`.
- [ ] The previous stable ECS image SHA/digest and current Vercel production deployment are recorded above before rollout begins.

## Local and preview acceptance evidence

Record artifact URLs or paths beside each checked result.

- [ ] At 1280×800, `/planner` has no document-level vertical scroll and all seven day columns and 21 meal slots are visible. Evidence: `TBD`
- [ ] The saved-recipe rail remains visible and scrolls internally. Evidence: `TBD`
- [ ] Recipe add, remove, open, drag/drop, and `+N more` overflow interactions work; overflow closes with Escape and restores focus. Evidence: `TBD`
- [ ] The grocery bento card layout, category placement, column widths, and card presentation are unchanged. Evidence: `TBD`
- [ ] Product requests begin in rendered top-left-to-bottom order while no more than four client workers are active. Evidence: `TBD`
- [ ] Queued and loading ingredients show waiting states and never show the completed-empty message early. Evidence: `TBD`
- [ ] Web and iOS contain no Amazon store selector or active Amazon product source. Evidence: `TBD`

## Coordinated production rollout

Deploy the backend first. Do not promote the frontend until the backend is stable and its compatibility checks pass. This order keeps the existing frontend compatible while establishing the new Weee-only API boundary before the client stops sending a store selector.

### 1. Deploy and verify the AWS backend

- [ ] From a clean checkout of the reviewed merged SHA, run `bash scripts/deploy-backend.sh`. This builds Linux/amd64 ECR tags `latest` and the git SHA, forces a deployment of `cooking-backend-service` in `cooking-cluster`, waits for ECS stability, and checks the API health endpoint.
- [ ] Record the returned ECS deployment identifier and deployed immutable image SHA/digest above; confirm running tasks use that image.
- [ ] `GET https://api.chef-world.com/health` returns HTTP 200 with `{"status":"ok"}` on repeated checks after ECS reports stable.
- [ ] An authenticated `GET /store-products?query=rice` succeeds, and explicit legacy `store=weee` also succeeds.
- [ ] An authenticated `GET /store-products?query=rice&store=amazon` returns HTTP 400.
- [ ] Backend logs show no startup, database, scheduler, scraper, or uncaught request errors during the smoke window.

If any backend check fails, stop before Vercel promotion. Restore the recorded previous ECR SHA tag as `latest`, force a new ECS deployment, wait for `aws ecs wait services-stable`, recheck `/health`, and record the rollback deployment identifier and reason under **Exceptions and rollback evidence**.

### 2. Warm and verify the production cache

Use an authenticated admin browser session or an approved secret-safe HTTP client. Do not record the session cookie.

- [ ] Trigger `POST https://api.chef-world.com/admin/cache-refresh` with `{"stale_only":false}` once; a concurrent trigger reports that a run is already active rather than starting a duplicate run.
- [ ] Poll authenticated `GET https://api.chef-world.com/admin/cache-refresh-status` until `running` is false. Record the final `summary` counts for `cache_hit`, `cache_miss`, `skipped`, `failed`, and `total`: `TBD`.
- [ ] The warmer status shows progress after a deliberately failed or observed failed query and later queries still complete; final `current` reaches `total`. Evidence: `TBD`
- [ ] The backend GitHub Actions run passes `test_scrape_ceiling_allows_at_most_four_distinct_live_scrapes`; this automated test is the authoritative max-four evidence for the release. CI run/test evidence: `TBD`. Production telemetry, if available, may be linked as supplemental evidence: `TBD / not available`.
- [ ] A curated common Weee ingredient returns immediately from fresh cache. Query and latency: `TBD`
- [ ] A novel uncached ingredient makes one requester wait for the live lookup, persists a positive result, and returns immediately on a second authenticated request, including from a different authenticated user if available. Query and first/second latency: `TBD`
- [ ] A completed empty result appears only after lookup completion; an empty or failed refresh does not replace a previous positive cache row. Evidence: `TBD`
- [ ] Automated backend evidence confirms a row exactly 86,400 seconds old is rejected and no expired price is served during refresh. Test/run URL: `TBD`

If warming causes elevated errors or resource pressure, do not deploy the frontend. Stop further manual refreshes, roll back the backend as described above if the new service is responsible, and verify the restored service health before continuing.

### 3. Deploy and verify the Vercel frontend

- [ ] After backend health, compatibility, and cache checks pass, promote the Vercel deployment built from the exact reviewed SHA above to production; record its immutable deployment URL.
- [ ] Confirm `https://chef-world.com` resolves to that production deployment and uses `https://api.chef-world.com`.
- [ ] In a fresh authenticated browser session, repeat the 1280×800 planner, recipe-rail, planner-interaction, grocery-order, waiting-state, and Weee-only checks from **Local and preview acceptance evidence**.
- [ ] Confirm the first common ingredient is immediate and a newly rendered uncached ingredient transitions from queued/loading to products or a true terminal empty/error state without requiring a refresh.
- [ ] Confirm there is no Amazon selector or Amazon product link in production web; verify the release iOS build also has none before App Store submission.
- [ ] Check Vercel runtime/build logs, browser console, failed network requests, and backend logs for new errors during the smoke window.

If the web smoke fails while backend checks remain healthy, immediately promote the recorded previous Vercel production deployment, confirm `chef-world.com` resolves to it, and repeat a minimal Library/Planner/Shopping smoke. If the failure crosses both tiers, roll back Vercel first to stop new client traffic patterns, then restore the previous ECS image and verify backend health.

## Production acceptance summary

- [ ] AWS backend and Vercel frontend both run the recorded reviewed release.
- [ ] `/planner` meets the 1280×800 viewport contract in production.
- [ ] The recipe rail and every add/remove/open/overflow workflow pass in production.
- [ ] Common and newly cached Weee ingredients meet the expected first/second request behavior.
- [ ] Strict 24-hour expiry, single-flight, warmer failure isolation, and the four-live-scrape ceiling have automated or production evidence.
- [ ] `store=amazon` returns HTTP 400 and no Amazon store selector exists on web or iOS.
- [ ] No rollback was required, or rollback evidence below shows service restoration.

## Exceptions and rollback evidence

- Result: `TBD — success / rolled back / blocked`
- Exception or rollback reason: `TBD`
- Rollback deployment identifiers/URLs: `TBD`
- Post-rollback health and smoke evidence: `TBD`
- Follow-up owner and issue: `TBD`
