# Weee first-load expiry correction

Deployed on September 24, 2026 from application commit `f192c5ee88e60657975bc9adcf224d6a16e2783a`, isolated on `codex/weee-first-load-fix-20260924`. The combined release includes the Weee correction `50f8f4c`, account onboarding `3cb73b1`, and the approved prepared-only shopping correction `e765d843`. Documentation commits after the release do not change its application source.

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

## Combined release verification

- Backend full suite with a fresh disposable PostgreSQL database: 827 passed, 6 Linux-only skips. The fresh backend image separately passed all six Linux containment checks. Account onboarding, migration histories, durable jobs, cache behavior, and account cleanup ran against real PostgreSQL.
- Web: 452 tests across 63 files, TypeScript, and a fresh production build passed. Both application images were built with `--no-cache` from the frozen committed source.
- Backend image runtime: 115 source hashes verified, dependency compatibility, nonroot Chromium, locked migration, onboarding/auth HTTP contracts, real database clock offsets, expired-job rejection, worker processing and graceful shutdown passed.
- Web image runtime: nonroot execution with networking disabled, 16 routes, bundled fonts, production API binding, and account-recovery headers passed. The first temporary archive used overly restrictive directory permissions; that failed runtime attempt was retained, its archive permissions corrected, and a new uncached image built and verified. Application bytes did not change.
- Desktop (1440px) and phone (390px) browsers: original/smart/original checkbox counts `0 → 4 → 0`; two batch hits plus two serial misses yielded four selected picks with the API clock five minutes ahead; no Retry or console errors; reload retained products and selections without refetching.
- Vercel stage: exact commit/project metadata, six public routes and 20 CSS/JavaScript/font assets verified before promotion. An independent review also confirmed the prepared-only original shopping branch and retained onboarding behavior.

## Production release

| Component | Verified release |
| --- | --- |
| API | `cooking-backend:15` |
| API source | `f192c5ee88e60657975bc9adcf224d6a16e2783a` |
| API image | `sha256:8396259aa135d9e3c7751eb2d1c59dba5281925355f75276c80c99842dff44ac` |
| Web image tested locally | `sha256:1bd81d1eb08a2ba426a86f4b15042b6323978832f640e33a03801adeb8bf2afa` |
| Vercel | `dpl_9CqK5ATXd6shJBWoVBapf2UUoKwg` |
| Worker, intentionally unchanged | `cooking-store-worker:2`, source `3cb73b1`, image `sha256:d73e773bb87839c16bce029fad318c832be31646040c84f0f3181ccbcfdc2a25` |

The previous release owner explicitly handed over production control. The normal deploy script verified the exact committed ECR tag/digest, completed the locked migration check, and rolled out the API before web promotion. The database remained at `20260924_email_onboarding`; this fix adds no schema migration. API configuration matched revision 14 except for its image. The USD 29 global / USD 3 per-account AI allowances, account/admin settings, TLS, API resources, and worker configuration were preserved. API health, readiness, and CORS passed; the old API14 load-balancer target was absent at 18:23:08 UTC after its existing 300-second drain.

One reviewed live smoke task used the exact API15 image and public API. It created one private disposable verification-required account through existing repositories, verified and logged in normally, made six cache-only candidate checks, and performed one naturally uncached lookup. The first attempt returned three products and a successful durable job; the following batch returned the same three products fresh. Remaining lifetimes were approximately 86,398 seconds and satisfied the bounds with simulated device offsets of minus 12 hours, zero, and plus 12 hours. The account, identity, and action tokens were deleted and absence verified. No email was sent and no existing account was accessed. No cache rows were deleted or seeded artificially.

The exact staged website was promoted at 18:26:02 UTC. Direct alias records for both `chef-world.com` and `www.chef-world.com` matched the intended deployment. Live checks passed for six routes and all 20 staged asset hashes; the independent shopping review also matched its live assets. The bounded Vercel window through 18:27:37 UTC had zero error, fatal, or HTTP 5xx records, with no capped or incomplete queries.

The bounded API log window inspected 170 records: no ERROR/traceback and one HTTP 503 on the separate `POST /recipes/parse/link` endpoint at 18:24:47 UTC. Weee lookup and batch requests passed. An independent complete 39-minute search of the previous API14 stream through its shutdown at 18:24:06 found zero matching responses, so the finding cannot be called pre-existing. Recipe/video import code and installed Python package versions match the previous release; the access log alone does not identify the cause or establish a regression. This one unresolved recipe-import availability incident is retained separately from the successful Weee verification.

Detailed sanitized reports and private release inputs are under `/private/tmp/chef-weee-release-20260924`; do not commit raw cloud configuration, authentication material, or user-bearing logs. Relevant reports are `backend/tests-result.json`, each image's `runtime-result.json`, `api-deploy-result.json`, `api-verification.json`, `live-smoke-result.json`, `staged-verify-result.json`, `frontend-promotion-result.json`, `live-frontend-verification.json`, and the bounded log reports.

Native clients receive the shared-client correction in their next app build; this release publishes the API and website only. An API rollback, if ever needed, must preserve onboarding and target revision 14 or later, not revision 13. Recheck live identity before any later rollout.
