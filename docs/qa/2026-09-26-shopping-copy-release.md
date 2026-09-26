# Concise smart shopping quantities — production correction

Verified at 2026-09-26T05:05:04.148030+00:00. Application source `46e49d84b374572d27adfb07230779b38b492f08`; API `cooking-backend:25`; image `sha256:657aa14a2332ad4832bc8845859b1a6b797959a3d7e9655c3deb787472421d5d`.

Quantity rows now omit generated taste and spoon-conversion explanations. Examples: salt shows `约 13 g`; light soy sauce shows `约 145 g`. Aggregation, approximate markers, legacy-quantity parsing, and missing-unit indicators are preserved. Vague-only quantities still display `适量` / `to taste` without appending that text to measured or retained amounts. The model prompt and project behavior documentation match this display policy.

## Verification

- Complete backend suite: **1,099 passed, 114 skipped**; independent review found no actionable issues.
- New Linux/amd64 backend image: 135 source hashes matched; dependencies, nonroot Chromium, media limits, migrations and repeat migration, import compatibility, authenticated recipe/plan/shopping/refine behavior, access/cost isolation, six Linux containment cases, graceful shutdown and cleanup passed. Shopping fixture outputs contain the concise totals. No paid provider calls.
- New web image `sha256:7e8b1c85ca595fa741d20038398bf9d0839dc3e1dbe761f8be9af56fea0d436d` built from the committed source with unchanged cached web layers, then passed isolated nonroot runtime, exact source identity, 12 routes, production API configuration, and preserved-feature checks. No frontend deployment.
- Production locked migration and completed rollout passed. Exact running revision/digest, health/readiness, protected routes, CORS, load-balancer health, bounded API/worker logs, and public shopping-page response passed. Credentials, budgets, Gemini settings and service/task configuration fingerprints were preserved. Worker remains `cooking-store-worker:2`.
- Authenticated shopping behavior was verified in the release image against disposable PostgreSQL. Production verification used anonymous requests and bounded logs; no customer account was changed. The local amd64 Chromium fixture retains the previously documented 45-second startup deadline with unchanged cleanup assertions and five other cases; production timeouts are unchanged.

Existing compiled browser-session lists retain their content. To recalculate, choose **Back to original list → Prepare smart shopping list**; existing preparation behavior clears selections.

## Release evidence and rollback

Receipts and logs: `/private/tmp/chef-shopping-copy-release-20260926/`, especially `runtime/runtime-result.json`, `web-runtime.json`, `backend-published.json`, `production-api-verification.json`, and `live-website-verification.json`. Previous API is `cooking-backend:24`, image `sha256:98aea5616822d0970cc23a08d484032a3523da912240bafa50d4d4b7403c6dcd`. No new schema migration; no frontend or worker deployment. The preceding [quantity release](2026-09-26-shopping-quantity-release.md) records the aggregation and local fixture details.
