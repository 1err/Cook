# Simple AI menu generation — 2026-09-27

## User-facing change

The current request replaces the configurable menu studio with a compact recipe list and two optional fields: title and description. AI generates the entire illustrated menu PNG, including its text. This explicitly supersedes the earlier editable-text decision. There are no style/layout tabs, proposal acceptance step, decorative-image placement controls, or template-rendered dish labels in the new entrypoint.

Select all loads the complete owned library, including later browsing pages. Up to 24 dishes fit one generated page; selecting more displays the limit and disables Generate without truncating the selection or reserving an allowance. Web downloads the generated PNG and native source shares it. Existing recipe content is unchanged. The user can express style and composition freely in the description.

## Server contract

`POST /menus/artwork` accepts a strict `full-menu-v1` body with one request UUID, optional title/brief and unique owned recipe ID/name snapshots. The same transaction admits the menu creation and image cost/attempt/lease reservations. Ordinary users receive one new menu per UTC day; administrators are exempt from the menu creation limit but retain other image/budget/storage controls. New requests validate current recipe ownership and names; admitted immutable requests replay before those mutable checks. Recovery never creates another UUID automatically. Legacy decorative-artwork and design routes remain compatible.

The full-image prompt includes only the supplied recipe names, optional title and aesthetic description. It requests every dish exactly once, readable names in their original language, no invented dishes/prices, and a freely chosen composition. Recipe photos are not uploaded to the provider. The result is generated pixels and may contain model errors; the UI asks users to review dish names before sharing.

Full-menu deadlines: provider 180s, route 225s, job/lease 255s, client status 240s, complete client operation 270s. Existing recipe-cover and legacy artwork timeouts, hashes, pricing, provider/model and quality remain unchanged. No migration or production configuration change is required.

## Verification and evidence

- Backend pinned-environment full suite: 1,405 passed, six Linux-only skips. Subsequent focused full-menu boundary suite: 33 passed. Disposable PostgreSQL tests include distinct-request and same-request races, ownership, rollback, quotas, accounting and immutable replay.
- Shared model suite: 358 passed; API client suite: 66 passed. Recovery tests include nested immutable snapshots and the bounded full-menu polling deadline.
- Web suite: 751 tests across 88 files passed, plus TypeScript. Native suite: 407 tests across 55 suites passed, plus TypeScript. Availability refreshes at UTC reset and on returning to the app; recovery preserves the original request day. A stale library can be refreshed without losing the title and description.
- All 14 desktop/phone browser cases passed; screenshots were visually inspected and PNG downloads were byte-identical to the fixture image. Local browser tests use intercepted account/API fixtures. They verify request bodies, whole-library selection, no separate creation POST, one-image download, cancellation/recovery, account reset, daily rejection, admin repetition and compact desktop/phone rendering. Fixture screens are not production account or paid-provider evidence.

A separate real generation test used the actual menu API router, local disposable users/recipes/PostgreSQL and local owned-image storage, with the existing app OpenAI provider credentials. Exactly one paid request generated a 1,024×1,536 nine-dish Chinese menu in 21.3 seconds. Its title and all nine supplied labels were visually checked. Replaying the request returned the same output without another provider charge; a different second request was denied by the daily limit. One cost-ledger record and one creation remained, with zero active leases. The app-recorded provider estimate was $0.006735. No production users, database or object storage were touched.

Real-generation evidence: `/private/tmp/menu-simple-real-proof-20260927/nine-dish-menu.png` and `receipt.json`. The provider call is protected by a one-shot marker and is not part of repeatable fixture tests. Backend test log: `/private/tmp/menu-simple-pg-20260927/fixture-tests.log`. Shared/client log: `/private/tmp/menu-simple-shared.log`.

## Release status

Released to both `chef-world.com` and `www.chef-world.com`. Backend and frontend share application source `6a3d88fc18d920b3107939b19926c63df3e0fc61` on `codex/menu-simple-20260927`.

- API: `cooking-backend:29`, image `sha256:2cb85360cb724e13ec69bb3b658ae4ba4d9780390e59c5dd023af36765cd8211`. Worker remains `cooking-store-worker:2`.
- Frontend: `dpl_ERWE8GmFYpZXVhLYerZVmTBYCQhZ`, READY at `https://cook-beithbfxt-jerrys-projects-08f739a2.vercel.app` and both public aliases.
- Fresh backend and web Docker builds used `--no-cache --pull` for Linux/amd64. Actual image runtime checks passed, including matching committed file hashes, non-root startup, disposable PostgreSQL migrations, full-menu ownership/concurrency/quota/accounting/replay/PNG, preserved legacy menu and shopping/import behavior, and all six Linux containment regressions.
- Locked production migration succeeded before rollout. Exact API revision/digest, healthy completed service, readiness, authorization and CORS passed. Original configuration fingerprints have zero differences, including all eight Gemini settings.
- Candidate verification passed all **14 menu + 10 preserved UI cases** across desktop and phone Chromium. The first direct-public run hit host network suspension/disconnection; 12 menu and four UI cases passed before the interruption. Only the two affected menu and six UI cases were rerun serially after connectivity returned, and all passed without application changes. The combined 24-case public result retains the initial and rerun receipt provenance. Test API/account responses were fixtures and did not make paid provider or production account mutations. PNG downloads matched the supplied proof image byte-for-byte. Representative screens were visually inspected.
- Public route/asset verification matched the candidate: **10 routes, 44 assets and 6 fonts**, including unknown-font rejection. Vercel bounded error/fatal/HTTP5xx scans found zero records through `2026-09-28T01:17:14.573187Z`. API/worker bounded scans found zero warnings, errors, tracebacks or HTTP5xx through `2026-09-28T01:17:24.374000+00:00`. These are bounded observations, not ongoing monitoring.
- Vercel upload discovery exactly matched all 264 allowlisted source files (24,874,386 bytes); tests, private environment files and local build outputs were not uploaded.

Release evidence: `/private/tmp/chef-menu-simple-20260927`, with backend `production-api-verification.json`, web `production-web-verification.json`/`live-verification.json`, candidate/public browser receipts and reviewed screenshots. Persistent real-generation example: `/Users/xiang1err_/.codex/visualizations/2026/09/26/01a0dbc6-5b16-75c1-93d2-b595ca73c0e5/generated-menu-proof.png`.

Rollback pair: API `cooking-backend:28` at `sha256:0c10673e9a9e7e36e22a834b84707232c1ec61908e0564e9fecf99a20e5bac80` and frontend `dpl_Dv3G4yHEtL8BgsMZNgPiVv54egG8`. The old frontend remains compatible with API29; full-menu generation requires the new backend. No native binary or OTA update was published. Native source parity is verified only by the native suite and TypeScript.
