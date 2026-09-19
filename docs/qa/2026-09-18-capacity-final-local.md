# Final local capacity measurements — September 18, 2026

The restarted local backend passed the measurements below against real PostgreSQL and real synthetic authenticated accounts. This establishes the recorded local workload only; it does not qualify cloud capacity, the full stability/soak targets, provider throughput, or the $150/month operating budget.

| Scenario | Timed duration | Completed / offered | Dropped | Unexpected errors | Actual RPS | Highest route p95 / p99 | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| smoke: 5 offered RPS | 20.001s | 100 / 100 | 0 | 0 | 5.000 | 20.653 / 21.037 ms | Pass |
| open: 5 offered RPS | 60.002s | 300 / 300 | 0 | 0 | 5.000 | 11.541 / 121.500 ms | Pass |
| open: 10 offered RPS | 60.002s | 600 / 600 | 0 | 0 | 10.000 | 12.111 / 16.215 ms | Pass |
| open: 25 offered RPS | 60.002s | 1500 / 1500 | 0 | 0 | 24.999 | 12.162 / 20.604 ms | Pass |
| open: 50 offered RPS | 60.002s | 2999 / 3000 | 1 | 0 | 49.982 | 10.467 / 20.596 ms | Pass |
| burst: 200 sessions, 2s think time | 301.794s | 29399 / 29399 | 0 | 0 | 97.414 | 70.072 / 1837.777 ms | Pass |
| recovery: 10 offered RPS | 30.002s | 300 / 300 | 0 | 0 | 9.999 | 12.006 / 122.259 ms | Pass |

Across these final measurements: **35,198 completed ordinary requests**, 1 dropped arrival, zero unexpected API/network failures, and 0 correctness failures. A dropped arrival is included in failure-rate accounting. Each route passed read p95 < 500 ms or write p95 < 1,000 ms, and p99 < 2,000 ms; each stage remained below 0.1% unexpected failures including drops. Detailed route counts, percentiles, and response-code counts are in the JSON reports. **The burst cache-only product route reached p99 1,837.777 ms, leaving only about 162 ms below the two-second threshold.** This limited tail margin should be retained in any capacity statement.

Correctness checks: 2,240 expected-denial cross-account reads; 934 acknowledged final-state readbacks; 2,503 durable cooking mutation checks against PostgreSQL; 4 synthetic cache freshness checks. Planner writes used the last-read expected_revision and required each successful response to advance it, with final slot/revision persistence verified. Intermediate overwritten planner states were not separately audited.

Dataset: 10,000 accounts, 112,070 recipes including 1,000 public catalog recipes, and selected private libraries of 10/100/1,000/10,000 recipes. The open stages used 100 distinct accounts. The burst used 200 independently authenticated closed-loop sessions with two-second think time; its observed RPS must not be read as an independent arrival-rate qualification at that RPS. Recovery was a 30-second, 10-RPS arrival workload using 100 distinct accounts.

This shared local machine is larger than the intended smaller production deployment; transfer of these results to that deployment is unproven.

Configuration: one native Uvicorn process/worker, no reload/proxy headers, test app environment, auth abuse limiting disabled for the ordinary-capacity scenario, background store jobs disabled, empty provider credentials. PostgreSQL 18.3 on loopback with max_connections 100; API pool 5 with zero overflow; checkout timeout 5s, statement timeout 15s, lock timeout 5s, idle-transaction timeout 15s. Host: ten CPUs, 24 GiB RAM, shared native execution with no CPU/memory container caps. Exact sanitized runtime settings and effective command hashes are attached in the loaded-source JSON. Unknown entries in the original example config are superseded by that separately verified configuration evidence.

Resource sampling: 140 observations at five-second intervals across authentication/setup, timed traffic, and correctness checks. Sampled maxima: API RSS 122.55 MiB; OS-reported API CPU 100.9% (100% approximates one CPU); database connections 6 including the observer; database lock waiters 0. These are sampled maxima, not continuous peak measurements. Database CPU/RSS, query plans, pool wait duration, queue latency, and provider costs were not measured by this harness.

Loaded backend source SHA-256: `05f91404639e6e7072f1f600e8e319143b7c1617748c6c3518cea26e38cc05de` across 70 app Python files. The hash was recorded before the no-reload server launch, matched before and after each final phase, and was verified again afterward. At measurement time, Git HEAD was `748ae762788a022fa31538a62cd4873fa5548607` with uncommitted changes; raw reports additionally record the broader backend/harness hash. The root's 15.22-second backend regression may have overlapped smoke only. The main open stages, burst, and recovery ran without other root heavy work or UI builds.

Provider/cache boundary: synthetic cached product rows and database-backed ordinary routes only. No AI generation, live retailer lookup, uploads, signups, object-storage traffic, or live provider validation occurred. Warm labels are operator declarations; setup itself warms selected paths, and database buffers were not flushed.

Acceptance not covered by these measurements: ten-minute arrival stages, a separate 100-session closed-loop baseline, one-hour stability, four-hour soak, deliberately cold-cache qualification, multi-replica cloud tests, production configuration matching, provider/cost qualification, and disaster/failure drills. The short recovery check shows successful ordinary traffic after this burst; it does not establish every resource returning to a long-term baseline.

Artifacts in this directory:

- [Final smoke JSON](2026-09-18-capacity-final-smoke.json)
- [Final open JSON](2026-09-18-capacity-final-open.json)
- [Final burst JSON](2026-09-18-capacity-final-burst.json)
- [Final recovery JSON](2026-09-18-capacity-final-recovery.json)
- [Final resources JSON](2026-09-18-capacity-final-resources.json)
- [Final loaded-source JSON](2026-09-18-capacity-final-loaded-source.json)

The subsequent [synthetic backup/restore check](2026-09-18-local-restore.json) passed. After verification, the owned local API and disposable PostgreSQL instance were stopped; synthetic data and private local fixtures were retained for reproducibility. No production service or database was modified.
