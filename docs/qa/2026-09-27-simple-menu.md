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

Pending the final clean source commit, fresh immutable backend/frontend build and runtime checks, authenticated candidate browser checks and approved production rollout. Release harness: `/private/tmp/chef-menu-simple-20260927`. This document does not yet claim this revision is live. No native binary or OTA update is included.
