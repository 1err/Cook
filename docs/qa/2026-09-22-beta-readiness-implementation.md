# Beta readiness implementation and release handoff

**Status:** local implementation based on `b3e7ef8` in `.worktrees/beta-readiness-20260922`. No production deployment, AWS mutation, paid provider request, or real email was performed. Public-site changes and the global UI redesign remain separate, unmerged workstreams. Preserve existing Library, Planner, Shopping and Cook behavior during integration.

The owner accepts current hosting temporarily. The explicit new constraint is **at most USD 30/month of modeled app AI usage**; the earlier USD 150 combined planning ceiling is superseded. Historical budget reports and the old `scripts/prepare-scaling.py` USD 150 refusal are not a current spending mandate. No additional infrastructure spending is implied.

References: [approved design](../superpowers/specs/2026-09-22-beta-readiness-design.md), [implementation plan](../superpowers/plans/2026-09-22-beta-readiness.md), [account lifecycle/retention report](2026-09-22-account-lifecycle-implementation.md).

## Implemented behavior

| Area | Release behavior |
| --- | --- |
| Manual recipes | Web/native Import and empty libraries lead to manual creation through the existing editor/save API. Require a title, ingredient and instruction; omit empty rows. No parser/provider call. |
| Library | Personal/catalog pages load and retry independently, retain successful content on failure, and reject stale responses. Pagination/copy behavior remains. |
| Basic groceries | Aggregated ingredients render without AI. Web supports check/copy; native supports check/share and selectable text. Failed previews do not block groceries. Smart refinement and product/cart choices remain. |
| Retailer requests | Replica-shared PostgreSQL limits: 120 global/30 account requests per minute; 12 global/2 account concurrent requests; 30-second deadline; retryable 429/503. Batches allow 100 queries/512 characters each. Clients split 200 items into two serial batches and cancel stale work. Durable job containment remains. |
| Recovery/verification | SES adapter, generic responses, hashed single-use expiring tokens and first-party fragment links. Web clears fragments and avoids third-party assets. Native requests recovery in-app and completes it on the web. Missing setup is reported as unavailable. |
| Sessions/deletion | Logout revokes its token; logout everywhere/reset revoke earlier sessions. Password-confirmed deletion removes owned relational data and queues image cleanup. Successful server outcomes clear client state; failures remain retryable. Support/privacy links are available. |
| Image cleanup | Ownership receipts, settling time, leases/retries protect uploads and copied references. The API runs cleanup independently of the retailer worker. Shared copies, backups, unowned legacy local uploads and minimal accounting/cleanup records have separate retention rules. |

## AI allowance and activation

Atomic global/account reservations precede paid calls. Confirmed usage reconciles once; unknown outcomes retain their full reservation. Deleting/recreating an account never refunds global usage or reservations. Database admission clamps the global maximum to USD 30, including across replicas. Defaults remain **USD 0**, so unconfigured paid work fails closed while manual features stay usable.

The unactivated [beta overlay](../../backend/.env.beta.example) proposes **USD 29/app and USD 3/account per UTC admission month**, leaving USD 1 below the hard maximum. It pins supported GPT-4o mini pricing to USD 0.15/input and USD 0.60/output per million tokens, with versioned prices, bounded output and four global/one account concurrent AI operations. Reverify provider prices before activation. Other API-key consumers, taxes, hosting, provider price changes and invoice-period timing are outside this modeled cap.

Pending: a dedicated company-controlled OpenAI project/key, verified prices/limits, billing alerts and authoritative release configuration. The example does not activate spending; provider alerts are not invoice hard stops.

## Pending SES setup

Choose and verify the sender/region, confirm production sending access, then set `EMAIL_PROVIDER=ses`, `SES_REGION`, `SES_SENDER_EMAIL`, `SES_IDENTITY_VERIFIED=true`, and `PUBLIC_WEB_ORIGIN`. The origin must exactly match an allowed CORS origin and use HTTPS in production. Grant the API task role sender-restricted `ses:SendEmail`; never embed credentials in clients.

Until verified, keep email disabled and `/auth/capabilities` false. Known/unknown addresses receive the same unavailable response. Controlled real delivery, expiry/replay and spam-placement checks remain pending. API acceptance is not delivery evidence; a crash of the in-memory delivery task can require requesting another link.

Cleanup defaults: `ACCOUNT_CLEANUP_ENABLED=true`, `ACCOUNT_CLEANUP_POLL_SECONDS=30`. Grant prefix-scoped `s3:DeleteObject`. Verify retries and retention disclosures; account deletion does not mean immediate erasure of every copy/backup.

## Read-only AWS cost findings

Account `930067562682`, checked September 22. The August 1 inclusive–September 1 exclusive result was **non-estimated USD 80.1115227513** account-wide. This is not app-only attribution.

| Service | August USD |
| --- | ---: |
| VPC | 29.78999448 |
| ECS | 18.3725438701 |
| Load balancing | 16.7577253924 |
| RDS | 14.2039999632 |
| Route 53 | 0.5110692 |
| ECR | 0.4759184601 |
| S3 | 0.0002713855 |

The earlier September 1 inclusive–September 22 exclusive query returned **USD 54.5986243743** for that partial period. The reported USD 80/week remains unreconciled from this connected account alone; check other accounts, invoice periods and billing items. Neither amount guarantees future bills.

All inspected public IPv4 addresses were in use; the ALB enables six AZs, `a`–`f`. A possible separately reviewed optimization is reducing it to two eligible AZs. **If that removes four continuously billed addresses**, savings are `4 × $0.005 × 730 = $14.60` per 730-hour month, excluding other charge changes. AWS currently lists USD 0.005/address-hour. This is a conditional estimate, not achieved savings. [AWS VPC pricing](https://aws.amazon.com/vpc/pricing/), verified September 22.

Before any change, map ECS placement/subnets and all targets, retain at least two eligible AZs with healthy targets, and stage the rollout with target-health/error monitoring and rollback. Targets in disabled AZs do not receive ALB traffic; validate actual address release and billing afterwards. No ALB/subnet/address changes were made. [AWS ALB subnet requirements](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html).

## Release ordering

1. **Freeze source and build fresh images.** Fill the evidence table; record backend/web immutable digests. Prior builds do not establish fresh packaging. Integrate public-site/UI changes separately and repeat affected behavior/visual checks, including native-device review.
2. **Migrate before starting the new API or worker.** Verify backups/recovery, serialize releases, and run `python -m app.migrate` from the exact backend image under the PostgreSQL migration lock. The chain is `20260918_upload_budget → 20260922_store_waiters → 20260922_account_lifecycle`. A failed migration stops rollout. Prefer application rollback while preserving additive schema; do not automatically downgrade shared data.
3. **Roll out API and separate Linux retailer worker** from the same image; retailer command: `python -m app.jobs.worker`. Verify roles, proxy/CORS, database connection/rollout budgets, storage and containment. Account cleanup starts with the API. Confirm image identity, `/health`, `/ready`, worker progress and cleanup health; readiness alone does not establish provider/worker availability.
4. **Roll out web/native against the new contract.** Run the functional checks below, including email-disabled behavior, cookies/native tokens, CORS and secret-free logs. Do not advertise recovery before real sender setup works.
5. **Activate external services only with completed setup.** Finish the SES gate above. Separately apply the reviewed USD 29 overlay with the dedicated OpenAI project/key and verified rates; confirm admin usage reports spent, outstanding reservations and remaining allowance. Keep zero-budget behavior honest until activation.
6. **Stage traffic and monitor.** Verify alerts, recovery and backups on deployed resources before expanding beta access. Local/synthetic tests do not establish live-provider capacity, concurrent-user guarantees or an AWS cost ceiling.

The existing [capacity operations runbook](../capacity-operations.md) supplies migration/worker mechanics; its old combined-budget and pre-account-cleanup statements are historical where this handoff supersedes them. Production rollout is a separate release decision; this document does not perform it.

## Manual functional acceptance

Run with disposable local/staging accounts and controlled service doubles until external activation is explicitly scheduled.

| Flow | Expected result |
| --- | --- |
| Manual recipe on both platforms | Create from Import/empty Library, reject incomplete rows, save a complete recipe, reopen it; observe save only and no parse/refine/provider request. |
| Partial library failure | Fail catalog while personal recipes succeed, then reverse. Retry only the failed source; preserve successful cards/pagination. Switch account during a pending load and verify no old content appears. |
| Groceries with AI unavailable | Plan a saved recipe; check and copy/share raw ingredients before refinement. Fail refinement and meal preview; basic list remains usable. Verify smart product choice/cart behavior afterwards. |
| Large cached product list | Load 101 and 200 unique cached ingredients; observe batches of at most 100, serial preflights, no per-item fallback caused by batch length, and cancellation on list/account change. |
| Recovery/verification | Exercise unavailable, generic known/unknown email, invalid/expired/reused link and password-mismatch states. Valid reset requires a fresh sign-in and old sessions fail. Confirm token fragments disappear. |
| Logout/deletion | Wrong password or failed request preserves the account for retry. Successful logout/deletion clears private client state; old tokens fail. Delayed responses/cross-tab switches cannot revive or overwrite another identity. |
| Cleanup/accounting | Delete an account with own and copied images using isolated storage. Own unreferenced objects retry safely; shared/foreign references survive. Existing global AI spent/reserved amounts remain. |
| Allowance exhaustion | With fake AI usage, admit up to the configured remaining amount, reject excess/concurrent overspend and retain unknown-call reservations. Manual recipe/grocery flows still work. |

## Final integration evidence

Integrated verification completed on `codex/beta-readiness-20260922`, based on `b3e7ef8`. These results describe local code and disposable test data only. The delivery commit is recorded in this branch history.

| Check | Final result / evidence |
| --- | --- |
| Reviewed source revision and clean diff check | Branch `codex/beta-readiness-20260922`; independent product, budget, account and client review completed; `git diff --check` passed. |
| Full backend and disposable PostgreSQL concurrency/lifecycle suites | 731 passed; six Linux containment cases skipped on macOS. Real local PostgreSQL lifecycle/concurrency/migration tests included. Log: `/private/tmp/chef-beta-full-backend-accounts-final.log`. |
| Full web, native, shared and API-client suites | Web 360, native 322, shared 32 and API-client 17 passed (1,462 app tests including backend). Web log: `/private/tmp/chef-beta-web-tests-20260922.log`; native/shared results captured in task outputs. |
| Web/native TypeScript and production web build | Both app type checks and final production web build passed. Build log: `/private/tmp/chef-beta-web-build-20260922.log`. |
| Browser functional checks and native-device visual review | In-app browser: manual save → recipe → planner → deterministic groceries, check/copy controls, account confirmation, sign-out everywhere, unavailable recovery, secret-fragment removal. Desktop and 390×844 account layout checked; native-device visual review remains pending. |
| Fresh backend/web images, immutable digests and runtime checks | **PENDING — release gate** |
| SES real delivery, dedicated AI project/key and authoritative overlay | **PENDING — external setup/activation** |
| Migration, deployed readiness, worker health and staged capacity | **PENDING — no production rollout performed** |

## Additional verification and limits

- Delivery safety: 42 tests passed; Docker build-context scratch fixtures, design-token test/generated CSS consistency, repository hygiene and English/Chinese message-key parity passed. CI now installs its previously missing pinned `httpx==0.27.2` test dependency.
- Account review regressions cover same-account refresh during logout, failed new-session/cross-tab refresh, stale responses, Unicode password length, re-registered email counter safety and late upload cleanup.
- Final web security headers returned `no-store`, `no-referrer`, `nosniff`, frame denial and the recovery-route CSP. Recovery HTML contains no external font/photo assets.
- A disposable local HTTP check returned 403 for an incorrect deletion password, retained authentication, then deleted with the correct password and returned 401 afterwards. The synthetic account was removed. No production user was involved.
- Local basic groceries worked without an OpenAI key; optional refinement used its deterministic fallback. The AI call ledger remained empty. Budget rejection and retry failures were verified with automated doubles, not paid calls.
- Browser check/copy state was verified through rendered controls; the automation checkbox locator changed its accessible name after a successful toggle, so subsequent checks used the updated accessibility state. No application framework overlay was observed.
- Local builds used existing installed workspace dependencies, with the pinned transcript package isolated in a temporary Python path. Fresh locked installs, Linux image/containment checks, full immutable images, real provider delivery and production capacity remain release gates. Next reported the existing nested-worktree tracing and standalone/start-mode warnings; the local runtime matches the current Dockerfile start command.

UI integration: merge this branch together with its `b3e7ef8` scalability prerequisite before resolving the separate public-site/redesign branch. Do not cherry-pick only the final beta commit onto an older backend without that prerequisite. Keep the new API contract, private-state remounts, recovery pages/headers, manual/basic-list paths and failure states when adapting visuals.
