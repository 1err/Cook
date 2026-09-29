# Website beta release — September 28, 2026

Deployment date: September 29 UTC / September 28 America/Chicago. Approved application source: `b6e596d2248168d09d4ba802c4bb26afee696699`, branch `codex/beta-web-audit-20260928`. The original dirty checkout was preserved.

## Changes shipped

The release includes the five website audit fixes (planner hydration safety, local cooking dates, cooking refresh race protection, homepage contrast and recipe-editor duplicate keys) plus [shopping refinement and recovery improvements](2026-09-28-beta-shopping-recovery.md). Refinement remains the normal path, preserves authoritative quantities and ingredient distinctions, and labels provider fallback honestly. Temporary failures leave a usable checklist with explicit retry; unchanged checkmarks, hidden rows and retailer choices survive retry. Muse supports the recovery flow, and narrow phone date controls no longer overlap. No native binary or OTA update was published.

## Exact release identities

| Component | Verified identity |
| --- | --- |
| Backend source | `b6e596d2248168d09d4ba802c4bb26afee696699` |
| API task definition | `cooking-backend:31` |
| API immutable digest | `sha256:ae421f8ce75fa87c5c9427facbd6775bc67cd2980306b8c0a687bcec47e1dd5b` |
| ECR tag | `cooking-backend:b6e596d2248168d09d4ba802c4bb26afee696699` |
| Website deployment | `dpl_Ciwo5jxo2MAPdGX7ujnuyXBo5NSe` |
| Website build URL | `https://cook-jg1klgc2l-jerrys-projects-08f739a2.vercel.app` |
| Worker | Unchanged `cooking-store-worker:2` |

The later deployment-helper/documentation commit is not the deployed application source. No application source changed after `b6e596d`.

Both `https://chef-world.com` and `https://www.chef-world.com` were independently confirmed on this READY deployment at **03:11:03 UTC**, returning HTTP 200 without preview credentials.

## Verification

- Fresh backend and web Linux/amd64 images rebuilt dependencies and passed non-root runtime checks. Backend archive SHA-256: `0a99c6d28b625bc08fd860773c2e96c67fe476915ea008e4f4c4d05b806b2cfc`. All 113 application Python files matched committed source. ECR manifest and config digests matched the tested image.
- Fresh web Docker image `sha256:386b2982e31c64cf71351612be0f24e21555f01981d56bd1eeacce70b81438ca` passed 16 route/static/font checks and 35 compiled-asset checks. Vercel's 282 uploaded source files all matched the approved frontend archive (`3c6465ce14c654ee52ce790fdae66e21b7a9d116b0105e1e01810e6307e80133`).
- Locked migration using API31's exact image exited 0 before service update. Deployment script exited 0. Independent verification at **03:09:30 UTC** confirmed API31 COMPLETED, desired/running 1/1, pending 0, healthy target/container and preserved task/container/service settings. `/health` and `/ready` returned 200; protected shopping/refine routes returned 401; the new refinement response contract and credentialed CORS for both public origins passed.
- Four rendered candidate cases passed: desktop and phone homepage controls/language/contrast; 320 px and 390 px shopping failure → fallback → check item → reload → Muse copy → successful refinement/reordering → preserved item/manual pack choice → reload. There were no JavaScript runtime errors or unexpected requests. API/retailer/provider/analytics calls were intercepted with synthetic fixtures. Expected simulated 429 and unauthenticated 401 browser messages were retained as expected outcomes.
- Public website verification at **03:12:52 UTC** passed **162 HTTP checks** across both domains: 36 page checks and 126 assets matching the candidate, including 32 feature-media byte matches. The configured recovery-page/security headers and public worker headers passed. Direct public browser verification passed **5/5**: the four candidate cases repeated on `chef-world.com`, plus normal service-worker script HTTP 200 and activation. API traffic remained mocked/blocked; installed-PWA, offline and share-target behavior were not tested. Screenshots were inspected at 320/390 px with no horizontal overflow or date-control overlap.
- Independent AWS scan at **03:10:19 UTC**, covering **02:40:19–03:10:19 UTC**, examined 58 new API events and two migration events with no error, warning, traceback, database/provider error or HTTP 5xx matches. Unchanged worker2 was healthy; its log was idle in that window and its latest resource metric was fresh. This is bounded evidence, not a guarantee about every request or queued job.
- Vercel log queries covering **03:10:24–03:14:22 UTC** returned **zero error logs and zero HTTP 5xx** (bounded queries, limit 20 each). No raw user log contents were saved.
- Deployment-helper tests: **53 passed**, including a new archive-permissions regression. A preliminary scratch copy outside Git caused the repository-exclusion fixture test to fail because it had no Git marker; the complete suite passed from the actual checkout. Application suite/provider evidence is recorded in the linked implementation QA report.

## Packaging correction

The first fresh backend image was rejected before upload: the private release umask combined with macOS `tar -x` removed source read/search permissions, so UID 1001 could not import the migration module. Re-extracting the same committed archive with `tar -xp` preserved source modes inside the private parent directory. Fresh dependencies were rebuilt; migration/runtime/source-hash checks passed on the final image above. Production used the script's verified `PREBUILT_IMAGE_DIGEST` path. The helper now preserves archive modes for future builds, with a real nested-archive regression test and independent review. No failed image was deployed.

## Recovery and remaining operations work

RDS remains available with seven-day retention, deletion protection and no pending modifications. At 03:10 UTC, point-in-time recovery covered **September 26 04:54:31 UTC–September 29 03:05:18 UTC** (about 2.924 days); the seven-day history is still accruing. All six operations alarms were OK. Their actions remain disabled and the dedicated SNS topic has zero subscriptions pending the owner's operator email selection and delivery confirmation. Account email delivery is separately user-verified. Cloud restore rehearsal and independent recovery of overwritten/deleted images remain unverified; see [recovery and alerts](../recovery-alerts.md).

A compact [sanitized release receipt](2026-09-28-beta-release.json) retains release identities, verification counts and operations state.

## Rollback references

- API: `cooking-backend:30`, digest `sha256:b5e75f8e33c964aeb1d294ae3890bd91994540577a04b7dd60ad14ff68eed716`, source `f8daf63b6b7e352a3b91a5093ee3416aa685a3a7`.
- Website: `dpl_AjEhB4aaBLHGmdodJJHzcVfaG6US`, `cook-r3z21y5c5-jerrys-projects-08f739a2.vercel.app`.

No new database schema revision was introduced; latest remains `20260926_menu_creation`. Recheck current production identity before any later rollback. Backend comes before website when releasing cross-layer changes. No real production account, planner, recipe, retailer or mail writes were used for release verification.
