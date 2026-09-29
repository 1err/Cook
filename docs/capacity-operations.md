# Capacity and operating controls

The current owner-approved AI ceiling is **under USD 30 per month**; the beta overlay allocates **USD 29 per UTC calendar month**. Existing hosting is acceptable to the owner. This supersedes the earlier USD 150 combined planning assumption. The application ledger covers modeled app requests, not taxes, historical spending before activation, or other applications sharing the provider credential. Controls and local tests do not establish a production user-count guarantee or automatically change cloud resources.

## Deployable unit and preflight

Use the same reviewed, immutable backend image for API, migration and the separate Linux retailer worker. The worker command is `python -m app.jobs.worker`; its task must not inherit the HTTP API healthcheck. Production resolves `STORE_JOBS_MODE=auto` to `durable`. Deploying only the API without its worker would leave uncached retailer work waiting until a retryable timeout.

Run `python -m app.migrate` as a controlled one-off release task. Its PostgreSQL advisory lock serializes migrations. The deployment script requires that the task from the new immutable image succeeds before updating the API service, then verifies actual rollout/image identity and `/ready`. Serialize releases externally as well: independent deployers can otherwise race between the final state check and ECS update. Apply additive migrations before shifting traffic; roll back application images without immediately downgrading shared schema.

Before production rollout, verify:

1. Complete AWS/Vercel/AI cost estimates at the configured scaling maximum, including worker, private egress, logs, alarms, storage/transfer, release overlap and contingency.
2. Dated provider pricing, company-controlled project credential, model/token/request limits and an explicit AI allocation. Default AI monetary caps are **zero**. Merely keeping the old API key does not enable paid calls on this branch.
3. Worker task command, non-root Linux runtime, database access, permitted retailer access, health/recovery monitoring and process containment tests in the actual image.
4. Database migration, pool/connection budget, backup configuration and certificate trust. Bound CPU/memory/task count using the values actually tested.
5. Load balancer readiness path `/ready`, graceful drain timing and trusted proxy addresses. Authentication IP limits use the ASGI peer; do not trust arbitrary forwarded headers. Without verified proxy trust, ALB peers can share an allowance and legitimate sign-in throughput can suffer. Restrict direct ingress and test real forwarded-client behavior before enabling at scale.
6. A verified existing-image inventory baseline. New cumulative counters start empty; they bound new growth and do not retroactively measure historical objects.

`scripts/prepare-scaling.py` is a historical planning tool using the former USD 150 combined worksheet. It accepts sanitized resources and emits reviewable request bodies; it **cannot apply them** and is not the current spending policy. Its two-API maximum and one-worker estimates require all eight cost components, including verified zeros. Do not apply its private-subnet assumptions to the existing public-subnet service without verifying egress. A single-AZ database remains a failure domain.

## Current application defaults

These are code defaults, not confirmation of production environment values. See `backend/.env.example` for configuration names.

| Boundary | Default |
| --- | --- |
| Recipe summaries | 40/page; maximum 100; signed caller/filter-bound cursor |
| Planner/shopping date range | Inclusive maximum 31 days |
| Planner contents | Maximum 100 recipes per meal slot |
| Database pool per process | 5 connections, no overflow; wait at most 5 seconds |
| Database statement/lock/idle transaction | 15 / 5 / 15 seconds |
| Database budget model | 60 total; reserves 10 for administration plus 1 migration and 1 supervisor per worker process; includes rollout overlap |
| AI accepted operations per account | 6/minute, 50/day |
| AI accepted operations globally | 60/minute, 1,000/day |
| AI shared in-flight operations | Global 4, account 1; operation deadline 85 seconds |
| AI paid calls per admitted operation | Maximum 2; SDK automatic retries disabled |
| AI monetary allowance | App $0, account $0 until explicitly allocated and priced |
| Auth admission | Global 120/minute; login 60/IP/minute and 10/account/minute; signup 20/IP/hour and 5/account/hour |
| Upload request/image | Multipart body 12 MiB, individual image 10 MiB, validated signatures |
| Ordinary mutation request body | 1 MiB including actual streamed bytes |
| Upload rate | Global 120/minute; account 30/hour and 50 MiB/day |
| Cumulative upload reservation | App 10,000 objects / 5 GiB; account 200 objects / 100 MiB |
| Retail queue | 100 queued/running jobs; one global scraper; at most 2 attempts |
| Retail execution/lease | 125 seconds plus cleanup margin; fixed 180-second lease |
| Retail terminal result retention | 24 hours, pruned in bounded batches; latest warmer status retained |

Fixed minute/day windows permit a burst on both sides of a boundary; shared in-flight limits are a separate protection. Cumulative image allowances include abandoned drafts and unconfirmed storage writes. They do not reset on a timer or automatically refund failures. Recover allowance only after verifying object inventory and cleanup; never reset counters while objects may still exist. Historical image deletion/ownership remains a separate migration, and this release does not delete user images.

Deprecated recipe array routes remain for old mobile versions. They intentionally retain the old response shape and can read an entire library. The capacity statement covers current paginated clients. Enforce a supported minimum client version and measure remaining legacy usage before removing those endpoints.

## Administration and diagnostics

Admin access continues to depend on verified immutable account UUIDs in `ADMIN_USER_IDS`, never an email sent by the client. Jerry's existing configured identity should remain in that allowlist; no credential or live account mutation is part of this branch.

- Existing cache refresh/status endpoints use shared durable state in production.
- `GET /admin/ai-usage` reports UTC-month modeled spent/reserved dollars, tokens, active leases and a bounded page of accounts. It is not an invoice and cannot see other consumers of the provider key.
- `GET /admin/operating-limits` reports configured cost/AI/upload/job limits and cumulative storage reservations. `billing_verified=false` is deliberate: reading config cannot establish total hosting bills.
- `/health` is process liveness; `/ready` performs a bounded schema/database check and returns 503 when unavailable. Readiness does not establish worker or third-party availability.

Keep operational telemetry free of prompts, private recipe contents, tokens, passwords and signed URLs. Before a capacity claim, install and test alerts for per-route p95/p99/error rate, DB checkout/locks/slow queries, task CPU/memory, queue depth/oldest age, worker failures, AI outstanding reservations, storage growth and total spend. Prepared alarm bodies are not active alerts; confirm delivery to the designated operator.

## Recovery rules

See [recovery and operations alerts](recovery-alerts.md) for the verified seven-day RDS backup/deletion protection, six initial metric alarms, pending notification delivery, image-recovery gap and private restore rehearsal procedure. These controls do not establish a tested RPO/RTO or user-capacity guarantee.

**AI outage or ambiguous timeout:** fail boundedly and keep the monetary reservation. Unknown usage cannot be refunded automatically; reconcile the exact call from authoritative usage later. Core non-AI library/planner/cooking features remain available. Provider-denied calls are settled as denied without retrying the same operation.

**Retail worker failure:** admitted jobs persist. Ownership/fencing prevents stale results from replacing current results. Automatic recovery requires confirmed browser cleanup, not merely lease expiry. A process whose containment cleanup is unknown must remain blocked until an operator confirms its container and descendants are gone. See the worker implementation and review evidence before resetting any cleanup marker.

**Database loss:** readiness fails and admissions fail closed. Do not send work to an unmigrated database or replace missing private data with examples. Recover from verified backups and validate accounts, recipes, planner, cooking state and image references before re-admitting traffic. The proposed 15-minute RPO/one-hour RTO have not been established by local functional tests.

**Overload:** preserve admission caps, diagnose the limiting resource and reduce offered traffic. Add replicas only within the measured database connection and cost budgets. Do not remove safety checks to make a benchmark pass.

## Qualification contract

The reproducible provider-free harness is documented in [the harness guide](qa/2026-09-18-capacity-harness.md). Reports must identify the code actually loaded by the server, schema, resources, cache procedure, dataset, offered and achieved throughput, percentiles, dropped arrivals, correctness checks and concurrent background activity.

Local PostgreSQL/host results validate code and the workload generator. They do not qualify the smaller production ECS/RDS resources, cross-zone behavior, live AI/retailer throughput, disaster recovery or actual monthly cost. The remaining staging gates are the full ten-minute arrival stages, one-hour stability run, four-hour soak, 200-session burst/recovery, multiple-replica comparisons, provider and infrastructure failure drills, and database/image restore. Publish the highest **measured passing** workload and all failures/unrun gates rather than describing scalability as unlimited.
