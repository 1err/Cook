# Administrator dashboard production release — 2026-09-24

The user approved deployment after preview review. The live dashboard is https://chef-world.com/admin/dashboard and uses the existing production administrator account and password. The separate local demo credentials are not production credentials.

## Immutable release

- Source: `b552f5585778580461d562c436795ced7f7923a1`.
- Backend: `cooking-backend:12`, ECS rollout completed with one desired/running task, zero pending, and the expected running image digest.
- ECR image: `930067562682.dkr.ecr.us-east-1.amazonaws.com/cooking-backend@sha256:21718eb25700fbd78dd9c1533ad509af1a4c44cbdbedea917d57cd4af9b0ddb9`.
- Vercel: `dpl_FpoAHbgxwQCGnPtQRjtqKLu9sHDA`, READY, production domain verified after promotion.
- Deployment URL: https://cook-e7wv385vt-jerrys-projects-08f739a2.vercel.app.
- Fresh backend and web container builds passed from a clean git archive. The web image uses the production API address. Fresh-image checks passed for dashboard/login routes, backend health, anonymous denial, local admin login with real SQL reports, and Chromium startup.
- The existing 1,043 application/shared tests and both app typechecks passed before approval; 22 deployment-script tests also passed during release.

## Migration and account verification

A one-off ECS task from the exact new image held a PostgreSQL advisory lock while applying Alembic. It exited zero, advancing `20260914_ai_usage` to `20260924_analytics`. Tracking started at `2026-09-24T06:10:59.977650+00:00`.

A fresh verification confirmed one user, the original administrator UUID and local credential, and unchanged administrator mapping. No additional account deletion or password reset was performed during deployment. A separate short-lived verification task used an in-memory 90-second token to check the real HTTPS `/auth/me`, overview, and user directory; it exited zero. The token and signing secret were never printed or written to disk. Admin report access passed, all 72 meal-plan rows remained, and collection diagnostics reported zero failures.

## Live checks

- API `/health`: 200.
- Anonymous `/admin/analytics/overview`: 401.
- Production analytics CORS preflight: 200, exact `https://chef-world.com` origin, credentials allowed, new context headers accepted.
- Dashboard and privacy pages: 200; new dashboard bundle and retention disclosure present.
- In-app browser: the live dashboard redirects signed-out visitors to `/login?redirect=%2Fadmin%2Fdashboard` and renders “Welcome back.” Authenticated dashboard behavior was tested locally; production administrator reporting was verified through the real authenticated API, without requesting the user's password.
- ECS environment and secret references exactly match the previous revision.
- New backend task log scan: zero errors, tracebacks, or analytics collection/maintenance failures.
- Vercel deployment error-log query for the recent 15-minute window: zero returned entries. This is a bounded post-release check, not a claim of continuous monitoring.

## Recovery

Previous ECS revision: `cooking-backend:11`. Previous Vercel deployment: `dpl_5oQNfeKL3MDim5qs5dpgAvw8kwkE`. The analytics migration is additive; an application rollback should retain the new tables and recorded data rather than downgrade/drop them. The pre-account-reset encrypted recovery snapshot remains retained separately.

Release delay was dependency download and a slow ECR browser-layer upload. Production stayed on the old release until the fresh image, runtime checks, and locked migration had passed. No stale image was substituted.
