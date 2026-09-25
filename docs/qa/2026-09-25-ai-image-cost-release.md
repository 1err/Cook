# AI recipe covers and cost reporting — release evidence

Deployed and verified September 25, 2026. Source, container, production, and signed-in browser checks are distinguished below.

## Source and behavior

- Release source: `08795001692b696563d12e0a5ac6f3c2ba6bc963` (includes the Muse merge).
- Recipe import and editing offer AI-generated cover previews with explicit acceptance and recipe saving. Generation does not change saved recipes automatically.
- Ordinary accounts receive up to **3 image attempts/day**; verified administrators receive up to **100/day**. Default shared image caps are 100/day and 10/minute; each account remains limited to 1/minute.
- Durable, account-scoped request IDs prevent duplicate provider calls. Completed results are recoverable; failed or interrupted attempts never restart under the same ID.
- Admission, provider work, storage, and finalization share a bounded deadline. Pre-provider expiry is checked explicitly; cleanup is bounded. Provider/storage work holds no database connection.
- Generated images use the existing owned-image lifecycle and cumulative storage allowances. Manual-upload hourly quotas are unchanged. Full storage rejects before generation; a concurrent capacity change can still prevent storage after a charged provider response.
- Future membership gating uses trusted server-side feature grants; billing checkout/webhooks are not included.

## Cost controls and scope

Images reserve and reconcile usage through the existing shared AI monetary ledger. The pre-release production configuration reported **$29/month globally** and **$3/month per ordinary account**. Administrator image calls may use the configured global amount as their account allowance; they still obey the same global budget and repository-enforced $30 hard cap. This release does not authorize an increased global AI budget. Daily image allowances are maxima, subject to shared budget, concurrency, and storage capacity.

`GET /admin/ai-costs` reports UTC month-to-date provider/model/operation totals, usage tokens, known estimates, unresolved reservations, generation outcomes, and coverage. Prices are versioned estimates using standard provider rates; totals are **not invoices**. Missing usage and ambiguous failures retain their monetary reservations. Definitive unbilled denials refund money; admitted attempts still count toward image quotas. Pre-ledger activity, other API-key usage, taxes, and hosting are excluded.

The reviewed image configuration is `gpt-image-2`, one low-quality 1024×1024 PNG, with a 45-second provider timeout. Reviewed standard rates are $5/M text-input tokens and $30/M image-output tokens; the output-only example is approximately $0.006 plus prompt input. See the [official image guide](https://developers.openai.com/api/docs/guides/image-generation). Other unreviewed models fail closed.

`GET /admin/infrastructure-costs` is separate: bounded, cached AWS Cost Explorer unblended estimates cover the **AWS account**, not an exact Chef World allocation. Vercel and other providers are not included. Unavailable billing data is shown as unavailable rather than zero. The user explicitly approved read-only `ce:GetCostAndUsage` for `cooking-backend-task-role`; the dedicated inline policy was applied and IAM simulation verified allowed. Existing policies were preserved.

## Verification completed

| Check | Evidence/result |
| --- | --- |
| Backend integration suite before Muse merge | **1,124 passed**, 6 expected Linux-only skips, 2 dependency deprecation warnings; isolated PostgreSQL at local port 55464 |
| New PostgreSQL image/cost regressions | **8 passed**: concurrent idempotency, account/global quotas, shared monetary cap, entitlement expiry, stale-result race, and honest cost aggregation |
| Account deletion | Image quota counters removed; copied assets and global monetary spend preserved |
| Web integration suite before Muse merge | **620 tests passed**; **21 image/cost browser checks passed**, as reported by the frontend owner |
| Mobile integration suite before Muse merge | **354 tests / 45 suites passed**, as reported by the mobile owner |
| Exact post-merge shared/API verification | **252 shared tests + 39 API-client tests passed** on `0879500` |
| Exact post-merge TypeScript | Web and mobile `tsc --noEmit --incremental false` both passed; checkout remained clean |
| Migration | One head, `20260925_recipe_images`, following production `20260924_video_import`; fresh and repeated migration passed in the runtime container |
| Fresh backend image | Linux/amd64, non-root; **134 source/build/migration/dependency hashes** match `0879500`; `pip check` passed |
| Linux/runtime checks | All **6 containment regressions** passed, including real Chromium descendants; Chromium/TLS, 30 MiB boundaries, auth/isolation, durable jobs, RedNote mocked-provider flow, and graceful shutdown passed; no OOM |
| Image/cost runtime contract | Administrator 100/day and ordinary 3/day confirmed; cost route restricted to admins; **zero paid provider calls** in this test environment |
| Fresh web image | Passed: fresh linux/amd64, non-root runtime; production API, routes, service worker and exact AI/cost/AWS/Gemini/Muse feature markers verified |

Fresh verified backend image digest: `sha256:ca56bdee0b346c99dc290378341cf96d2ce4e2b56c1e1e83a79d71751cdb2f3c`.

Local evidence directory: `/private/tmp/chef-ai-costs-release-20260925/`. Key records: `source-sha`, `backend-build.json`, `backend-runtime/runtime-result.json`, `backend-runtime/runtime-image-cost-contract.log`, `backend-runtime/runtime-source-hashes.json`, and `web-build.log`. Runtime image contracts used disabled provider budgets and mocked provider behavior; they do not prove live model access or generated-image quality.

## Live release evidence

- API task definition: `cooking-backend:21`, source `08795001692b696563d12e0a5ac6f3c2ba6bc963`, immutable digest `sha256:ca56bdee0b346c99dc290378341cf96d2ce4e2b56c1e1e83a79d71751cdb2f3c` in ECR `930067562682.dkr.ecr.us-east-1.amazonaws.com/cooking-backend`.
- Locked migration completed before service update. ECS completed its exact requested rollout; running digest and healthy readiness target verified. Worker remains `cooking-store-worker:2`.
- Configuration fingerprints confirm existing credentials, all eight Gemini settings, budgets, and service configuration were preserved. Health/readiness 200, anonymous image/admin cost routes 401, CORS and bounded backend/worker log scans passed.
- Vercel: `dpl_6ky4tLkndUsPvdp6FdchX246BbsF`, built from the same frozen source. Both `chef-world.com` and `www.chef-world.com` point to it. All 31 checked live assets equal staged hashes. Error/fatal/5xx scans returned zero.
- Signed-in administrator UI verified at approximately 20:36 UTC. The Costs tab loaded real AI ledger data and AWS Cost Explorer data through the production task role. Administrator generation allowance was 100/100 before and 99/100 after one request.
- One real `gpt-image-2` image was generated from an unsaved 豆腐茄子煲 draft. The account-owned S3 PNG loaded at 1024×1024. Visual inspection confirmed tofu and eggplant in a claypot, with no overlaid text. **Use image** applied it while preserving the draft title and description. No recipe was saved and existing recipes were not modified.
- Image accounting reported 192 input and 196 output tokens, one completed request, no failed/pending image requests, and **$0.0068** displayed estimate. Overall recorded AI estimate changed from $0.2746 to $0.2815 (each display is rounded); reserved and uncertain amounts were $0.00. Remaining shared AI allocation was $28.7185 of $29.00.
- AWS account-wide September month-to-date estimate: **$63.1733**, fetched 20:34:17 UTC and cached up to six hours. Largest services: VPC $23.2830, ECS $14.6280, load balancing $13.0654, RDS $11.1328. These are account costs, not an exact app allocation or final invoice. Vercel charges remain linked rather than connected.

## Verification limits and rollback

Live checks used the existing administrator session. Non-admin isolation, ordinary 3/day access, request replay, image save persistence, concurrency and failure behavior were verified in automated tests; they were not repeated using another production account or by creating a production recipe. Historical AI totals begin with the September 24 ledger and do not reconstruct earlier spending. Provider billing remains authoritative. This release publishes web/backend only; native source requires a separate native binary release.

Previous API revision: `cooking-backend:20`, digest `sha256:a689027cba1418fe40899e9d1705e74f86961001d4079dd8cd0ecd0e3eb05f91`. Previous website: `dpl_7h33SMUgPbeYLR4yML79AM6zbe8Z`. The additive image schema can remain in place during an application rollback; do not downgrade or delete usage records without separate review.
