# Instacart Shopping Implementation Plan

**Goal:** Add a setup-ready Instacart shopping alternative on web and mobile while preserving Weee.

**Architecture:** Shared item selection and safe-link helpers; authenticated backend adapter to the official shopping-list API; independent web/mobile panels with explicit external navigation.

**Tech Stack:** FastAPI/httpx, TypeScript, Next.js, React Native.

**Spec:** `docs/superpowers/specs/2026-09-14-instacart-shopping-design.md`

## Global constraints

- Preserve existing changes and Weee behavior. Do not commit unrelated work or deploy.
- No client-side provider keys, fabricated links, cart writes, or checkout.
- Missing key is a supported state; user chose setup-ready delivery.
- Only export current remaining items. Opening a link must not modify shopping or cart state.

## Tasks

- [x] Backend + shared contract: write failing tests; implement validated authenticated endpoint, server-only settings, item selection and safe-link helpers, typed API client; run focused tests.
- [x] Web: add independent localized Instacart panel and screen wiring, with race-safe create/open states; run panel and existing shopping tests.
- [x] Mobile: add independent localized panel and screen wiring using existing theme, with race-safe create/open states; run panel and existing shopping tests.
- [x] Integration: update setup docs, .env example, Docker env forwarding and CLAUDE.md; typecheck, build, browser-check and review all changes against the saved baseline.

## Execution notes

Existing checkout contains extensive user work. Source baseline saved at `/tmp/cooking-instacart-baseline-20260914` for scoped diffs; edits remain in this checkout to preserve the exact existing implementation.

## Verification outcome

Backend Instacart/store-route tests: 57 passed. Existing Weee browser regression suite: 64 passed. Shared tests: 32 passed. API-client tests: 6 passed. Web shopping tests: 146 passed; copy-fix coverage: 30 passed. Mobile shopping coverage: 77 passed; copy-fix coverage: 43 passed. Web/mobile/API-client type checks and production web build passed. Build skipped optimization of an unreachable external Material Symbols stylesheet; compilation and all generated pages succeeded.

Desktop (1440x1000) and phone (390x844) browser checks passed for original/smart exports, checked/hidden exclusion, preserved Weee selections, missing-key errors, enabled retry, no horizontal overflow and no unexpected runtime errors. Provider success/error responses were explicitly simulated. Screenshots and temporary harness: `/tmp/cooking-instacart-qa/`. Actual Instacart link generation and native-device testing remain pending; no key configured and no deployment performed.

Final review: approved after correcting the outbound CTA to provider-approved wording and retaining readable brand text for hovered/visited/focused links. Existing Weee scraper, store service/routes and cart components were verified byte-identical to the initial source snapshot.
