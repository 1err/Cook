# Beta production release — September 24, 2026

The owner approved uploading the exact 191-file, 5.05 MB frontend bundle to the existing Vercel `cook` project and promotion after verification. Production now includes the beta account/reliability work and the already deployed administrator dashboard. The separate local test inbox remains a local preview only.

## Immutable release

- Application source: `a590b3bad2d0f57aee7873af1777eed9bb4a0d4d`, branch `codex/beta-final-20260924`.
- Backend ECR digest: `sha256:df4f25dc9bd99727de9facedf1684611721256d367f959464541d53a4b65eb59`.
- API: `cooking-backend:13`, one healthy task, completed rollout.
- Durable store worker: `cooking-store-worker:1`, one healthy task, 0.5 vCPU / 1 GiB. AI/email disabled; database pool two; no listening port or load balancer.
- Vercel: `dpl_BBugkNAqo1zF5RqGrGGRxQNmWr9R`, READY and promoted at 15:49:49 UTC. Public domain resolves to that deployment.
- Live site: https://chef-world.com. API: https://api.chef-world.com.

The locked migration completed before API replacement and joined both existing histories at `20260924_beta_analytics_merge`. Existing administrator/analytics configuration was preserved. API database TLS and the approved environment overlay were verified. The ALB now probes `/ready`; the previous target completed normal draining. API liveness, database readiness, and website CORS passed.

The configured app-accounted AI allowance is USD 29/month globally and USD 3/month per account. It applies after activation and excludes earlier/provider-external usage and AWS hosting. No paid AI request was made during release verification.

## Build and test evidence

- 807 backend tests, 430 web tests, 49 shared/API-client tests, and 43 delivery-script tests passed.
- 145 browser cases passed with 17 intentional viewport skips, including 33 account-email cases. These predeployment browser cases used API fixtures.
- Web/mobile type checks, Next.js production build, repository hygiene, and Docker context guards passed.
- Fresh uncached Linux backend and web images built successfully. Backend runtime passed nine gates, including all six Linux containment cases omitted on macOS, real disposable PostgreSQL migration/account/recipe/analytics checks, and graceful API/worker shutdown.
- Network-isolated web runtime verified 15 routes, 54 bundled font assets, recovery security headers, non-root execution, and production API binding in 47 browser chunks. No local inbox, preview banner, fixture API, or fixture error leaked into the compiled production client.
- Ten public production pages returned 200. Recovery headers passed, and production verification-page assets matched the verified staged deployment.

## Live account and mail verification

The API smoke used two unique Amazon SES simulator accounts. Twenty-two checks passed: registration, manual recipe persistence, owner isolation, verification/reset request acceptance, invalid-token rejection, sign-out-everywhere, rejected wrong-password deletion, and successful cleanup. Both accounts were deleted and no existing account was accessed.

SES permissions allow the application's `sesv2.send_email` operation for the verified sender. The exact test reset request produced an SES simulator bounce through the configured SNS-to-SQS path. One matching test receipt was removed; two unrelated messages were preserved. API logs showed no account-email delivery failures. This proves provider processing and feedback routing, not arrival in a person's inbox or a successful production token-click flow. Real token confirmation/reuse was tested against the actual backend in the isolated local email preview.

## Final browser verification

The live browser checks confirmed secure sign-in, manual recipe creation and persistence after reload, account settings, a verification request, and an accurate unverified status after refresh. Desktop and phone recovery pages passed missing-link and real invalid-token rejection checks, token-fragment removal, available recovery actions, forgot-password rendering, and generic reset acknowledgement. Screenshots were reviewed for readable content and no clipping or horizontal overflow. There were no application JavaScript errors, paid AI calls, analytics events, or existing-account access.

The browser evidence is composed from successful checks across attempts, not a single uninterrupted run. The first harness attempt typed before hydration and was blocked by its own request guard. The second completed the signed-in flows, then stopped after a same-document hash-only navigation failed to remount token capture. Anonymous checks with fresh-document navigation completed the remaining desktop and phone cases. Both original reports are retained alongside `live-browser-aggregate-result.json`; neither failure required an application change.

Both browser-created simulator accounts were deleted, their issued sessions and subsequent login were rejected, and no credential recovery files remain. Together with the API smoke, four disposable accounts were created and four deleted. Authenticated phone settings have local automated coverage; live phone verification covered recovery screens. Actual time-based expiry is covered by backend tests. Human inbox delivery and successful production email-token confirmation remain outside this smoke's evidence.

The final AWS scan covered 15:38:34–16:11:32 UTC: the API and worker remained healthy on the intended immutable digest, with 588 API log events and zero emitted worker events. There were no HTTP 5xx, tracebacks, or account-email, worker, or analytics failure warnings in the scanned streams. The exact Vercel deployment scan through 16:11:27 UTC returned zero error, fatal, or HTTP 5xx records, with complete queries. These are bounded release checks, not a long-term uptime or production capacity claim.

## Operational evidence

Source manifests, fresh-image logs, runtime checks, deployment results, public-page checks, and redacted mail/log summaries are under `/private/tmp/chef-beta-release-20260924`. Private task inputs, credentials, and account recovery files stay outside the repository. Do not upload that entire folder: only `vercel-source` was approved for Vercel.

Previous API revision: `cooking-backend:12`. Previous frontend: `dpl_FpoAHbgxwQCGnPtQRjtqKLu9sHDA`. The database migration is additive; deployment scripts and exact-image checks remain the release procedure. The source working copy and the older local email preview were preserved separately.
