# Beta and deployed dashboard integration — September 24, 2026

This release combines beta source `8ff2c66` with the already deployed administrator dashboard (`b552f55`, documentation through `7c05aa7`). It retains account verification/recovery, manual recipe creation, retry/conflict handling, the configured USD 29 monthly AI allowance, and the approved editorial interface. Local email previews remain explicitly opt-in and hidden in production builds.

## Integration changes

- The additive `20260924_beta_analytics_merge` revision joins both migration histories without rewriting the deployed analytics migration. Disposable PostgreSQL tests exercise fresh installation, upgrade from the production analytics head, and upgrade from the beta account head. Existing account values and analytics events/profiles survive.
- Authentication retains revocation and version checks, locked login, and abuse limits. Analytics attribution is added only after authentication succeeds; deleted-account analytics cascade with the account.
- API shutdown always reaches the beta cleanup path even if cancellation occurs while analytics maintenance drains. A focused regression reproduced the failure before the finally guard.
- Layout retains analytics and the isolated local email banner. Recovery browser tests reject sensitive data or recovery fragments in analytics. Test fixtures acknowledge analytics separately from business mutations.

## Local verification

- Backend: **807 passed**, six platform-specific containment cases deferred to the fresh Linux image runtime check.
- Migration/account/analytics/shutdown integration: **52 passed**, including all three migration starting points.
- Web: **430 passed**; shared/API client: **49 passed**.
- Web and mobile TypeScript checks and the Next.js production build passed.
- Browser: **145 passed**, 17 intentional viewport skips, including **33 account email cases** across desktop/tablet/phone. Browser API fixtures are simulated; this is not live email-delivery evidence.
- Delivery scripts: **43 passed**. Docker context guards exclude private files, and repository hygiene checks passed.

## Deployment gates

The application source must be frozen before archiving new contexts. Earlier `66147e2` images and upload bundles are stale and must not ship. Require new uncached backend/web images, runtime checks, exact ECR digest, locked production migration, ECS stabilization, readiness/CORS checks, and disposable-account verification.

Read-only production preflight found API task `cooking-backend:12` stable with the administrator dashboard, SES production sending healthy, encrypted RDS with point-in-time recovery, and no separate store worker yet. The approved worker uses 0.5 vCPU / 1 GiB and no AI or email credentials. All private task inputs remain outside the repository.

The previous Vercel source upload was rejected by automatic approval review for missing explicit payload/destination authorization. Prepare the new source manifest and obtain that approval before uploading it. Stage without assigning the live domain, verify the backend rollout, then promote and run live checks. No production deployment is claimed by this local integration record.
