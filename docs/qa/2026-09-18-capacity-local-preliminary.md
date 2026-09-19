# Preliminary local capacity characterization — September 18, 2026

This run exercised a local native Uvicorn process and isolated PostgreSQL, with no cloud deployment or provider calls. It is preliminary characterization, not qualification of the completed release. The server was started before the subsequent planner revision and upload-budget changes; those changes require a separate restart and measurement.

Dataset: 10,000 real synthetic accounts, 112,070 recipes including 1,000 catalog recipes, selected private libraries of 10/100/1,000/10,000 recipes. One hundred distinct accounts authenticated through the real login endpoint before timing.

| Offered RPS | Duration | Requests | Dropped | Unexpected errors | Highest route p95 | Highest route p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 60.001s | 300 | 0 | 0 | 19.103 ms | 131.689 ms |
| 10 | 60.001s | 600 | 0 | 0 | 13.314 ms | 14.750 ms |
| 25 | 60.003s | 1500 | 0 | 0 | 11.892 ms | 72.734 ms |
| 50 | 60.001s | 3000 | 0 | 0 | 9.480 ms | 116.271 ms |

All four 60-second stages passed the ordinary-route latency and unexpected-failure thresholds. Across stages, 5,400 ordinary requests completed; zero requests failed or were dropped. The highest passing rate in this bounded local run was 50 RPS. This does not establish ten-minute stages, one-hour stability, a four-hour soak, cloud capacity, or affordability under the $150 monthly ceiling.

Correctness: 1,000 expected-denial owner-isolation checks, 485 acknowledged final-state readbacks, 400 durable cooking mutation checks, one synthetic cache freshness check; zero failures. Intermediate planner overwrites were not individually audited. Setup/check traffic is excluded from ordinary route metrics.

Source: Git HEAD `748ae762788a022fa31538a62cd4873fa5548607` with uncommitted changes; recorded backend/harness SHA-256 `b37000a9be6beccb25d566addd04e648912ddf582dddf100e8ca964e57e61410`. That is the source observed by the harness, not proof of all code already imported by the earlier server process. Reports retain this limitation.

A single resource snapshot during the run observed PostgreSQL 18.3, max_connections 100, three current connections including the observer, no lock waiters, API RSS 67,056 KiB and CPU 2.1%. Host: ten CPUs and 24 GiB RAM, shared with other work. These are neither peak measurements nor allocated container resource limits.

Artifacts: `2026-09-18-capacity-local-smoke.json`, `2026-09-18-capacity-local-open.json`, and `2026-09-18-capacity-local-resource-snapshot.json` in this directory. Exact run: `capacity.py run --base-url http://127.0.0.1:8099 --fixture /private/tmp/cooking-capacity-fixture-20260918.json --output docs/qa/2026-09-18-capacity-local-open.json --users 100 --concurrency 100 --rates 5,10,25,50 --stage-seconds 60 --config scripts/load/local-config.example.json --cache-case warm-declared`.

During setup, the seeder correctly refused the empty legacy migration bootstrap user. After confirming the fixed migration UUID/email and zero attached records, only that user was removed. A smoke test then found shared-cookie reuse in the load client; the harness now sends explicit independent bearer credentials and no shared cookie. Regression tests cover both safe refusal diagnostics and cookie isolation.

The harness has subsequently been updated to use the current planner expected_revision contract and verify returned/stored revisions. Follow-up smoke and five-minute 200-session burst await the final migrated server restart.
