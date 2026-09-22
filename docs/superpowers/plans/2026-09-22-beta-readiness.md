# Beta readiness implementation plan

> **For agentic workers:** Use test-first implementation and independent review. The user already authorized execution; continue through independent tasks without another approval round.

**Goal:** Deliver functioning beta account/product flows and an enforced USD 30 monthly app AI cap, preserving existing product structure.

**Architecture:** Existing FastAPI/PostgreSQL backend and shared web/native clients; extend current scalability controls and editors. Transactional lifecycle changes and conservative spend admission are server-owned. Keep external services configurable and test with isolated doubles.

**Tech Stack:** Python/FastAPI/SQLAlchemy/Alembic, Next.js/React, Expo/React Native, PostgreSQL, AWS SES/S3.

**Spec:** `docs/superpowers/specs/2026-09-22-beta-readiness-design.md`.

## Global constraints

- All implementation occurs in `.worktrees/beta-readiness-20260922` based on `b3e7ef8`.
- No redesign, root checkout edits, production user mutations, paid provider tests, or live deployment.
- Preserve both platforms, per-account storage isolation, current controls and source provenance.
- Root owns shared account client contracts, auth/settings UI, documentation and integrations. Account worker owns backend lifecycle, models/migration/storage cleanup. Product worker owns manual/import/library/shopping UI and product tests. Budget worker owns AI accounting/configuration/tests and retailer admission bounds. Coordinate shared config/model edits explicitly.

## Review focus

1. Simultaneous reset/deletion/calls must not revive a revoked account or release already-spent global AI cost.
2. A copied/shared image reference must not cause deletion of another account's asset; malformed external URLs are never cleanup targets.
3. Missing email configuration and unknown account addresses must behave consistently; tokens never enter logs or HTTP query strings.
4. An AI outage or exhausted allowance must leave manual recipe and ordinary grocery use working.
5. Retry/account-switch races must not replace newer data or leak another account's cached state.

## Task 1: Backend accounts and cleanup

- [x] Add failing route/repository tests for reset expiry/replay, generic responses, session revocation, wrong-password deletion and surviving global spend.
- [x] Implement the exact account API contract in the spec using focused account/email/cleanup modules, user verification/session metadata, and additive migration(s).
- [x] Wire a configurable SES sender with first-party fragment links; fail safely when missing. Add a durable retryable image cleanup mechanism with strict ownership/reference checks.
- [x] Verify unit and isolated PostgreSQL lifecycle/concurrency tests, including token consumption races.

Files: `backend/app/api/auth.py`, new account routes/services/repositories, `backend/app/db/models.py`, `backend/alembic/versions/20260922_account_lifecycle.py`, `backend/tests/test_account_lifecycle*.py`.

## Task 2: Product reliability

- [x] Add failing web/native tests proving manual creation saves without a parse/AI call, private library survives catalog errors, and raw ingredients can be checked/copied without refine.
- [x] Add a manual source entry using existing editors; independently load/retry library sources; render a deterministic basic grocery checklist.
- [x] Preserve shopping selection semantics, existing smart list flows and stale-state recovery. Add visible useful retry without clearing successful content.
- [x] Run focused tests and report any navigation/shared-catalog additions for root integration.

Files: web import/library/shopping features; mobile corresponding features; focused tests. Avoid auth/profile/navigation type edits owned by root; request minimal interfaces if required.

## Task 3: Affordability and bounded work

- [x] Add failing configuration/concurrency tests proving the app cannot admit spend above USD 30/month and unknown costs stay charged/reserved.
- [x] Configure verified GPT-4o mini rates and explicit beta allocation; separate the hard AI cap from stale overall hosting assumptions. Maintain per-account fairness and report current/remaining spend.
- [x] Bound retailer batch count/query size and concurrent waiters; retain existing queue deduplication and containment guarantees. No live retailer calls.
- [x] Run cost/accounting and admission tests with isolated PostgreSQL where appropriate.

Files: `backend/app/core/{config,ai_cost,ai_context}.py`, AI repositories/tests, store routes/jobs/tests, scoped deployment environment example. Coordinate config additions with account worker.

## Task 4: Account UX and wiring

- [x] Add failing tests for recovery request/confirmation, invalid/expired token states, password-confirmed deletion and provider unavailability.
- [x] Implement web recovery/verification pages, account settings actions and native recovery/settings using the spec API. Add shared safe error translation, bilingual labels and support entry.
- [x] Clear account-bound local storage and native tokens only after server outcome; communicate if global revocation cannot complete offline.
- [x] Update exact auth-path exemptions and reset-page security headers. Verify protected pages remain protected.

Files: web auth/settings/pages, mobile auth/profile/navigation, shared messages/account API helper, tests.

## Task 5: Cost investigation, documentation and verification

- [x] Read recent AWS daily/service billing and resource inventory; identify attributable savings without deleting active resources or increasing spend.
- [x] Determine email sender provisioning readiness. Prepare concrete deployment settings/runbook; clearly mark external activation gates.
- [x] Update `CLAUDE.md`, data inventory, environment example and beta implementation report with final behavior and verified limits.
- [x] Run backend suite, isolated PostgreSQL integrations, web/native/shared suites, type checks, production build and browser checks appropriate to changes.
- [x] Independently review changed code; resolve findings and repeat only affected tests. Save release source and evidence for user-managed UI integration.

## Progress and rulings

- Setup: isolated worktree created from `b3e7ef8`; no root application edits.
- Ruling: the user's new acceptance of existing hosting supersedes the earlier total-budget planning assumption; USD 30/month AI is the explicit hard constraint. No new hosting spending is implied.
- Ruling: functional UI is required to finish requested flows; global style/layout integration remains in the user's other workstream.
- Ruling: preparation and verification proceed under the user's explicit approval. Production rollout remains a separate concrete release decision once code and provider setup are reviewable.

- Completion: all implementation and local verification tasks are finished; deployment, native-device review, real SES delivery and provider activation remain release gates in the handoff.
