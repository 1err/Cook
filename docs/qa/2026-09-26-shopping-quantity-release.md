# Smart shopping quantity aggregation — production release

Deployed and verified at 2026-09-26T04:51:06.380253+00:00. Application source: `0cfb10726545017c881e7ae8ddaa3ebb0ff32b73`. Production API: `cooking-backend:24`. Immutable backend image: `sha256:98aea5616822d0970cc23a08d484032a3523da912240bafa50d4d4b7403c6dcd`.

## Behavior

Smart lists combine compatible quantities and use a bounded, documented ingredient-density table for approximate mass/volume totals. Estimates are marked `about` / `约`; bare Chinese spoon estimates state the tablespoon assumption. Vague additions collapse to one extra-to-taste note, and genuinely missing units remain flagged. Valid recorded metric equivalents count once. Source weights survive pre-aggregation, and the organizing model cannot replace the computed totals.

Screenshot examples: salt `1 茶勺; 7 g; 少许; 适量` becomes `约 13 g，另按口味添加`; light soy sauce `100 g; 3 勺` becomes `约 145 g（按每勺1汤匙估算）`; flour `2; 0.25 杯` becomes `约 30 g；2（单位待确认）`.

## Source and verification

The release is based on production source plus documentation commit `b57e091aba405b1e1d5f306fdde3e6ba60e74cfc`. Application changes are confined to the backend, with quantity-behavior project documentation in `CLAUDE.md`; the dirty main checkout and independent menu-builder work are excluded. Existing exact quantity parsing, shopping protections, and released features are preserved.

- Complete backend suite: **1,099 passed, 114 skipped**. The full-suite skip count is retained; the image checks below provide separate runtime evidence.
- Fresh Linux/amd64 backend image passed source/build identity, dependency, migration, import compatibility, media boundary, API/authentication, image quota/admin isolation, graceful shutdown, and cleanup checks. All six Linux containment regressions passed with the fixture adjustment documented below.
- Authenticated recipe creation, meal planning, shopping retrieval, and smart refinement passed against disposable PostgreSQL in the immutable release image. Coverage includes repeated meals, metric equivalents counted once, estimated totals, vague amounts, missing units, and preventing model output from overriding calculated totals. This is local-image behavior verification, not an authenticated production shopping test.
- Fresh uncached web image `sha256:007e2faee429d837e52ecb8d9d58c4f6745ee2a12eed72fc84f1c3c32ee7b297` passed exact source identity, nonroot isolated runtime, 12 routes, sharing assets, production API configuration, and preserved Muse, image generation, cost dashboard, import-warning, and equipment-removal checks. The web image was used for verification only; no frontend/Vercel deployment was performed.
- Published ECR digest, locked migration, exact completed API rollout, running digest, health/readiness, protected-route boundaries, CORS, load-balancer readiness, and bounded API/worker log scans passed. Configuration fingerprints report no differences: credentials, budgets, all eight Gemini settings, task settings, and service settings are preserved. Worker remains `cooking-store-worker:2`.
- Read-only live website checks passed; receipt: `live-website-verification.json`.

## Local fixture corrections and limits

The first Chromium containment attempt could not reach readiness within its fixed five-second supervised startup deadline under Linux/amd64 emulation; measured Chromium startup was approximately 7–16 seconds. The final local fixture uses a 45-second supervised deadline, 40-second readiness allowance, and 60-second wait. Original cleanup assertions and the other five containment cases remain unchanged. Application timeouts and application source were not changed for this correction. Earlier failed-attempt evidence is retained.

The initial shopping contract received HTTP 422 because its recipe-creation fixture omitted the required recipe `id`. Adding a generated fixture ID corrected the request; the final authenticated image contract passed. No production recipe or account was used. Paid external provider calls were not used for release testing; live checks are anonymous probes and bounded log verification.

## Existing saved smart lists

Existing browser-session results are retained. To recalculate them, use **Back to original list**, then **Prepare smart shopping list**. Preparing again resets the smart-list selections as it already does.

## Evidence and rollback

Evidence directory: `/private/tmp/chef-shopping-quantity-release-20260926/`. Final receipts: `runtime/runtime-result.json`, `web-runtime.json`, `backend-published.json`, `production-api-verification.json`; supporting suite/build/runtime/deployment logs and initial failure evidence are retained there.

Previous API revision: `cooking-backend:23`; previous image: `sha256:ec1661b9a8e0f81c91aa58d3370a002a226f64482c00cd76d0285ac00218dcfa`. There is no new schema migration in this release; the existing locked migration gate completed before service update. Frontend and worker deployment remain unchanged. Rollback can restore the previous API revision after checking current production state; no schema downgrade is required.
