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

## Final Fix Round 2

Starting commit: `ac233c76930860ef3e9b6c6f1733a1a7c43baf3c`

### Corrections

1. The public product route now returns `{products, expires_at}`. Positive-result expiry is calculated from the service result's actual cache-entry timestamp, so memory hits, PostgreSQL hits, fresh writes, and single-flight followers all expose the same authoritative cache lifetime. Empty live results explicitly return `expires_at: null`; admin and warmer callers keep the list-returning service wrapper.
2. `StoreProductsResponse` is shared through `@cooking/api-client`. Web and mobile reject positive responses whose expiry is missing, malformed, or at/past the absolute boundary, and they continue to reject unsafe Weee URLs.
3. Web success state and `sessionStorage` carry the authoritative expiry. Every displayed result gets an exact-boundary timer; at expiry it is replaced by queued/loading state before a backend revalidation. Timers are keyed by expiry and generation, removed with their state, and cleared on reset/unmount.
4. Mobile persisted positives carry the same authoritative expiry and are valid only while `expires_at > now`. Displayed positives are removed and force-revalidated at the exact boundary. Timer callbacks and fetch publication are generation-guarded, single-flight per key, and cleaned up on key removal, week change, and unmount.
5. Mobile hydration queues the union of stored positive keys and all `open=true` keys. Thus an open panel with missing, empty, expired, malformed, or legacy product state always retries instead of remaining a permanent spinner.
6. Scoped `CLAUDE.md` product/API/storage statements now describe the implemented Weee-only behavior rather than Weee/Amazon.

The Round 1 URL validation, `v7` cache isolation, exact 24-hour backend staleness, shared write timestamp, queued/loading accessibility treatment, grocery layout/order, maximum concurrency ceilings, cancellation, and positive-only backend persistence remain intact.

### TDD evidence

- Backend RED: new service/route tests failed because no metadata-returning service or response contract existed. Focused GREEN: `49 passed`, including controlled memory, age-86,399 PostgreSQL, delayed live-commit, and explicit empty-response cases.
- Web RED: object responses were treated as invalid arrays, persisted success lacked expiry, and no boundary timer existed. Focused GREEN: `20 passed`, including missing/invalid/exact-expiry parsing and a fake-clock one-second boundary revalidation with no stale display.
- Mobile RED: the hook did not understand response metadata, an open key without products was not queued, and no expiry timer existed. Focused GREEN: `6 passed`, including persisted exact-boundary rejection, open-without-positive hydration, exact timer behavior, and unmount cleanup.

### Round 2 release verification

- Full web: `14` files, `66` tests passed. The pre-existing Vitest/Node empty `--localstorage-file` runner warning remains the only warning.
- Full mobile: `11` suites, `25` tests passed.
- Full backend with warnings escalated and only dependency deprecations allowlisted: `52 passed`.
- Web and mobile TypeScript (`tsc --noEmit`): passed.
- Web production build: passed; the restricted environment again skipped Google Fonts stylesheet optimization after the download failed.
- Design-token test/build: passed with no generated drift.
- Backend `compileall`, Weee/Amazon scope scan, concurrency/version scan, intentional S3 `amazonaws.com` check, and `git diff --check`: passed.

No push, merge, deploy, migration, infrastructure, or external-state action was performed.
