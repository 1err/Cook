# Beta and editorial integration — September 22, 2026

Status: integration verified; production rollout blocked by missing resource
approval and failed fresh-image downloads. The owner explicitly requested the beta branch
and editorial redesign together and authorized deployment after verification.

## Sources and preservation

- Beta base: `fcd133398230cc8c6989bb6b5a06b319a281de56`, including the earlier
  `b3e7ef8` scalability prerequisites.
- Published frontend branch: `codex/compact-app-20260921`, `3c87f7b`.
- Editorial source: `.worktrees/editorial-ui-20260922`. Its original frontend
  baseline hashes match `3c87f7b`. Fixed snapshots are merged with three-way
  comparisons so the beta's newer data/account handling survives visual changes.
- The original dirty checkout and active editorial worktree remain untouched.
- This branch preserves manual creation, independent library retries/pagination,
  basic groceries, account recovery/deletion/revocation, and the monetary ledger.
  Instacart controls are removed as requested in the editorial task; dormant
  provider helpers remain available without exposing an activation UI.

## Verification so far

- Combined web: 389 unit tests; TypeScript and production build passed at application source `72c0c94`.
- Combined native: 323 tests; TypeScript passed. No device build or App Store
  release is implied.
- Shared/API client: 49 tests passed.
- Delivery safety: 43 tests passed using the project's Python environment.
- Local browser against a disposable real PostgreSQL database: account creation,
  manual recipe save/detail, planner insertion, basic grocery aggregation, checking/copying, and password-confirmed deletion pass. The disposable account is gone and the AI ledger contains zero calls. Recovery pages retain no-store, no-referrer, CSP, nosniff and frame-denial headers; no external Google stylesheet appears on them.
- The final production-mode browser suite passes on both macOS and Linux: 94
  tests and 17 intentional viewport skips per platform, zero failures, without
  updating snapshots. Nine macOS references and nine changed/new Linux references
  were visually reviewed. Linux used the cached official Playwright test runtime
  with the CI Chinese font package, while the host served the built application;
  it does not replace a fresh application image or a native Linux application build. Earlier failures were resolved through final UI integration, local
  SVG icons, and complete API fixtures. Inter and Source Serif are bundled locally;
  the external icon stylesheet and decorative sign-in photo dependency are gone.
- Both fresh image attempts failed during dependency downloads: backend PyPI
  read timeout and web npm connection reset. See the [backend attempt](2026-09-22-backend-image-attempt.md)
  and [web attempt](2026-09-22-web-image-attempt.md). Image runtime checks remain
  unrun. No application deployment occurred; the unchanged production API's
  `/health` returned HTTP 200 after these attempts.
- A fresh lockfile audit reports zero high/critical findings. The 32 moderate
  package aggregates trace to the same two existing leaf advisories documented
  in the dependency report (`decode-uri-component` and native tooling `uuid`);
  no findings were suppressed or automatic major upgrades applied.
- Independent review found no actionable P1/P2 regressions in the inspected
  beta-preservation changes; it did not substitute for final-image verification.

## Deployment preparation

- Existing API rollback task: `cooking-backend:10`, digest
  `sha256:eb02230ca613b9814989e77586fb15b76309c57e15254df2cafc410a08cf0c48`.
- Existing Vercel rollback deployment: `dpl_D84jeErKFWVcfd4FXe5MHzGqcKNK`.
- The API release script now supplies an explicit ECS liveness health check and
  120-second graceful stop timeout; ECS does not inherit image-only monitoring.
- The release contains Amazon's official regional public RDS CA bundle. The
  reviewed overlay enables TLS certificate and hostname verification with it.
- Existing ALB subnet CIDRs were verified before preparing proxy trust settings.
- AI overlay: $29 per UTC calendar month app-wide, $3 per-account ceiling,
  GPT-4o mini at $0.15/$0.60 per million input/output tokens, four global AI
  operations and one per account. Unknown provider outcomes retain reservations.
- Email domain, DKIM, MAIL FROM and restricted sender permission are verified;
  see [SES setup](2026-09-22-ses-setup.md). Recovery email stays disabled until
  feedback handling and Amazon production access are confirmed.
- Automatic approval review rejected creation of private SNS/SQS feedback
  resources because those resources and permissions were not explicitly named
  in the user's authorization. The user has been asked to approve those exact
  additions and the separate grocery worker before either is created.
- The grocery worker is required by production durable jobs. One fixed
  0.5-vCPU/1-GiB worker costs approximately $21.67/month including one public IPv4
  address at 730 hours, excluding logs/transfer. No autoscaling or worker has been
  activated during preparation.

## Resume order and owner actions

1. Obtain the requested approval for the approximately $22/month grocery worker
   and private email-feedback queue, and confirm the contact email for Amazon.
   Automatic review blocked the queue creation; do not retry that mutation until
   explicit approval arrives. The reviewed resource templates are prepared but
   inactive.
2. Once downloads work, build both fresh application images from the final
   committed release and run their container checks. The existing images and
   host/browser checks do not satisfy this release gate.
3. Complete bounce/complaint feedback, then submit the truthful SES production
   access request. Keep sending disabled until Amazon approves it. The owner may
   need to respond to Amazon or click an email confirmation; the engineering
   setup and submission can be handled here.
4. Run the locked migration, then roll out the verified API and approved worker
   with the reviewed database/TLS/proxy/AI settings. Verify worker operation and
   API readiness before switching the ALB health path or promoting the frontend.
5. Verify the exact deployed images, website flows, email delivery, CORS and logs
   before inviting beta users. Begin with a small cohort and use measured request
   latency, database pressure, job age and AI usage to decide when to expand.

No future deployment or retry is scheduled. Neither the $29 application policy
nor the new account/recovery UI is active in production yet.

## What $29 of AI means

These are planning scenarios, not measured production averages. At 4,000 input
tokens and 2,000 output tokens, one model call costs $0.0018. Assuming 20% of app
actions require a second call, 500 monthly users making 20 AI actions each would
cost $21.60. Longer prompts/answers, extra attempts and unresolved reservations
reduce capacity. At double that token usage, approximately halve the user count.

The per-account $3 limit is a ceiling, not a reservation of $3 per registered
user. Manual recipes, library CRUD, planning and basic groceries consume no AI
allowance. Concurrent server capacity is a separate qualification; four AI
operations can be active at once, and excess requests receive a retryable limit.

Sources verified today:
- https://developers.openai.com/api/docs/models/gpt-4o-mini
- https://aws.amazon.com/fargate/pricing/
- https://aws.amazon.com/vpc/pricing/
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html

The ledger bounds new modeled app usage. It cannot establish historical provider
spending before activation, taxes, or usage from other consumers of the same key.
