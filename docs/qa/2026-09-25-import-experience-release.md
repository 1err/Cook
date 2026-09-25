# Import experience production release

The user authorized deployment after reviewing the local UI preview. Application source is `e630e61f02e5d15696920c41e408137f3112309c`, based on deployed source `317d78c`. The demo server is outside the repository and was not uploaded.

## Delivered behavior

- Preparation replaces the import form inside the main card; manual creation is prominent.
- Draft review uses a concise positive notice with expandable details.
- Additional recipe text stays within the edited draft. Applying a proposed replacement is explicit; cancellation, failure, and rejection preserve the original work.
- Successful video/media results omit redundant analysis. Eligible text/caption results retain recovery.
- Imported nonblank steps receive labeled planning estimates when source times are unstated, with an estimated total. Source evidence remains separate; verified source moments and user-entered timers are preserved where applicable.
- Existing provider generations, credentials, budgets, schema, and the 30 MiB upload limit remain unchanged.

## Verification

- 531 web, 73 shared, 36 API-client, and 949 backend tests passed. 106 database-dependent tests were skipped in the local suite. Sixteen browser setup errors under the sandbox passed on an unsandboxed retry; both original and retry logs are retained.
- TypeScript and fresh Linux/amd64 backend/web image builds passed. Backend runtime checks verified 127 committed file hashes, non-root execution, dependencies, offline Chromium, all six Linux containment regressions, disposable PostgreSQL fresh/repeated release migrations, queue processing, account isolation, import limits, and graceful shutdown.
- Earlier desktop/mobile UI checks used example API data. They covered preparation/cancel, manual creation, contextual updates, rejecting a candidate without losing edits, and no mobile horizontal overflow.
- Independent source audit matched all 204 staged frontend files to the application commit. No backend, secrets, `.env`, local `.next`, or fixture server was included.
- The production website uses `https://api.chef-world.com`. All 19 live CSS/JavaScript assets match the staged build; demo API markers are absent and the new review copy is present.
- The signed-out live browser followed the expected login redirect with zero console errors. No fresh authenticated live provider import was performed in this release. Provider extraction quality is therefore not newly established by these deployment checks.

## Production result

- API: `cooking-backend:19`, immutable digest `sha256:f2258a015a6c5a384ee843b4cacb39879fac466740a5ed63ab289b01e78efd9e`.
- Website: `dpl_JBWUVJGDgRFfyBLf8o8p3D7f2Vdk`, READY and promoted to both production domains.
- Worker: `cooking-store-worker:2`, unchanged, with preserved image/configuration fingerprints.
- Website container: `sha256:e3df1b27c119307bae27933f79453089f93981df94dad65ff107469386e28d22`.
- Sharing worker SHA-256: `b2bb56581ea34da2d6a4afc06d00310d7255dd5e9b2e30ba74130a84e0328357`, unchanged.

The deployment script completed its locked migration and requested revision 19. Its immediate rollout guard returned before ECS marked completion; the nonzero script result is retained. Independent read-only checks then verified the completed PRIMARY revision, one running healthy task with the exact image, unchanged provider/service configuration, API health/readiness HTTP 200, protected import routes HTTP 401, and production CORS. No second deployment was issued.

The final backend scan at 05:17:43 UTC covered 76 API log events, with zero warnings, errors, tracebacks, unavailable import workers, or HTTP 5xx responses. Worker runtime checks passed; its bounded log stream contained no events. The exact Vercel deployment returned zero error, fatal, or HTTP 5xx records in its complete 15-minute query through 05:17:18 UTC. One healthy load-balancer target matched the new task; one previous target was still in normal draining state at the last check. These are bounded release observations, not continuous monitoring guarantees.

## Rollback and evidence

Previous API: `cooking-backend:18`, digest `sha256:c800c5e4966765388305abf537e2cec219d6c36771c274b3bee04578fccc2254`. Previous website: `dpl_8zpiJUzgWdLMR71zaGSeEsqZ1189`. No schema downgrade is required for this release.

Evidence is under `/private/tmp/chef-import-release-20260925/`, including source manifest, build/runtime results, independent source audit, staged/live asset verification, production API/configuration/log checks, and promotion records. This directory also contains private deployment bookkeeping and is not an upload bundle; only the separately audited `vercel-source` subset was uploaded. Documentation changes may follow the frozen application commit without changing deployed runtime code.
