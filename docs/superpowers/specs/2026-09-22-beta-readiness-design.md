# Approved beta readiness implementation

The user approved the September 22 audit and explicitly requested affordability controls, manual recipe creation, password recovery, account deletion, retry states and related beta fixes. They will handle global UI integration separately. Implement functional changes in existing styling; no broad visual redesign or production deployment is part of this implementation stage.

## Outcomes and constraints

- Build on the existing `b3e7ef8` scalability implementation in an isolated branch.
- Keep existing Library, Planner, Shopping and Cook behavior and both web/native clients.
- Cap this app's AI model spending at USD 30 per UTC calendar month across accounts and replicas. Reserve conservative cost before calls, reconcile confirmed usage, retain reservation for unknown outcomes, reject work above remaining budget, and keep manual features usable. This does not cap unrelated API-key usage, taxes or hosting bills.
- The user accepts existing hosting temporarily and reports about USD 80/week AWS charges. Investigate the discrepancy with the earlier snapshot; do not increase infrastructure or enforce the former USD 150 total as a newly confirmed constraint. No live destructive cost optimization.
- Email recovery uses a real configurable provider, single-use hashed tokens, bounded expiry, generic request responses, admission limits, and no token/recipe/password logging. Prefer existing AWS SES; sender setup is pending user preference and verified access.
- Add email verification and revocable sessions with compatibility for existing tokens only until their account is revoked. A password reset invalidates earlier sessions. Ordinary logout must not leave its issued token usable. Account deletion requires current password confirmation and immediately revokes access.
- Delete account-owned relational data and counters safely; preserve the global AI spending ledger to prevent budget reset by deleting/recreating users. Queue safe, retryable cleanup for owned uploaded images; never delete arbitrary external URLs or another user's referenced objects. Shared copies and backup retention need accurate disclosure.
- Manual recipe entry bypasses AI and uses the existing recipe editor and save contract. Empty ingredient/step rows are editable but only valid recipes save.
- Basic shopping renders deterministic aggregated ingredients without AI admission. Check/copy remains available during AI failure. Preserve optional smart list and retailer choices.
- Library requests fail independently; give explicit retry controls and preserve successful content. Add useful support entry points without sending messages automatically.
- Preserve current provider features; capability reporting can hide genuinely unconfigured services, but do not alter retailer permissions or start live scraping during development.

## Account API contract

All new paths are under `/auth`. Errors use current FastAPI conventions without reflecting secrets.

| Method/path | Request | Response |
| --- | --- | --- |
| GET `/capabilities` | none | `{password_recovery: boolean, email_verification: boolean}` |
| POST `/password-reset/request` | `{email: string}` | generic `{ok: true}`; provider unavailable may return uniform 503 |
| POST `/password-reset/confirm` | `{token: string, password: string}` | `{ok: true}`; no automatic login |
| POST `/email-verification/request` | authenticated | generic `{ok: true}` |
| POST `/email-verification/confirm` | `{token: string}` | `{ok: true}` |
| POST `/logout-all` | authenticated | `{ok: true}` and cleared cookie |
| DELETE `/account` | authenticated `{password: string}` | `{ok: true}` after durable deletion/cleanup admission and cleared cookie |
| GET `/me` | authenticated | existing fields plus `email_verified: boolean` |

Recovery links use the configured first-party web origin and `/reset-password#token=...`; verification links use `/verify-email#token=...`. Fragments avoid routine HTTP URL/referrer logs. Do not derive links from the request Host. Both pages clear token fragments once captured, have no third-party assets, and do not perform mutations on GET.

Native users can request recovery in-app and complete the same web flow, then sign in again. Native Settings contains password-confirmed deletion, verification action, support and sign-out-everywhere. Web settings exposes the same actions.

## Verification

Use red/green behavioral tests for new behavior, isolated PostgreSQL for concurrency and lifecycle, fake external email/AI/storage adapters for test delivery, web/native suites and type checks, a production web build, and browser checks for manual creation, recovery/error states and account deletion. Do not send real user email, consume paid AI, or mutate production user records for tests.

Current source/external references: prior audit `docs/qa/2026-09-22-beta-launch-audit.md` in the parent checkout; OWASP Forgot Password Cheat Sheet; OpenAI GPT-4o mini official model page, checked September 22, 2026 (USD 0.15 input / USD 0.60 output per million tokens).
