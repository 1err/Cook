# Weee product loading/cache final correction report

Date: 2026-08-16

Starting commit: `1a23f60c9700d6daed86e06b2c96566d6f8f77cc`

Scope: release findings only; no push, merge, deploy, migration, infrastructure, or external-state changes.

## Corrections

1. Web and mobile now treat every hydrated positive as untrusted. Stored products are removed from display state, marked queued/loading, and re-requested from the backend before any success UI can render. Fresh backend memory/PostgreSQL hits remain the fast path. Both clients also reject unsafe Weee product links before navigation.
2. A validated live scrape captures one `cached_at` instant before persistence. The independent writer stores that exact value as PostgreSQL `updated_at`, commits, and only then seeds memory with the same timestamp. A delayed-commit regression proves both tiers are fresh at age 86,399 and stale at age 86,400.
3. Product URLs must use HTTPS, have no credentials or non-default port, and use `sayweee.com` or a hostname ending in `.sayweee.com`. Validation runs before PDP navigation and on live, memory-cache, PostgreSQL-cache, admin-preview, web, and mobile output. `CACHE_VERSION` is now `v7`, so v6 rows are inert.
4. Web queued/loading product rows use the existing spinner and expose `role="status"` with `aria-live="polite"`.
5. Repository stale filters use inclusive SQL (`updated_at <= cutoff`), while admin and preview classify age `>= 86400` seconds as stale.

The Weee-only contract, grocery layout/order, web/backend ceiling of four, warmer ceiling of two, single-flight/cancellation, and positive-only backend persistence are unchanged.

## TDD evidence

- Baseline: web focused `15 passed`; mobile focused `4 passed`; backend focused `30 passed`.
- RED: web hydration/navigation/status/preview suite failed `18` tests; mobile hydration/navigation failed `5`; backend timestamp/version/URL/boundary suite failed `14`.
- Focused GREEN: web `32 passed`; mobile `9 passed`; backend full `48 passed`.

## Release verification

- `npm run test:web` with unhandled rejections and unexpected Node warnings escalated: `14` files, `63` tests passed. The known Vitest/Node empty `--localstorage-file` runner warning was explicitly allowlisted.
- `npm run test:mobile` under the same warning gate: `10` suites, `20` tests passed.
- `backend/.venv/bin/python -m pytest -q -W error ...`: `48 passed`; only the pre-existing Pydantic `Field(env=...)` deprecation was explicitly allowlisted.
- `npx tsc -p apps/web/tsconfig.json --noEmit`: passed.
- `npx tsc -p apps/mobile/tsconfig.json --noEmit`: passed.
- `npm run tokens:test`: passed (`1` test).
- `npm run tokens:build` plus generated-artifact diff: passed with no drift.
- `npm run web:build`: passed; Google Fonts optimization was skipped because the stylesheet could not be downloaded in the restricted environment.
- Backend `compileall`, Weee/Amazon scope scan, concurrency/version scan, intentional S3 `amazonaws.com` check, `git diff --check`, and scoped generated-artifact diff: passed.
- `npm run web:lint` was not a usable non-interactive gate because the repository has no ESLint configuration and `next lint` opened its first-run configuration prompt; `next build` completed its built-in lint/type phase.

The final commit SHA and clean worktree status are reported from `git rev-parse HEAD` and `git status --short --branch` after committing this report and all scoped changes.
