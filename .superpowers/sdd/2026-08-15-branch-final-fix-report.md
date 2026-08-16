# Branch final correction report

Date: 2026-08-16

Starting commit: `d0bb8a0eb68709baafb45d78704cb665f8753fc3`

Scope: the four requested cross-plan release corrections only. No push, merge, deploy, migration, infrastructure, or external-state action was performed.

## Corrections

1. `/store-products` now distinguishes an omitted `store` query from an explicit legacy `store=weee`. Omitted-store clients receive `{products, expires_at}` with expiry derived from the service result's authoritative cache timestamp; explicit legacy Weee clients receive the same validated/fresh products as `StoreProduct[]`. Explicit Amazon, unknown, and empty stores return HTTP 400 before service work. FastAPI's return annotation and response model expose both shapes in OpenAPI.
2. Web product hydration revalidates the stable union of every stored positive key and every `open=true` key. Persisted open panels whose lookup is missing, queued, loading, invalid, legacy, empty, or failed are cleared from retained terminal display state and immediately requeued, preventing a reload from leaving a blank idle panel.
3. Mobile generation invalidation now clears bulk active/progress state immediately on week changes and when smart mode supplies a null cache key. Existing generation guards still suppress late worker state, and re-entry exposes an inactive bulk state so the load button is enabled.
4. Web smart-list and product-state `sessionStorage.setItem` calls are best effort. Quota, security, and other storage-write exceptions no longer escape React effects or interrupt product interaction.

The authoritative exact expiry boundary, URL validation, v7 isolation, Weee-only active path, client/backend/warmer concurrency ceilings, grocery layout, planner behavior, localization, and accessibility behavior remain unchanged.

## TDD evidence

- Backend RED: four focused failures showed explicit legacy Weee still returned the metadata object and empty legacy lookup returned the object shape. GREEN: the complete route suite passed `14/14`, including real HTTP serialization, OpenAPI union schema, positive/empty expiry behavior, and pre-service Amazon/unknown rejection.
- Web hydration RED: the pure hydration and page reload regressions failed because only stored positives were revalidated; open+missing remained a visible empty panel with idle state. GREEN: the combined coordinator/page set passed `16/16`.
- Web storage RED: the throwing-storage page regression raised an unhandled `QuotaExceededError`, unmounted the page, and could not render the fresh product. GREEN: the focused regression and combined web lookup set passed.
- Mobile RED: separate unresolved-request tests showed both week switching and leaving smart mode retained `{active:true, done:0, total:1}`. GREEN: both invalidation regressions passed, then the complete hook suite passed `7/7`; late resolution did not publish products or reactivate progress.

## Release verification

- Backend: `backend/.venv/bin/python -W error -m pytest -q` passed `56` tests. The repository's specific Pydantic dependency deprecation remains explicitly allowlisted in `pytest.ini`; other warnings are errors.
- Web: `npm run test:web` passed `14` files and `76` tests. The only emitted warning was the pre-existing Node/Vitest empty `--localstorage-file` runner warning.
- Mobile: `npm run test:mobile` passed `11` suites and `27` tests.
- TypeScript: web and mobile `tsc --noEmit` checks both exited 0.
- Design tokens: test and build passed; the generated-artifact diff was empty.
- Production build: `npm run web:build` passed compilation, lint/type checking, and all 14 pages. The restricted environment skipped only the unavailable Google Material Symbols stylesheet optimization.
- Browser acceptance: `PORT=3100 npm --workspace @cooking/web run test:e2e -- planner.spec.ts shell.spec.ts` passed `10` cases with `5` intentional project-mismatch skips after local-server bind permission was granted. No snapshot changed.
- Backend `compileall`, active Amazon-product scan, v7/concurrency scan, intentional S3 `amazonaws.com` check, `git diff --check`, and generated-artifact diff all passed.

## Rollout documentation

The QA checklist now states the two response shapes and their smoke evidence separately. Its backend-first claim is deliberately narrow: legacy explicit Weee clients are compatible; Amazon or unknown-store clients are not and must receive HTTP 400. `CLAUDE.md` describes the same API and the web reload/storage behavior.

The final commit SHA and clean worktree status are recorded by the coordinating handoff from fresh post-commit `git rev-parse HEAD` and `git status --short --branch` output.

## Final Fix Round 2 — best-effort web removal

Starting commit: `574ea4431a89fbdfc1986b7167aee40e029d7541`

The two web shopping `sessionStorage.removeItem` paths now share a best-effort removal helper, matching the existing write behavior without changing either storage key. Back to original clears React smart-list/product state even when both removals raise `SecurityError`. Successful smart-list preparation also continues through product-cache reset and is not misreported as a refine failure.

TDD RED reproduced both defects: Back to original emitted an unhandled `SecurityError` and left Smart mode mounted; successful preparation surfaced `Something went wrong` when its product-cache removal failed. Focused GREEN passed both new regressions and the complete page lookup suite (`7/7`).

Proportional verification passed: full web `14` files / `78` tests, web `tsc --noEmit`, and `git diff --check`. Vitest emitted only the existing empty `--localstorage-file` warning. This helper-only change affects no markup, styles, browser layout, or snapshots, so browser/baseline reruns were not warranted.
