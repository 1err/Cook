# New-account verification and menu deletion

The previous beta exposed verification and deletion in Settings, but registration neither sent verification mail nor brought users to that flow. The owner requested verification for new signups and account deletion in the menu.

## Resulting behavior

- Registration creates a restricted account, commits its hashed verification token, and requests the first email. The web app opens `/check-email` with the intended app destination preserved. Returning users with a pending account resume the same step.
- The screen names the recipient, explains the email link, and provides resend, status refresh, account settings, and sign-out controls. Failed requests remain retryable; only verified server state unlocks the app.
- The API enforces the requirement for both cookies and bearer tokens. Pending accounts can still read their status, resend/confirm verification, recover a password, sign out, and delete themselves.
- Migration `20260924_email_onboarding` adds a separate requirement flag with a false default. Existing accounts keep access without being marked verified. New registrations explicitly enroll. Readiness checks the new column; apply the locked migration before the new API/worker.
- The avatar menu's Delete account entry opens and focuses the existing confirmation form. Deletion still requires the current password and an explicit acknowledgement; Cancel clears both fields and restores focus.
- Native source honors the same requirement and preserves pending shared imports until verification. No native binary publication is implied by the web/backend release.

## Local checks

- Backend: 814 passed; six Linux-only cases reserved for the fresh image. Real PostgreSQL tests cover commit-before-email, cookie/bearer restrictions, resend replacement, provider failure, deletion while pending, and existing-account migration behavior.
- Web: 449 passed. Mobile: 329 passed. Shared/API client: 49 passed. Web/mobile TypeScript passed.
- Delivery tooling: 43 passed using the existing backend virtual environment. An initial system-Python invocation lacked `httpx`; the configured environment passed without source changes.
- Onboarding, account-email and shell browser checks: 63 cases passed across desktop, tablet and phone using local API fixtures. New signup and deletion confirmation layouts were visually reviewed.
- Repository hygiene and Docker context exclusion checks passed.

Release evidence is stored under `/private/tmp/chef-account-onboarding-20260924`. That directory may contain private deployment inputs and is not an upload bundle. Only its separately hashed `vercel-source` subset is intended for the existing `cook` Vercel project.

## Fresh image and runtime checks

Both images were rebuilt uncached from frozen application commit `3cb73b1b89f7024dbc7e088d77405783385e0a2e` for Linux/amd64. Initial public dependency downloads failed or timed out. A bounded host/container download probe succeeded; the same source then built with a longer private build timeout. No older application image was substituted.

- Backend image: `sha256:d73e773bb87839c16bce029fad318c832be31646040c84f0f3181ccbcfdc2a25`; ECR commit tag and digest matched the tested image.
- Web image: `sha256:205a44b87ed93e219a63c56af4e35193cb31137d89bdb956942f5584d30d1412`.
- Backend runtime: all nine gates passed, including six Linux containment tests, offline Chromium, pre-migration readiness rejection, locked migration, the full captured-email onboarding lifecycle, pending and verified deletion, manual recipes, worker cache-hit processing, and graceful shutdown. External network was disabled for these runtime contracts.
- The first Linux Chromium case timed out before its descendant marker. The unchanged isolated reproduction and full runtime rerun both passed all six cases. Original failure and timing evidence remain preserved; neither test deadlines nor application source were relaxed.
- Web runtime: 16 routes, 54 recovery-page local font assets, recovery security headers, non-root execution, real API binding, and absence of local fixture/inbox code passed with external networking disabled.

## Production release

The compatible frontend was promoted first. The locked `20260924_email_onboarding` migration then completed before API rollout. The worker received an image-only revision.

| Component | Verified deployment |
| --- | --- |
| Frontend | `dpl_5pvhxAND3EiaN2i9V23npDR4nXQ9` at `https://chef-world.com` |
| API | `cooking-backend:14` |
| Worker | `cooking-store-worker:2` |
| API and worker image | `sha256:d73e773bb87839c16bce029fad318c832be31646040c84f0f3181ccbcfdc2a25` |

At 18:05:30 UTC, the ALB had only the new healthy API14 target; all API13 targets were absent. At 18:07:33 UTC, both services had one healthy running task, no pending tasks, and completed rollouts. Health, database readiness, CORS, administrator settings, USD29/USD3 AI allowances, worker resource/settings preservation, and disabled worker AI/email spending were verified.

Live `/register`, `/check-email` and `/verify-email` returned 200 with asset sets matching the verified staged build. Signup explains verification; recovery headers and the absence of fixture-preview content were checked. The original Vercel staging CLI lost its polling connection after upload; the existing deployment was reconciled through authenticated READY/project/source metadata, preserving the original nonzero CLI result rather than creating a duplicate deployment.

A single unique SES bounce-simulator account passed live automatic-signup, cookie/bearer verification restrictions, account status, library-publication denial, invalid-link rejection, wrong-password deletion rejection, session revocation, pending-account login, and deletion checks. Its issued session and login were rejected after deletion; the private cleanup credential file was removed. No existing account or paid AI endpoint was used.

SES feedback confirmed the automatic signup email for that exact simulator recipient. Only its matching feedback receipt was removed; unrelated feedback was preserved. This proves provider processing, not human inbox placement. Successful token confirmation and reuse rejection were exercised with the real container API and locally captured email; no human production mailbox or valid production token link was accessed.

Future releases must retain the requirement flag and guard. API13 ignores the requirement flag and must not be used as a functional rollback once verification-required accounts exist; prefer a compatible forward fix. The separately authorized shopping and Weee fixes are being prepared from this release's source and hold production ownership until this task's final checks finish.

## Final live UI and log checks

The live browser run passed on desktop and phone: signup opens check-email; Library, Planner, Shopping, Cook and Import redirect without requesting app data; a status refresh truthfully retains the pending state; the avatar menu supports keyboard/touch; Delete account opens a focused password-and-acknowledgement confirmation; Cancel clears the form and preserves the account. The final run had zero JavaScript/console errors, unexpected requests, private-data requests, resend calls, paid AI calls or analytics calls. All six masked screenshots were visually reviewed without an actionable layout issue. Full-page phone captures include a scrolled sticky-header/masking artifact; these captures are not an unmasked visual export.

The first live browser run passed those functional checks but failed its final test guard because the harness blocked same-origin prefetches to the public About, Contact, Privacy and Terms pages. Its failed report and six screenshots remain unchanged. Only that four-route GET allowlist was corrected; all strict assertions remained. Offline guard tests and one explicitly bounded live rerun passed. Both browser-run simulator accounts were deleted, issued tokens and credentials were rejected, and both private recovery files were removed. Together with the separate API smoke, three disposable accounts were created and deleted; no existing users were accessed.

At 18:12:34 UTC, the bounded CloudWatch scan examined 273 events for the exact new API task, with no tracebacks, HTTP5xx, classified error events or account-email/worker/analytics failure warnings. The exact worker2 stream had no events in the window; its separate runtime health and rollout checks passed. The exact Vercel deployment had zero error, fatal or HTTP5xx records in the release window. These are bounded post-deployment observations, not a guarantee about future traffic.

Final private evidence includes `production-verification.json`, `readiness-result.json`, `production-api-smoke-result.json`, `email-feedback-result.json`, `onboarding-066abc84-6aab-428f-b80b-0c21489e7ce1-result.json`, `live-browser-final-review.md`, `postdeploy-error-scan.json` and `vercel-runtime-error-scan.json` under the release directory. All required checks are complete for the onboarding release; the next combined shopping/Weee release may proceed while preserving these account changes.
