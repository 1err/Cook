# Chef World Dashboard Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reset non-admin accounts as authorized and build an administrator dashboard for accounts, acquisition, engagement, and retention.

**Architecture:** Existing Next.js UI and FastAPI/PostgreSQL, with a bounded first-party event collector, server-confirmed product events, and administrator-only reporting. Production account deletion is an independent, backed-up transaction; dashboard delivery is a tested local preview before rollout.

**Tech Stack:** Next.js 15, React 19, CSS modules, FastAPI, async SQLAlchemy, PostgreSQL, Alembic, Vitest, pytest, Playwright.

**Spec:** `docs/design/2026-09-24-admin-analytics-proposal.md`

## Global Constraints

- Preserve existing Library, Planner, Shopping, Cook, and Store cache behavior.
- Preserve the administrator UUID, password, and data. Keep registration open.
- No invented historical activity, no real user emails in Figma or committed fixtures.
- Reuse Source Serif 4, Inter, and existing Chef World tokens.
- Default reporting range 30 days; 7/90/custom ranges; UTC reporting explicitly labeled.
- Raw events 90 days; non-identifying daily aggregates 13 months.
- Exclude administrator/test activity from traction by default; include all accounts in the directory.
- Instrumentation failures must not block core app operations.

## Review Focus

- A deleted email can register with a fresh UUID; its old token cannot regain access.
- Authentication status changes must not attribute later activity to the prior browser user.
- Anonymous input cannot forge server-confirmed conversions or another account's identity.
- Empty, partially tracked, and immature cohort periods must not imply observed zeroes.
- Range boundaries, CSV formulas, and oversized inputs remain safe and readable.

### Task 1: Authorized account reset

Files: temporary operator scripts under `/private/tmp`; sanitized result in `docs/qa/`.

- [x] Verify an encrypted RDS snapshot reaches available.
- [x] Run `BEGIN; LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;` and verify the expected admin UUID/email and credentials.
- [x] Delete non-admin account-scoped counters and users; rely only on inspected CASCADE constraints.
- [x] Assert one user remains and admin-owned data/identity are unchanged before commit.
- [x] Verify deleted emails are free for registration and old IDs no longer resolve. Keep recovery snapshot private.

### Task 2: Analytics storage and collection

Files: `backend/app/analytics/{schema,repository,middleware}.py`, `backend/app/api/analytics.py`, Alembic migration, `backend/tests/test_analytics.py`.

Interfaces: `record_event(session, event)` persists a validated event idempotently; `safe_record(event)` owns a bounded independent transaction. Client endpoint accepts page views and retailer handoffs only; server middleware owns confirmed auth/product events.

- [x] Write tests for strict schemas, safe path/referrer normalization, event provenance, duplicates, account deletion, and failure isolation; run pytest to observe failure.
- [x] Add indexed events, per-user analytics profile, tracking start metadata, daily aggregates, and bounded retention maintenance.
- [x] Capture successful auth, recipe, plan, cooking, and retailer-link operations after committed responses; derive account IDs from server auth.
- [x] Run tests against disposable PostgreSQL and existing auth/product regressions.

### Task 3: Administrator reporting

Files: `backend/app/analytics/reports.py`, `backend/app/api/admin_analytics.py`, `backend/tests/test_analytics_reports.py`.

Interfaces: `/admin/analytics/overview`, `/users`, `/users/{id}`, `/users.csv`, and `/users/{id}/test-status`. Every endpoint uses `require_admin` and bounded date/pagination parameters.

- [x] Write failing integration tests for metrics, exclusion, date boundaries, prior-period comparison, attribution, activation, cohorts, user timeline, and CSV escaping.
- [x] Implement SQL aggregation rather than loading unbounded raw events. Keep current inventory distinct from historical events.
- [x] Verify anonymous/non-admin rejection and confirm directory pagination includes internal accounts with explicit labels.

### Task 4: Visual dashboard and browser tracker

Files: `apps/web/app/admin/dashboard/*`, `apps/web/app/lib/analytics.ts`, `apps/web/app/components/AnalyticsTracker.tsx`, layout, account menu, privacy copy, frontend tests.

Interfaces: dashboard fetches reporting endpoints; tracker attaches bounded first-party visitor/session context to web requests and posts allowlisted client events. Backend resolves user identity.

- [x] Build a complete concept using the existing visual system; Figma file creation is complete but canvas work is blocked by its Starter tool limit.
- [x] Write failing tests for admin gating, range/tab controls, real empty/error states, CSV export, test-account setting, privacy opt-out, and session expiry.
- [x] Implement Overview, Users, Acquisition, and Engagement with responsive charts/tables and accessible controls. Replace Design system navigation with Dashboard.
- [x] Add navigation and retailer-click tracking without exposing query strings, account IDs in paths, tokens, or recipe contents.
- [x] Update privacy disclosure and documentation.

### Task 5: Verification and review

Files: browser tests and sanitized verification notes.

- [x] Run backend and frontend suites, typecheck, production build, and migrated PostgreSQL integration tests.
- [x] Use the in-app browser to verify the integrated local dashboard; exercise populated fixtures only in tests and a real empty post-reset state in the local preview.
- [x] Compare the visual concept and rendered desktop/phone screenshots and correct material discrepancies.
- [x] Get an independent whole-change review per executing-plans, fix important findings, rerun affected checks, and commit only this worktree.
- [x] Deliver the working preview and distinguish deployed account reset from dashboard deployment status.

## Execution notes

The user approved the written scope and explicitly instructed implementation in this turn. No additional design or execution-method permission is needed. Implementation proceeds inline; final review uses an independent reviewer.

## Verification and review ledger

- Production reset: encrypted recovery snapshot available before transactional deletion; 18 non-admin rows removed, administrator identity and content preserved, one account verified afterward. Registration remains open.
- PostgreSQL integration: retention pruning, persisted milestones, old-period coverage, attribution, copy idempotency, account deletion/re-registration, search/pagination, and internal exclusion verified.
- Final independent review found three reporting defects. Each was reproduced by a failing test and fixed: shared-browser account changes, no-op recipe copies, and unavailable user login history. Full backend suite after fixes: 626 passed.
- Review also identified incomplete landing-page, completion-stage, and retailer last-active behavior; implemented to fulfill the approved reporting scope.
- Ruling: retain daily aggregate totals for future historical reports, but use indexed raw-event SQL for the current bounded 90-day dashboard. This preserves exact distinct-account/date-filter semantics at current scale. Cost if wrong: growing traffic may require rollup-backed chart queries and query-plan tuning before the existing five-second timeout is reached.
- Ruling: Figma's Starter tool rate limit prevented canvas work after an empty file was created. A generated visual concept and implemented browser preview provide the review artifact instead. Cost if wrong: there is no editable Figma handoff yet.
- Deferred minor: aggregate-backed long-range charts remain future work; historical raw user activity cannot be reconstructed.
- Ruling: production reset was authorized separately; dashboard delivery remains a local review preview under the approved spec. No production analytics migration or dashboard deployment has run.
