# Website beta: refinement and recovery

Date: September 28, 2026 (America/Chicago). Work follows the website audit at `6c17b25`; the previous five local beta fixes remain included. The exact already-deployed backend salt correction from `f8daf63b6b7e352a3b91a5093ee3416aa685a3a7` was carried forward before making backend changes.

## User-visible behavior

- Smart refinement remains the normal path. The model organizes names/categories; deterministic aggregation owns every quantity. Exact source references prevent similar ingredient qualifiers from being confused. Specialty salts, oils, sauces and cuts remain distinct.
- Temporary admission, service, network or malformed-response failures provide a labeled checklist using freshly fetched recipe quantities. The checklist supports checkmarks, copying and existing Weee/Muse flows. A 45-second client deadline limits waiting for refinement; retries are explicit.
- Degraded provider responses expose additive `refinement_status: "fallback"` metadata so the UI can honestly offer retry. Older servers without this metadata remain compatible. Quota and monetary controls remain intact.
- Retry/reorder preserves checkmarks and hidden rows for exact name/quantity matches. Changed quantities must be checked again. An unchanged ingredient set preserves Weee choices/cart confirmations. The Muse dialog shows fallback feedback and permits current-quantity review while still requiring refresh for stale plans.
- Optional meal-preview failure no longer blocks refinement. Authentication/validation failures remain errors. Account, week and request-generation guards reject delayed results.

## Verification

- Full web suite: **791 passed**, including final dialog recovery behavior.
- Shared package: **388 passed**. Final production build/type checks passed.
- Full backend suite: **1,424 passed, 6 expected platform skips**; final focused refinement/admission/provider suite: **160 passed** after the final prompt clarification.
- Release/operations scripts: **52 passed**, including nine new recovery request-generation checks. System Python lacked a test dependency; the complete run passed using the existing backend test environment.
- Repository hygiene: zero findings; whitespace/diff checks passed.
- Two actual provider requests through the central admission/accounting path: Chinese **4.697 s**, English **5.322 s**. Each started with 16 raw rows, normalized to 14 ingredients, and returned all 14 with quantities unchanged and appropriate categories. Specialty distinctions survived. Model `gpt-4o-mini-2024-07-18`; no retries; accounted total **$0.00078525** under a **$0.01** combined cap; zero remaining reservations/leases. See [sanitized receipt](2026-09-28-refinement-provider-check.json). These used a disposable local account/database and the real provider, not production account data. The quality database was deleted and disposable PostgreSQL stopped.

- Shopping and Muse browser suite: **45 passed** across desktop, tablet and phone against the production build. Simulated 429/503/provider fallback, retry/reload persistence, changed quantities, clipboard/export and retailer selection behavior were checked. API/retailer traffic was intercepted in these browser tests; the separate provider checks above exercised real AI.
- Narrow-screen screenshot review exposed a date/control overlap at 320 px; screens up to 400 px now put the week controls on their own row. The final rebuilt shopping/Muse suite passed all 45 cases. Independent 320 px and 390 px screenshots/bounds checks confirmed the complete date sits above the controls, with no horizontal overflow, JavaScript errors or unexpected API requests.

## Production and release status

The application changes are deployed from `b6e596d2248168d09d4ba802c4bb26afee696699`: API `cooking-backend:31` and Vercel `dpl_Ciwo5jxo2MAPdGX7ujnuyXBo5NSe` on both public domains. See [release verification](2026-09-28-beta-release.md) for immutable identities, fresh-image checks, public verification and rollback references. No production account, planner, recipe or mail writes were made during refinement checks.

The approved infrastructure work is already live: RDS backup retention 7 days and deletion protection enabled; six CloudWatch alarms created and independently verified OK. Notification actions remain **disabled** because no operator email has been designated/confirmed. Account email delivery is user-verified, which is separate from SNS operator alert delivery.

See [recovery and alerts runbook](../recovery-alerts.md) for current identities, conditions, reproduction, delivery drill and restore procedure. Seven-day history accrues prospectively. A cloud restore rehearsal remains unexecuted, and unversioned recipe-image storage remains a recovery gap. Recovery setup did not change scaling, object retention or network access, delete history, or perform a database cutover.
