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
- New onboarding browser checks: 14 desktop/phone cases passed with local API fixtures. Additional existing account/shell coverage and image/production evidence will be recorded after release checks.
- Repository hygiene and Docker context exclusion checks passed.

Release evidence is being prepared under `/private/tmp/chef-account-onboarding-20260924`. That directory may contain private deployment inputs and is not an upload bundle. Only its separately hashed `vercel-source` subset is intended for the existing `cook` Vercel project.
