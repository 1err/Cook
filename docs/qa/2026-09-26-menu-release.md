# Library menus and daily creation limit — release verification

Production deployment is authorized. This record describes the integrated candidate; production identifiers are recorded after rollout verification.

## Behavior and integration

My Library → Make a menu selects individual recipes or the entire owned library, including rows outside normal pagination and filters. Six styles, editable titles/dishes/descriptions/sections, explicit AI-artwork acceptance, and multiple PNG/PDF pages are preserved from the reviewed local feature. Original recipe data is never changed.

A non-admin account can start **one new menu session per UTC day**, counted when first continuing from selected recipes into the editor. Admin UUIDs in `ADMIN_USER_IDS` are exempt. The server atomically commits an owner-scoped request ID and daily counter. Concurrent different IDs admit only one request; retries of the same ID return the original creation before quota checks. Back, editing, and export within the admitted session do not count again. Clients bound admission at30 seconds and preserve the original ID after ambiguous failures even if access now shows no remaining allowance. A new session uses a new ID. Draft content stays local to the editing session; leaving it does not save a cloud draft.

Menu admission is separate from existing image budgets. Templates work without an image provider. Menu artwork preserves current image rate limits, admin image policy, monetary reservations, usage reconciliation, inflight leases, operation timeouts, upload accounting, owned-image receipts and deletion cleanup. Portrait requests have a separately conservative token reservation; square recipe-cover payload hashes remain compatible. No provider credentials enter rendered documents.

The release combines current API source46e49d8/documentation008370a with live Muse source6f6c875, then the menu-only feature diff from5a7d252 throughf1684a4. The dirty original checkout is preserved. This retains equipment removal, import language/recovery, shopping aggregation/copy, cautious Muse estimates, onboarding, image controls and admin cost reporting. No unrelated transitive dependency upgrades were retained. Native Jest explicitly resolves mobile React; production web/mobile React versions remain unchanged.

New authenticated endpoints are GET `/menus/access`, POST `/menus/creations`, and menu artwork access/generation/status/file under `/menus/artwork`. Migration order is `20260925_recipe_images` → `20260925_menu_artwork` → `20260926_menu_creation`.

## Local verification

- Shared342 tests and API-client56 tests pass; the planner conflict assertion received a test-only Vitest type compatibility correction.
- Web665 tests pass. Native385 tests pass, plus the final15-test screen suite verifying the initial-admission leave guard. Both application TypeScript checks pass.
- Backend broad run:1180 pass,120 skipped,16 Chromium cases blocked by the shell sandbox. All blocked browser cases passed in the subsequent authorized browser run;67 tests passed in that targeted run including PostgreSQL creation/cleanup checks. Focused cost/timeout/admission145 tests and final creation/artwork54 tests pass.
- PostgreSQL concurrency and purpose-isolation11 tests pass; creation races and owned-image deletion3 tests pass. Fresh migrations and downgrade/re-upgrade preserve seeded legacy cover digest, default purpose, and ledger ID; sole head is20260926_menu_creation.
- Independent backend and client review found and corrected admin fallback copy/state and the native initial-admission leave guard.
- Browser menu/library/recipe-cover checks:32 passed,4 existing viewport skips across phone/tablet/desktop. Menu coverage includes daily denial, distinct admin admissions, Back without another count, actual PNG and PDF export. Final iOS JavaScript export passed.
- Fresh-image, hosted-candidate and production checks are recorded in the release receipts below when completed. Fixture provider checks do not count as live paid provider requests.

## Release gates and rollback baseline

Scratch evidence and harness: `/private/tmp/chef-menu-release-20260926`. Source is archived from a clean committed release worktree; upload assets have per-file hashes. Fresh Linux/amd64 API and web images, isolated runtime checks, migration replay, authenticated quota/provider-fixture contracts, source identity, complete font HTTP bytes and cleanup are required before promotion.

Verified pre-release API: cooking-backend:25, source46e49d84b374572d27adfb07230779b38b492f08, digestsha256:657aa14a2332ad4832bc8845859b1a6b797959a3d7e9655c3deb787472421d5d. Worker remains cooking-store-worker:2. Website rollback deployment: dpl_byEVXLYjCbHviWuPqwMBb3hh55ie, source6f6c8753f4c77a8acb6e6671fa624b1df08fb8e3. Existing configuration is fingerprinted privately, without recording raw secrets. Preserve all Gemini settings, credentials, budgets and task/service settings.

## Native distribution limit

Native source and JavaScript bundle are verified separately. The preceding feature task rebuilt and installed a simulator binary containing print/sharing/WebView modules, but actual native PDF sharing was not verified. This website/API rollout does not publish a native binary or OTA update; the new native modules require a rebuilt distributed app.
