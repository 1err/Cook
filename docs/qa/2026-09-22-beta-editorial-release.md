# Beta and editorial integration — September 22, 2026

Status: integration and deployment preparation in progress. This document does
not assert a production rollout. The owner explicitly requested the beta branch
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

- Combined web: 384 unit tests; TypeScript and production build passed.
- Combined native: 323 tests; TypeScript passed. No device build or App Store
  release is implied.
- Shared/API client: 49 tests passed.
- Delivery safety: 43 tests passed using the project's Python environment.
- Local browser against a disposable real PostgreSQL database: account creation,
  manual recipe save/detail, planner insertion and basic grocery aggregation pass.
- The first browser suite exposed outdated visual/layout expectations while the
  source UI task was still changing. Final snapshot, visual review and regression
  rerun remain required; the earlier partial run is not a release pass.
- Fresh backend and web images plus their runtime verification remain required.

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
