**Chef World shopping repair — QA evidence, 2026-10-20**

The release is deployed and verified. The final read-only audit at **2026-10-20T18:20:53.119440+00:00** found **107/107 public ingredient keys with fresh positive cached products: zero stale and zero missing**. [All ingredient timestamps](2026-10-20-public-ingredient-cache.csv).

Commit: `081488452e3389cd620e6ff36989167dd33f67f2`  
Backend digest: `sha256:038a87b7d571921b574f03b7e6cd25b1f36a75af5c30b440191b86e5314c51bb`  
[Build identity](2026-10-20-shopping-cache-reliability-evidence.json)

**Causes and fixes**

Production durable warming used the fixed 405-query list; earlier public-catalog discovery only reached the local warmer. At 17:47:54 UTC, the catalog contained **107 keys: 61 fresh, 46 expired, 0 missing**. The latest completed warm included 59 public keys and omitted 48. The daily schedule was persisted; this was a query-coverage failure. [Before audit](2026-10-20-shopping-cache-reliability-evidence.json)

Both warm paths now share normalized, deduplicated discovery with public names first. Durable catalog failure aborts admission for retry; an existing active job retains its snapshot. Worker deployment preserves its command and health check.

Refinement failed at 17:39:08.405 UTC with a **35,026 ms provider timeout**. Known aliases, arithmetic, ranges, and categories now resolve locally; optional AI retains admission and cost controls. Failures preserve usable quantities, while missing amounts and unknown units remain partial. Quantity version 3 prompts explicit refresh of older saved lists without losing checked items. [Timeout evidence](2026-10-20-shopping-cache-reliability-evidence.json)

**Validation**

| Check | Result |
| --- | --- |
| [Backend](2026-10-20-shopping-cache-reliability-evidence.json) | 1,779 passed; 6 skipped |
| [Linux release image](2026-10-20-shopping-cache-reliability-evidence.json) | 74 passed |
| [Web](2026-10-20-shopping-cache-reliability-evidence.json) | 992 passed |
| [Shared / API client](2026-10-20-shopping-cache-reliability-evidence.json) | 420 / 78 passed |
| [Mobile](2026-10-20-shopping-cache-reliability-evidence.json) | 411 passed |
| [Deployment script](2026-10-20-shopping-cache-reliability-evidence.json) | 33 passed |
| [Shopping browser tests](2026-10-20-shopping-cache-reliability-evidence.json) | 12 passed |
| [Web build](2026-10-20-shopping-cache-reliability-evidence.json) | Passed, including lint/type validation |

Coverage includes real PostgreSQL manual/scheduled admission, rollback, stable snapshots, persistent cache publication, quantity preservation, and optional-AI accounting. The backend reported two dependency deprecation warnings.

**Live evidence**

- At 2026-10-20T18:20:49.547462+00:00, **API `cooking-backend:52` and worker `cooking-store-worker:3`** were `COMPLETED` and `HEALTHY`, both running the exact digest above. The API load-balancer target was healthy. The worker deployment helper exited 1 during a transient incomplete check; independent verification subsequently passed without redeployment. [Service evidence](2026-10-20-shopping-cache-reliability-evidence.json)
- Vercel production is `READY` at **`dpl_GuJ6nX8WMcfscXKZx5X9pp3Kw6V3`**; promotion succeeded. Previous deployment for rollback: `dpl_9SWMCxmpGSHemZuFv6prJ2CB9116`. [Live deployment](2026-10-20-shopping-cache-reliability-evidence.json), [promotion](2026-10-20-shopping-cache-reliability-evidence.json), [previous deployment](2026-10-20-shopping-cache-reliability-evidence.json)
- Seven public HTTP checks and 11 assets passed: pages, API health/readiness, CORS, and unauthenticated refinement rejection (`401`). Served assets contain the new shopping copy and exclude the old unavailable copy. [HTTP evidence](2026-10-20-shopping-cache-reliability-evidence.json)
- The released module passed synthetic alias/total/range, missing-contribution, and simulated-timeout checks with **zero external I/O and zero real provider calls**. Authenticated refinement HTTP and the live AI provider remain **untested**. [Scoped refinement evidence](2026-10-20-shopping-cache-reliability-evidence.json)
- New warm job **`74680dca-95bb-4513-8504-4547a83ecc82`** was admitted with **453 unique keys, all 107 public keys, zero omissions**, and `force_refresh=false`. It subsequently completed all 453 entries: 407 fresh cache hits and 46 newly fetched results, with zero failed, empty, or skipped entries. The independent final audit verified every public key had positive fresh cached products. [Warm admission](2026-10-20-shopping-cache-reliability-evidence.json)

**Daily scheduling and follow-up**

The enabled durable worker uses a 24-hour interval. Its persisted next due time is **2026-10-21T15:54:11.478037+00:00** (October 21, 10:54 a.m. Chicago). Each new run reads the then-current public library. The next daily run has not occurred yet; the repaired manual run and schedule configuration are verified.

The www shopping URL redirects to the canonical website. Bounded API, worker, and web error scans were clear after deployment/refill. Customers with an older prepared list should reload the page and choose **Refresh smart list** once; checked items are preserved.

API rollback is `cooking-backend:51`; worker rollback is `cooking-store-worker:2`. Recheck live state before rollback. No native binary was published. Application source is committed on the attached branch `codex/shopping-cache-reliability-20261020`; remote main was not updated. Carry application commit `081488452e3389cd620e6ff36989167dd33f67f2` into future releases. This later documentation commit does not change deployed application source.
