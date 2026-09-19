# Local capacity harness

This is a reproducible local measurement tool, not a cloud-capacity claim. Use the already-migrated isolated PostgreSQL database and a separately launched test API. The harness creates neither servers nor cloud resources and sends no AI, scraper, upload, email, or payment requests.

## Safety and preparation

- API target must be an explicit `http://127.0.0.1:<unprivileged-port>` or IPv6 `http://[::1]:<port>`. Hostnames, redirects, environment proxies, remote/staging targets, credentials in URLs, and production domains are refused. There is deliberately no staging override.
- PostgreSQL must use literal loopback, a nonstandard unprivileged port, the `capacity_test` role, and the exact `cooking_capacity_test` database. A seed refuses existing accounts outside the synthetic email pattern. Use this dedicated role only for this disposable database.
- Launch the API using this same database with no provider credentials, background warming disabled, and test authentication limits configured explicitly. Disabling auth throttles qualifies ordinary routes only; abuse/login capacity remains a separate test.
- Fixture credentials must reside outside Git in a temporary directory, with mode `0600`. The seeder hashes one strong random password once and creates real distinct user/authentication records. It never prints passwords or tokens. Fixture namespace, account UUIDs, emails, and recipe UUIDs must agree before any run or cleanup.
- The first four accounts receive 10, 100, 1,000 and 10,000 private recipes respectively. Remaining accounts get ten recipes each. The first account additionally owns a public catalog, and every account has a meal plan. Recipes have eight ingredients, six timed steps, description, category, and equipment. Two namespace-scoped synthetic retailer cache entries exercise cache hits without provider traffic.

A fresh migration currently inserts a legacy bootstrap account (`00000000-0000-0000-0000-000000000001`, `migration@local.dev`) in migration `20250228_auth`. The seeder intentionally refuses it under the real-data guard. On a newly created disposable test database only, the operator must lock and inspect that exact account, verify it has zero recipes, meal plans, auth identities and cooking sessions, and remove only that ID/email before seeding. Never remove it if migrated data is attached. The September 18 local run followed those checks; no other account was deleted.

From the worktree root, use the existing Python environment:

```sh
/private/tmp/cooking-security-venv/bin/python scripts/load/capacity.py seed \
  --database-url postgresql+asyncpg://capacity_test@127.0.0.1:55438/cooking_capacity_test \
  --fixture /private/tmp/cooking-capacity-fixture.json \
  --accounts 10000 --library-sizes 10,100,1000,10000 --catalog 1000
```

The default fixture contains 10,000 accounts and 112,070 recipes including its catalog. For a faster development-only fixture use `--accounts 20 --library-sizes 10,100 --catalog 100`; report that smaller dataset faithfully. Every seed creates a new namespace. Reuse existing fixtures; do not repeatedly seed unless intentionally measuring multiple datasets.

## Runs

Replace port 8099 below with the actual isolated API port. Login calls and cooking-session setup run before timed traffic, and login must return the expected synthetic user ID. Tokens exist only in process memory.

```sh
/private/tmp/cooking-security-venv/bin/python scripts/load/capacity.py run \
  --base-url http://127.0.0.1:8099 \
  --fixture /private/tmp/cooking-capacity-fixture.json \
  --output /private/tmp/capacity-smoke.json \
  --users 10 --rates 5 --stage-seconds 20

/private/tmp/cooking-security-venv/bin/python scripts/load/capacity.py run \
  --base-url http://127.0.0.1:8099 \
  --fixture /private/tmp/cooking-capacity-fixture.json \
  --output /private/tmp/capacity-open.json --config scripts/load/local-config.example.json \
  --users 100 --concurrency 100 --rates 5,10,25,50 --stage-seconds 600 \
  --cache-case warm-declared

/private/tmp/cooking-security-venv/bin/python scripts/load/capacity.py run \
  --base-url http://127.0.0.1:8099 \
  --fixture /private/tmp/cooking-capacity-fixture.json \
  --output /private/tmp/capacity-100-sessions.json \
  --users 100 --sessions 100 --think-seconds 2 --stage-seconds 600
```

For a 200-session, five-minute burst, use `--users 200 --sessions 200 --stage-seconds 300`; run a baseline again afterward. Closed sessions report observed requests/second and do not claim an independent arrival rate. For one-hour open load use a single passing `--rates` value and `--stage-seconds 3600`. Maximum open rate is 50 RPS; maximum duration is four hours; concurrency is capped at 256. Outstanding HTTP calls have ten-second timeouts, and clients/DB connections close after use. Think time defaults to two seconds. Choose appropriate stages; long tests are never started automatically.

The arrival scheduler offers requests on a monotonic fixed schedule. If it cannot dispatch on time, reaches its concurrency bound, or would overlap an operation for the selected account, it counts a dropped arrival instead of quietly reducing demand or building an unbounded queue. One randomized ordinary operation per arrival produces the following requested mix (observed route counts are reported):

| Area | Percentage | Routes |
| --- | ---: | --- |
| Library/catalog | 40 | paginated library 20, paginated catalog 20 |
| Recipe details | 20 | owned recipe details |
| Planner | 15 | reads 7, writes 8 |
| Cooking | 15 | reads 8, complete/reopen actions 7 |
| Shopping | 10 | aggregate list 5, cache-only product batch 5 |

Cache-only product batch is a read despite using HTTP POST. Private recipe requests always use the selected account's recipe. Cooking mutations use unique IDs and current revisions. Planner writes send the last-read expected_revision, require each acknowledgement to advance it, and verify final slots plus revision. Existing planner days without a revision abort setup so stale API code cannot silently use the legacy write path. No app DB repository or HTTP endpoint is stubbed.

## Evidence and interpretation

Exit status 0 means every measured stage passed the configured ordinary-operation criteria and measured correctness checks passed; 1 means failed thresholds/correctness or an aborted run; 2 means invalid setup/guard failure. Short smoke passes do not qualify the ten-minute stage, stability, or soak targets. A missing/empty workload cannot pass.

JSON reports contain the Git HEAD, dirty-tree flag, a backend/harness source hash, declared resource config, UTC dates, actual duration, user/dataset counts, arrival model, route read/write counts, p50/p95/p99, response-code counts, achieved throughput, drops, and correctness counters. No auth tokens, private payloads, DB URL, or fixture password are copied to reports. Config ingestion uses an explicit public-field allowlist. Do not put secrets in allowed config values.

Per-route thresholds are strict: read p95 < 500 ms; write p95 < 1,000 ms; all p99 < 2,000 ms. Overall unexpected failures including drops must be < 0.1%. Normal-workload 429, 403, network errors, and invalid JSON count as unexpected failures. Intended owner-isolation 403/404 checks are outside timed normal requests. Other admitted-rejection tests remain separate.

Before and after each stage, every selected account attempts to read another selected account's private recipe through both direct and shared routes. Exposure stops subsequent stages. After each stage the harness reads each account's latest acknowledged planner state and cooking version, then checks every acknowledged cooking mutation against the real database and owner. These checks detect missing final state and missing cooking mutation records; they do not prove survival of every intermediate planner overwrite or cross-replica failure recovery. Setup and correctness verification requests are excluded from ordinary timed throughput and latency.

Cold/warm labels are operator declarations, never inferred proof. A fresh API restart can clear process caches, but login/cooking setup warms some paths and database caches are not cleared. Report `unspecified` unless the operator records the actual cache procedure. The report discloses this limitation. Synthetic cached products do not establish retailer availability/capacity, and AI capacity/cost is untested.

Copy and fill `scripts/load/local-config.example.json` with observed resource settings; null means unmeasured, and unknown settings do not silently become measured facts. Capture CPU/memory, database waits/connections/locks/slow queries, queue/cache metrics, deployment identity, and fixed/usage cost externally. The approved monthly ceiling is $150; local ordinary-load measurements alone cannot establish that cloud usage fits it.

## Cleanup and regression checks

Cleanup validates the fixture namespace and deletes only each listed synthetic user by exact ID **and** email, relying on the schema's cascades for that user's records, plus exactly named namespace-owned cache keys. It never truncates or broadly deletes a table. Keep fixtures until all desired runs finish.

```sh
/private/tmp/cooking-security-venv/bin/python scripts/load/capacity.py cleanup \
  --fixture /private/tmp/cooking-capacity-fixture.json

/private/tmp/cooking-security-venv/bin/python -m unittest discover \
  -s scripts/tests -p test_capacity_harness.py -v
```

Cleanup removes the private fixture only after the transaction succeeds. It leaves the database/server lifecycle to the operator. No cleanup action is automatically run after a measurement.
