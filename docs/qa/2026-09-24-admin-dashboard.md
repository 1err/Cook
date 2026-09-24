# Administrator dashboard verification — 2026-09-24

## Delivery state

Production account reset is complete. The user subsequently approved deployment; the dashboard and analytics migration are now live. See `2026-09-24-admin-dashboard-production.md` for release evidence. Existing application flows and Store cache remain. The account menu replaces Design system with Dashboard while retaining its source.

Local preview: http://localhost:3149/admin/dashboard, API localhost:8159, disposable PostgreSQL localhost:55439. The browser uses a synthetic administrator, `owner@example.com`. No production account data was copied into the preview, tests, screenshots, or Figma.

## Production reset

Before deletion an encrypted RDS recovery snapshot reached `available` (100%). A transaction locked the user table, verified the existing administrator UUID/email and identity, inspected account foreign keys, and removed all other users plus account-scoped AI counters. The transaction asserted invariants before commit and a fresh read verified the result.

- Before: 19 account rows, including one internal migration account.
- Deleted: 18 non-admin accounts, 55 recipes, 51 meal-plan rows, 4 account AI counters, and their dependent identities. No public catalog recipe was removed.
- After: exactly one original administrator account. Its credential/identity and UUID were unchanged; all 72 meal-plan rows and one active cooking session were preserved.
- Deleted IDs no longer resolve. Deleted email values are free for normal registration with new UUIDs. Registration remains enabled; no blacklist or invite restriction was introduced.
- Recovery snapshot retained. Object storage was not bulk-deleted; this operation removed accounts and their linked database content.

## Verification evidence

- Full backend suite: **626 passed**. Includes real disposable PostgreSQL migrations/integration, existing product/auth regressions, authorization, CSV formulas, privacy opt-out, transaction ordering, event deduplication, retention, directory coverage, copy idempotency, and shared-browser account changes.
- Full web unit suite: **375 passed**, 57 files.
- Shared packages: **42 passed** (32 shared, 10 API client).
- Web and mobile TypeScript checks: passed. Mobile dependencies were linked locally for type resolution; no mobile source changes.
- Next.js production build: passed; dashboard route 7.87 KB (114 KB first load).
- Integrated local HTTP smoke: real signup/login, anonymous 401, non-admin 403, successful client collection, sanitized dynamic/query-free paths, private no-store reports, test-account exclusion/inclusion, CSV export, and invalid range rejection. Synthetic smoke account removed afterward.
- In-app browser: final built app at desktop and 390×844 phone size; no horizontal page overflow, responsive metric/panel layout, all four tabs, live email search and empty results, account activity dialog, real empty post-reset-style state. Compared rendered screenshots to the visual concept.
- Independent review identified three material reporting defects. Regression tests failed before each fix and passed afterward; full backend suite was green after the fixes.

## Reporting limits and implementation decisions

Tracking starts when the migration/backend are deployed. Signup dates and current inventories are real database facts; older login/traffic/product histories cannot be reconstructed. Partial coverage is labeled; entirely untracked user login counts are null, including CSV exports. Administrator and explicitly marked test accounts are excluded from traction, but remain in the account directory. Visitor IDs identify browsers, not people; retailer handoffs do not confirm purchases.

Collection is best effort and never changes a successful business response. Failures may undercount activity; the dashboard exposes process-local collection-failure diagnostics. Raw events expire after 90 days, daily non-identifying totals after 13 months. Current exact-range reports use indexed raw events and a five-second SQL statement timeout. Aggregate-backed long-range chart queries are deferred; increased traffic may require query-plan/rollup tuning.

Figma created an empty file but its Starter tool limit blocked canvas editing. The reviewable artifacts are the generated concept and functioning web preview, not a completed Figma design. No paid service or third-party analytics dependency was added.
