# Scalability implementation and verification

This branch preserves Chef World's recipe import/review, library, planner, cooking and shopping features while adding bounded work, shared coordination and operating controls. It is based on reviewed release `748ae762788a022fa31538a62cd4873fa5548607` in an isolated `codex/scalability-20260918` checkout; the original working tree is preserved.

**Status:** implementation verified locally; no production deployment, public source publication, new cloud resources or paid provider tests performed. The owner's combined monthly ceiling is **$150**. Neither a source-code change nor local throughput measurements establish the final hosting bill or cloud capacity.

## Implemented controls

| Area | Result |
| --- | --- |
| Recipe browsing | Signed cursor pages of summaries, bounded page sizes, deterministic ordering, server filtering and explicit detail fetches across current web/mobile consumers |
| Planner | Atomic day revisions prevent simultaneous-device overwrites; clients reload conflicts; date ranges and per-slot contents are bounded |
| Database | Bounded pools, checkout/statement/lock waits; explicit connection budget including API/worker rollout overlap, supervisor, migration and administration |
| Retail jobs | Durable PostgreSQL admission/deduplication, one global scrape, shared warmer/status, fencing and retry limits; Linux containment verifies browser descendants are gone before lease recovery |
| AI | Atomic global/account money reservation before each paid call, authoritative usage reconciliation, conservative unknown-cost handling, shared concurrency and total operation deadlines |
| Auth/uploads | Shared account/IP-aware admission with explicit trusted-proxy boundaries; daily and cumulative upload byte/count allowances before storage |
| Operations | Admin-only usage/limit reports, database/schema readiness, one same-image locked migration before rollout, and dry-run infrastructure preparation that requires a complete estimate at or below $150 |

Independent reviews found and corrected admission deadline gaps, source-process cancellation/backpressure, detached browser cleanup, cache-hit timestamp renewal, omitted connection consumers, proxy/IP aggregation and a mobile copied-recipe refresh regression. Regression tests cover the failures, including actual child processes and local Chromium without networking.

## Verification

| Check | Evidence |
| --- | --- |
| Complete backend suite with real disposable PostgreSQL | 681 passed, six Linux-only containment skips on macOS; two existing dependency warnings |
| Linux containment | Final rerun: six actual-process/Chromium tests passed in 6.761 seconds using the existing local backend image, current source mounted read-only, and container networking disabled |
| Web suite | 332 passed; production Next.js build passed |
| Mobile | Final complete suite: 43 suites, 289 tests passed, including recopy/refresh races |
| Shared API client | 14 passed, including pagination and planner revisions |
| Types | Web and mobile TypeScript checks passed |
| Release/harness scripts | 42 passed, including migration ordering, immutable digest verification, cost refusal and workload safety |
| Build contexts | Real Docker ignore-rule tests exclude private paths and preserve required source/examples |
| Independent focused review checks | 46 backend tests and four API pager/planner tests passed |

Database tests include real concurrent spending/storage reservations, shared request windows, planner conflicts, recipe privacy/ownership, idempotent cooking/copy operations and migration lock/rollback. A combined PostgreSQL test initially exposed a catalog fixture-isolation assumption; the test now uses its own synthetic search namespace and the complete backend suite passes on a populated disposable database.

**Fresh container packaging remains unverified.** Both final Dockerfile builds were attempted. The web image stopped while fetching npm with `ETIMEDOUT`; an independent fetch from an unmodified Node container reproduced the timeout. The backend image installed Python/system dependencies but failed after repeated Chromium CDN connection closures/resets. These downloads prevented successful fresh images; the native web build, build-context checks and existing-image Linux containment tests do not replace that release gate. No dependency version or security setting was changed to bypass the failures.

## Capacity evidence and interpretation

The provider-free harness seeds 10,000 distinct synthetic accounts and 112,070 recipes, including selected libraries with 10/100/1,000/10,000 recipes and 1,000 catalog recipes. Final measurements use a restarted native API whose loaded application source is recorded separately from the dirty-tree Git base. They exercise actual authentication, API, SQL and persisted planner/cooking state; synthetic cached retailer products stand in for external shopping data.

The [final capacity report](2026-09-18-capacity-final-local.md) records passing 60-second arrival stages through 50 RPS, a five-minute 200-session burst and a 30-second recovery. Across the final phases, 35,198 ordinary requests completed, with one counted dropped generator arrival, zero API/network errors and zero correctness failures. The burst observed 97.4 RPS with two-second think time; this is not an independent 97.4-RPS arrival qualification. Its worst-route p99 was 1.838 seconds, close to the two-second target. Active sessions are not the same as simultaneous in-flight requests.

The [local synthetic restore](2026-09-18-local-restore.json) also passed: a PostgreSQL snapshot dump restored into a separate new database in 19.098 seconds, with matching counts and complete row-content digests for eight tables, including all 10,000 users and 112,070 recipes. This used local disk while container builds ran; it does not establish cloud backup availability, image restoration, disaster RPO or production RTO.

Local host resources are shared ten CPUs/24 GiB, one native API process without a container resource cap, PostgreSQL 18.3 and a maximum of 100 database connections. These differ materially from the observed production 0.5-vCPU/1-GiB API task and single-AZ `db.t4g.micro` PostgreSQL 17.9. No production capacity figure follows from the local result.

## Required before production rollout or an investor capacity claim

1. Finish the [complete cost allocation](2026-09-18-operating-budget.md), including Vercel, a worker, peak API replicas, logs/egress, release overlap and contingency. App money controls do not cap unrelated hosting/provider charges.
2. Verify company-controlled AI project ownership, current prices and provider throughput. Configure explicit app/account AI allowances; both default to zero, so deploying defaults would leave paid import unavailable.
3. Complete fresh backend/web container builds and runtime/containment checks against those immutable images, then configure the separate Linux worker, actual trusted ALB subnet CIDRs, health/drain behavior, connection budgets, storage inventory and alert delivery. Prepared infrastructure JSON is not installed infrastructure.
4. Run the full qualification on the exact deployed resource shape with production-equivalent admission settings, active background jobs, cold/warm cache cases and a representative combined workload including separately budgeted uploads/AI/provider traffic: ten-minute arrival stages, one-hour stability, four-hour soak, multiple replicas, failure/recovery and database/image backup restoration. Local synthetic restore is not cloud point-in-time recovery or an RPO/RTO commitment.
5. Establish the legacy-client transition. Deprecated array list routes and omitted planner revisions retain compatibility and are excluded from the bounded/current-client guarantee. Historical images need inventory/ownership reconciliation; new cumulative counters describe growth since their inventory baseline.

The operating and recovery procedures are in [capacity-operations.md](../capacity-operations.md). There is no claim of unlimited scalability, 1,000 simultaneous users, complete high availability, or measured live-provider capacity.
