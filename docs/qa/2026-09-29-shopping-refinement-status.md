# Shopping refinement status correction — September 29, 2026

## Cause and scope

The user saw 60 consolidated, categorized ingredients alongside the global “Smart refinement is temporarily unavailable” notice. A bounded, fully paginated read of production status logs at 17:50:37 UTC showed `quantity_unresolved` and `onion_variety_restored` for 118 source entries / 59 model groups. These fixed reason codes contain no ingredient names, amounts or raw model output. The exact unresolved production ingredient is therefore unknown.

The previous recovery correctly kept the useful groups, but any locally unresolved quantity still set the entire response to `fallback`. The frontend interprets that status as an unavailable service. The correction introduces `partial` for accepted source groups that retain an original quantity or a default category. Fully validated/recovered results remain `refined`; whole-result structural, provider and legacy failures remain `fallback`. Ingredient grouping, quantity math, source coverage safeguards, model and budgets are unchanged.

The API response enum and client TypeScript types document `partial`. Existing deployed web runtime already treats only `fallback` as an outage, so no frontend upload/promotion is needed. A saved fallback result remains unchanged until the user explicitly retries; no browser data or production user list is overwritten.

## Verification

- Regression assertions first reproduced the accepted-group status mismatch. Final backend suite: **1,435 passed, 130 skipped**, two pre-existing dependency deprecation warnings. Independent reviewer passed 81 group/route tests and found no blockers.
- Full web suite: **836 passed**; API-client suite: **66 passed**; focused UI suite: **28 passed**; web type checking passed. Mobile type checking is blocked by four existing missing `expo-file-system/legacy` module imports in untouched `menuAssets.ts`, `menuAssets.test.ts`, `menuExport.ts` and `menuExport.test.ts` files. No native binary is released.
- The original two recorded full-list model responses replay identically under the new parser. A separate synthetic perturbation of the second recorded response deliberately removes the approximation marker from ginger to force one retained quantity. The actual parser/API model returns 60 `partial` rows, every source ID exactly once, with all other totals intact. These are offline recorded/synthetic tests, not a newly captured production user response. **No new paid model calls** were made.
- The exact release image replays both complete responses and the partial case offline with no provider keys/network, and produces the same API fixture used by browser tests. Fresh committed-source image also passed all 114 application source hashes, non-root amd64 runtime, repeated locked migrations, bundled Chromium, health/readiness, authorization and CORS. Cached dependency installation was used; all 56 installed Python package versions match the preceding verified image.
- Against the unchanged public website JavaScript, desktop1440px and phone390px browser tests passed with all API traffic intercepted: no global unavailable/Retry notice for partial, all60 items and categories intact, retained ambiguous quantity visible, checkmarks/status survive reload, and Muse has no outage notice. No page/console errors, unexpected requests or overflow. The deliberate service-worker-blocking harness warning is recorded separately.

## Release identity and evidence

Application source: `00feb856dbccd02c4838bf63475c899100ec7893`. Backend image: `sha256:3a399dd4e54f13542c2c93b0fa99c350e0926d8685f573c452ab7e7681b7ac8d`.

Local evidence: `/private/tmp/chef-shopping-status-release-20260929`, including `incident-status-logs.json`, `backend-image-proof.json`, `partial-image-result.json`, `browser-partial-proof.json`, and `web/release-proof.json`. Finite fixtures do not guarantee all future model conversions; the change deliberately preserves uncertain original amounts rather than guessing.

Rollback target is API revision33, image `sha256:e232361c000ec7567009c91c017412e2c3441d84f9209cedc663b789341489c0`.

## Production verification

The correction is live as `cooking-backend:34`. Independent checks at 18:05 UTC verified the exact immutable image/source, sole PRIMARY COMPLETED rollout, desired/running1, pending0, healthy new task/container/target, and the preceding target draining normally. Locked migration task `0ea59faa3fc14d9aa1532a395ec7c82c` ran the exact revision/image and exited0. Full API task configuration33→34 is identical except the image and AWS-managed metadata; model/budgets/environment/secrets references and saved service settings were preserved. Worker revision2 remains healthy.

The deployment script again reached its final guard before ECS published completion and returned nonzero. That result is preserved in `backend-deploy.log`. No duplicate deployment or rollback was performed. Both independent read-only audits then confirmed exactrevision34 completion, live health/readiness200, protected auth/shopping401, production CORS, and complete bounded new-task logs with zero warnings/errors/tracebacks/provider failures/5xx. Receipts are `production-after.json` and `independent-production-audit.json`.

The fresh web image also passed nonroot/no-network runtime checks on17routes,40assets and6fonts; dependency installation and appbuild reran successfully. It was used only as a local release gate. No Vercel upload/promotion or native binary release was performed. The existing deployed JavaScript was independently tested with the actual partial-response fixture. Disposable local runtime containers/database volume and generated credential files were removed.
