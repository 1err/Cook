# Chef World Capacity Qualification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible, affordable operating capacity for Chef World, including traffic spikes and failure recovery.

**Architecture:** Retain the existing Next.js / Expo clients, FastAPI application, PostgreSQL and S3. Bound work per request, coordinate background work across replicas, and qualify the exact deployed configuration through staging measurements before increasing production traffic.

**Tech Stack:** Existing application stack; proposed k6 load harness; AWS ECS/CloudWatch; provider usage and hosting billing records.

**Spec:** This qualification plan derives from [the architecture](../../architecture.md) and the gaps recorded in [the September 15 release verification](../../qa/2026-09-15-production-release.md). The proposed targets below define the acceptance specification; they are not observed results or an approved infrastructure budget. Feature implementation details require separate scoped plans against the release checkout.

## Implementation update — September 18, 2026

The owner approved implementation and a **$150 combined monthly operating ceiling**. The `codex/scalability-20260918` branch implements bounded recipe pages/current clients, planner revisions, explicit database capacity, durable retailer jobs with Linux browser containment, per-call AI monetary reservations, shared auth/upload limits, cumulative new-upload storage allowances, trusted-proxy configuration, readiness and controlled release migrations. A provider-free workload harness and dry-run infrastructure preparation are included.

See [the operating runbook](../../capacity-operations.md), [budget evidence](../../qa/2026-09-18-operating-budget.md) and [local harness guide](../../qa/2026-09-18-capacity-harness.md). These additions do not mark the cloud qualification checkboxes below complete. No new infrastructure or production release has been applied. Real provider ownership/pricing, a complete monthly forecast, exact-resource staging, multi-replica failure/restore drills and the long stability/soak targets remain explicit gates. Deprecated legacy list endpoints are outside the bounded-client statement; historical images require inventory before cumulative allowances describe the whole bucket.

## Global Constraints

- Preserve the current product structure, web/mobile features, private account boundaries and manual pasted-link import.
- Base implementation on release commit `748ae762788a022fa31538a62cd4873fa5548607` or a verified successor; preserve unrelated work in the original dirty checkout.
- No load test has been run by creating this plan. No production configuration, allowance, billing setting or resource has changed.
- Load and failure tests use isolated staging with synthetic accounts and a separate database/bucket. Never aim stress traffic or destructive recovery drills at production.
- Use simulated providers for high-volume application-capacity tests. Report those results separately from a small, budgeted live-provider validation; simulations cannot establish OpenAI or retailer capacity.
- Public source publication is separate from deployment. The earlier release was not pushed to public GitHub.
- Qualify a workload, release, configuration and budget together. A passing capacity figure is not an unlimited scalability guarantee.

## Proposed initial acceptance targets

These are engineering targets for the next phase, not promises about the current system. Business adoption and traffic generation are separate dimensions.

| Dimension | Proposed target or rule |
| --- | --- |
| Adoption scenario | 10,000 registered accounts; 1,000 daily active users |
| Interactive baseline | 100 simultaneously active user sessions with realistic reading/thinking delays; report actual request rate |
| Burst scenario | 200 active sessions for five minutes, followed by return to baseline |
| Independent arrival-rate test | Ramp 5, 10, 25 and 50 ordinary API requests/second, holding each for ten minutes; report the highest passing rate rather than assuming all stages pass |
| Stability | One hour at target load; four-hour soak at baseline after tuning |
| Ordinary API latency | Per-route p95 below 500 ms for reads, 1,000 ms for writes; p99 below 2,000 ms; measure at the load generator in the declared region |
| Ordinary operation success | Unexpected failures below 0.1%; zero missing acknowledged writes, unauthorized data reads or duplicate effects in tested operations |
| Admission controls | Intended rejection tests report expected 429 separately; unexpected 429/403 in the normal workload count as failures |
| AI demand scenario | Five operations per daily active user implies 5,000 operations/day. Current global cap is 1,000/day, so the target is not available under current settings |
| AI completion | Report end-to-end latency separately, including admission, queue time, provider work and recovery; establish the target from live-provider measurements and product tolerance |
| Storage | Large-library tests include 10, 100, 1,000 and 10,000 recipes per selected account, plus a representative large public catalog |
| Cost | Record monthly fixed infrastructure plus usage costs at the target workload. Jerry supplied a $150 combined monthly ceiling; affordability still requires verified allocation and a desired per-user allowance |

Sessions are not in-flight requests, and neither is equivalent to registered accounts. A claim about 1,000 simultaneous sessions requires its own passing test at that level; do not infer it from the adoption scenario.

## Task 1: Freeze the workload and measurement contract

**Files:** Read `docs/architecture.md`, `docs/qa/2026-09-15-production-release.md`; create a versioned workload manifest and final evidence under `docs/qa/` when the qualification run is prepared.

**Inputs:** Proposed targets above, synthetic dataset, exact application revision and staging resource configuration. **Output:** A versioned workload manifest and baseline report.

- [ ] Record task CPU/memory, replica count, database tier/version/connection limit, region, image digest, frontend revision, provider mode and timestamp.
- [ ] Define an initial ordinary-request mix: 40% library/catalog reads, 20% recipe details, 15% planner reads/writes, 15% cooking reads/actions and 10% cached shopping reads. Record the read/write split and request count produced by each user journey.
- [ ] Exercise login/signup, uploads, AI operations and uncached retailer lookup separately, then include bounded amounts in the combined workload. Use distinct users rather than one account/token for every virtual user.
- [ ] Seed realistic recipe sizes, many small accounts, several large libraries and a hot public catalog. Run cold-cache and warm-cache cases; retain privacy and cross-account assertions under both.
- [ ] Record p50/p95/p99 per route, unexpected errors, requests/second, DB connection wait, slow queries/locks, memory, CPU, queue depth/age, cache hit rate and AI usage. Never log tokens, raw private recipes or credentials.

**Acceptance:** A second engineer can reproduce the same input workload and interpret each metric without knowing this conversation. A failed request or dropped load-generator iteration cannot disappear from the report.

## Task 2: Close the known application capacity gaps

The following are bounded implementation work packages. Their acceptance tests are required before qualification; they are not claims that these changes already exist.

| Work package and code entry points | Required acceptance evidence |
| --- | --- |
| Paginated recipe summaries: `backend/app/db/repo_recipes.py`, `backend/app/api/routes_recipes.py`, `backend/app/api/routes_users.py`, `packages/api-client/src/index.ts`, web/mobile library and planner consumers | Enforced page maximum; deterministic cursor ordering including equal titles; owner/public filtering on every page; page traversal and concurrent-change semantics; detail fetched only when needed; supported older mobile clients retain a documented transition path |
| Database capacity: `backend/app/db/session.py`, repository queries and Alembic migrations | Explicit connection budget covering API replicas, rollout overlap, workers, migrations and admin reserve; bounded pool/statement waits; explain plans on seeded data; indexes justified by observed queries; no assumption that adding replicas creates DB capacity |
| Shared jobs: `backend/app/services/store_product_service.py`, `backend/app/jobs/cache_warmer.py`, `backend/app/api/admin.py` | Durable job ownership, deduplication, bounded queues, retry caps, restart recovery and shared status; killing a worker does not permanently lose an admitted job; no duplicate external side effects; retailer traffic stays within verified provider permissions |
| AI admission/cost: `backend/app/db/repo_ai_usage.py`, `backend/app/api/ai_budget.py`, `backend/app/core/llm.py` | Atomic account/app reservations; cost reserve before calls and reconciliation after usage; bounded in-flight work and a total operation deadline including queue/provider/recovery time; all model calls/recovery paths included; unknown timeout costs kept conservatively reserved; provider 429/outage behavior tested; measure global-counter lock contention before changing its storage design |
| Abuse and retries: `backend/app/api/auth.py`, `backend/app/core/http_security.py`, mutating route/client callers | Shared account/IP-aware protection for expensive auth and upload traffic; legitimate users behind one network remain usable; bounded retry behavior; idempotency/conflict handling for retryable writes; storage count/retention limits as well as per-image byte limits |
| Release/failure isolation: `backend/Dockerfile`, `backend/app/main.py`, `scripts/deploy-backend.sh` | One controlled migration job per release; at least two API replicas in separate availability zones for availability qualification; graceful draining; appropriate readiness; database/object storage independent of API process lifetime; bounded scaling maximum |

Each package needs a separate implementation review and targeted regression tests. Preserve the modular application; introduce additional services only for a measured bottleneck or required job durability.

## Task 3: Establish the operating budget

**Files:** Read provider/configuration entry points above; create a sanitized cost worksheet under `docs/qa/` after actual measurements. **Output:** Cost per successful operation, monthly workload estimate and tested admission policy.

- [ ] Confirm a company-controlled OpenAI project/service identity, applicable model request/token limits and actual billing ownership.
- [ ] Measure tokens and costs for typical, large, failed and recovered imports/refinements. Include all calls within an operation; do not infer cost from operation count alone.
- [ ] Calculate monthly cost as fixed hosting plus 30 days of AI, storage requests, retained storage growth, image delivery, database/worker usage and logs. Show both ordinary demand and a sustained busy scenario.
- [ ] Record Jerry's monthly ceiling and per-user allowance; derive app-wide admission and concurrency caps that fit them with a contingency reserve. Raising the 1,000/day global cap requires this decision and provider-throughput verification.
- [ ] Verify provider spend enforcement, application reservations and alerts independently. Simulate exhausted budgets without spending the real budget; verify core non-AI functions remain available and users receive an actionable message.

Current OpenAI documentation distinguishes alerts from enforced organization/project spend limits and notes that enforcement propagation can permit a small overrun. Treat provider controls as an additional boundary, with conservative application-side reservations and monitoring. [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits)

## Task 4: Run qualification and failure drills

**Files:** Proposed harness location `scripts/load/`; publish sanitized results under `docs/qa/`. **Inputs:** Tasks 1–3 complete. **Output:** Pass/fail report with raw metric summaries and exact artifact identity.

- [ ] Smoke the harness at very low load; verify it touches only seeded staging data and reports deliberate failures correctly.
- [ ] Execute the stepped workload, cold-cache case, one-hour target run and burst recovery. Use an arrival-rate scenario so a slowing server cannot silently reduce offered traffic and make the test look successful.
- [ ] Exercise AI admissions just before and after UTC minute/day rollover across multiple replicas. Fixed windows permit clustered admissions near boundaries; verify concurrency bounds, budget reservation and successful throughput separately from fast quota rejections.
- [ ] Repeat with one, two and four API replicas where staging budget permits. Measure the limiting resource and cost per successful request; investigate plateaus before enabling automatic scaling. Do not require mathematically linear scaling from a system sharing one database.
- [ ] At baseline load, terminate one staging API replica. Verify recovery, acknowledged-write persistence and error rates. Proposed recovery target: within two minutes; record actual replacement/startup time and keep capacity headroom for that interval.
- [ ] Inject provider slowness/429, database unavailability, worker termination, duplicate client requests and oversized uploads. Assert bounded queues/timeouts, useful error messages, recoverability and no unauthorized reads.
- [ ] Restore a staging backup into a separate database and verify sample accounts, recipes, planner and cooking data. Proposed disaster targets: at most 15 minutes of lost data and recovery within one hour; qualify database and image lifecycle together before adopting those targets.
- [ ] Run the four-hour soak and verify memory, connection counts and queues recover after load falls. Stop the test on cross-account exposure, data corruption, persistent saturation or the predeclared staging cost ceiling.

AWS recommends increasing load to find saturation and repeating with additional tasks to identify useful scaling metrics. k6 thresholds can make latency/error criteria produce a failing test result. [AWS capacity testing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-autoscaling-best-practice.html), [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)

## Task 5: Publish and maintain the capacity statement

**Files:** Final sanitized `docs/qa/` report; update `docs/architecture.md` and `CLAUDE.md` only when implemented behavior changes. **Output:** An evidence-backed capacity statement and operating runbook.

- [ ] Report tested workload, simultaneous sessions, actual request rate, dataset size, latency percentiles, errors, provider mode, failure recovery, cost and every failed/unrun scenario.
- [ ] Verify production matches the qualified configuration; run lightweight live checks after rollout, without repeating staging stress traffic on production.
- [ ] Establish monitoring/alerts for service latency, error rate, database waits, queues, storage growth and spend; assign an operator and document rollback and incident response.
- [ ] Repeat relevant load tests before material query, authentication, AI, worker or infrastructure changes, and when real traffic/recipe sizes exceed the tested assumptions.

Only then describe the app as qualified for the recorded operating target. Keep untested higher traffic levels explicit. Security assessment, privacy obligations and App Store approval remain separate qualifications.
