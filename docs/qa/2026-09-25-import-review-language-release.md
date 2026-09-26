# Import review and Chinese display — production release

Status: deployed September 25, 2026 (Chicago time), verified September 26 at 01:42 UTC. Frozen application source: `eccb6ede7964d04aa6fdb7985c563edea0d767f7`. This combines the approved import changes with the latest live source `08795001692b696563d12e0a5ac6f3c2ba6bc963`; Muse shopping, AI cover generation, and administrator AI/infrastructure costs are preserved.

## Delivered behavior

- Import review hides internal completeness, source-grounding, action-inventory, repair, and timestamp diagnostics. Useful missing-method, quantity, temperature, and source-access notices remain visible. “Details to check” disappears when nothing customer-relevant remains; the positive draft-ready notice stays. Backend quality checks and raw diagnostics are unchanged.
- New Chinese text, caption, video, and media imports display Simplified Chinese through offline OpenCC conversion. Original evidence, source excerpts, timestamps, identifiers, URLs, numbers, and user title overrides remain intact. Equivalent Traditional/Simplified text keeps valid source grounding and stated timers. Saved/manual recipes are unchanged; Japanese/Korean prose is protected by a bounded script heuristic.
- No additional provider request or schema change. No native binary or OTA release is included; the shared warning-filter implementation is also present in mobile source.

## Verified release gates

- Fresh merged-source suites: **634 web, 282 shared, 39 API-client, and 1,141 backend tests passed**. Backend had 6 platform skips; all six Linux process-containment checks separately passed in the runtime image. Web TypeScript passed.
- Fresh Linux/amd64 web and backend images passed local runtime gates. Web ran as UID 1001 with networking disabled; production API configuration, warning filtering, routes, manifest/service worker, and all five preserved feature markers passed. Backend passed 13 runtime gates, including offline Chinese conversion, source-preserving ingredients, migration idempotence, import jobs, and image/cost isolation; provider calls: 0.
- All 220 frozen manifest files matched. Staged Vercel deployment `dpl_4RmTr4T3uJAQLhZEQXrmYVWw2J9W` passed route checks and 31 CSS/JavaScript asset checks, including preserved Muse/AI covers/admin costs and production API configuration without fixture markers.

## Production record

- Previous API / worker: `cooking-backend:21` / `cooking-store-worker:2`.
- Previous website: `dpl_6ky4tLkndUsPvdp6FdchX246BbsF`.
- New API revision: `cooking-backend:22`; completed PRIMARY rollout, desired/running 1, pending 0.
- Worker revision and configuration preservation: `cooking-store-worker:2`, unchanged; configuration fingerprints preserve credentials, all eight Gemini settings, budgets, task and service settings.
- Promoted website deployment and both production aliases: `dpl_4RmTr4T3uJAQLhZEQXrmYVWw2J9W`, READY on `chef-world.com` and `www.chef-world.com`.
- Exact running image, service stability, health/readiness, CORS, authenticated-route boundaries, bounded logs, and live route/asset checks: passed. `/health` and `/ready` returned 200; protected import, image and cost routes returned 401 anonymously. Production CORS passed. API/worker logs had no warnings, errors, tracebacks, 5xx responses, or unavailable import worker notices in the checked window. Vercel error/fatal/5xx scans returned zero results. All 31 live asset hashes matched the staged release.

Published backend image: `sha256:05fc11f9907cf3113ddbda89f6739b702ec1768aaf3eff182def332c7771c90b`. Verified local web image: `sha256:10e62bad2a62007b76846d2bd2550101a767f506dee01f2ed3a27965165e6837`.

Evidence: `/private/tmp/chef-import-language-release-20260925/` (`frontend-tests.json`, `backend-gates.json`, `backend-runtime/runtime-result.json`, `web-runtime.json`, `source-audit.json`, `stage-verification.json`, and `stage-assets-verification.json`). Final evidence also includes `backend-deploy.log`, `backend-published.json`, `production-api-verification.json`, `vercel-promoted.json`, `live-assets-verification.json`, and `vercel-error-scan.json`. The signed-in live `/import` page rendered its source tabs, draft action and manual recipe creation correctly; no recipe was submitted or saved. Earlier behavior coverage is documented in `docs/qa/2026-09-25-import-review-language.md`. These deterministic and runtime checks do not establish fresh authenticated production video-provider extraction quality.

## Rollback reference

The previous backend revision is `cooking-backend:21` with image `sha256:ca56bdee0b346c99dc290378341cf96d2ce4e2b56c1e1e83a79d71751cdb2f3c`; the previous website is `dpl_6ky4tLkndUsPvdp6FdchX246BbsF`. This release adds no schema revision; the locked migration gate passed at `20260925_recipe_images`. Any rollback should recheck current production state and preserve settings.
