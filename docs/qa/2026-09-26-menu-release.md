# Library menus and daily creation limit — release verification

Frozen application source: `fd614f286f2adf81e761e2ff4f356b7f1d3912f0`, on `codex/menu-release-20260926`. The website and API are deployed and verified. Both `chef-world.com` and `www.chef-world.com` serve the reviewed menu release.

## Delivered behavior

**My Library → Make a menu** lets users select individual recipes or their entire owned library, including recipes outside the current search, filter, or browsing page. Menus offer six styles, editable titles, dishes, descriptions and sections, optional AI artwork with explicit acceptance, and multiple PNG/PDF pages. Editing a menu does not change saved recipes.

Non-admin accounts can start **one new menu session per UTC day**, counted on the first Continue from recipe selection into the editor. Configured administrator account IDs are exempt from this creation limit. The server atomically records an account-scoped request ID and daily counter: concurrent distinct requests admit only one session, and retries of the same ID return the original admission. Back, editing and exporting within that session do not consume another allowance. Admission has a 30-second client deadline, and ambiguous retries retain their original ID even if the allowance is already consumed. Drafts remain in the editing session; leaving does not save a cloud draft. Both clients warn before discarding an admitted menu.

Menu admission is separate from AI image allowances. Preset styles work without a provider. Artwork retains the deployed image rate limits, administrator image policy, monthly reservations, usage reconciliation, shared concurrency leases, operation deadlines, upload accounting and owned-image deletion cleanup. A separate conservative token bound covers portrait artwork; existing square recipe-cover request hashes remain compatible. Provider credentials never enter rendered menu documents.

## Integration and schema

This release combines the deployed API source `46e49d8` and documentation `008370a`, deployed Muse source `6f6c875`, and the reviewed menu feature. It preserves equipment removal, import recovery and language handling, shopping quantity aggregation, cautious Muse estimates, onboarding, image controls and administrator cost reporting. The original dirty checkout remains untouched, and unrelated dependency upgrades were excluded.

New authenticated routes are `GET /menus/access`, `POST /menus/creations`, and artwork access, generation, status and file retrieval under `/menus/artwork`. Additive migration order is `20260925_recipe_images` → `20260925_menu_artwork` → `20260926_menu_creation`.

## Verification

| Area | Evidence |
| --- | --- |
| Shared/API client | 342 shared and 56 API-client tests passed. |
| Web/native source | 665 web and 385 native tests passed; the final 15-test native screen run passed after the initial-admission leave-guard fix. Both application TypeScript checks and the iOS JavaScript export passed. |
| Backend | Broad run: 1,180 passed and 120 skipped. The 16 Chromium cases initially blocked by shell sandboxing passed in the authorized targeted run, which had 67 passing tests. Focused accounting/admission and final creation/artwork runs passed. These targeted counts overlap other suites. |
| PostgreSQL | Creation races, same-ID retries, cross-purpose image isolation, account cleanup, migration replay, and downgrade/re-upgrade passed. Seeded legacy cover hashes, default purpose and ledger IDs were preserved; the sole head is `20260926_menu_creation`. |
| Local browser | 32 passed and 4 existing viewport skips across phone, tablet and desktop. Coverage includes daily denial, administrator admissions, Back without a second charge, and actual PNG/PDF exports with controlled API/provider fixtures. |
| Independent review | Backend and client reviews passed after correcting the administrator failure fallback and the native initial-admission discard guard. |

Fresh Linux/amd64 backend and web images were built without cache reuse. The backend runtime verified 142 committed file hashes, dependencies, nonroot execution, Chromium, media boundaries, disposable PostgreSQL migrations, authenticated menu quota races/replays, provider-fixture accounting and storage, existing application contracts, process containment, graceful shutdown and cleanup. The web runtime verified production API configuration, preserved features, menu entry/quota/artwork markers, and all five font responses against committed bytes, including CJK and unknown-font rejection.

The frontend upload contains exactly **252 files (23,209,285 bytes)**. Vercel's actual dry-run paths, SHA-1 upload hashes, byte counts and source SHA-256 hashes match the frozen commit. Only `.vercel` is ignored; local test servers, secrets and build outputs are excluded.

## Release identity and live checks

- Published backend digest: `sha256:fa594a36750acfcd25753f01b38d1e4d73b534cbfb998d1fff1b2cbd65b33589`.
- Locally verified web image: `sha256:a648b42269d5e34975671d51993ed2cf5c34bbd2f8b37a7717aa669bf60bc499`. This image is verification evidence; Vercel performs its own source build.
- API: `cooking-backend:26`, deployment `ecs-svc/5015215533793582144`, running task `32133b766efa4dbfacd7500ad2233b6f`. The advisory-locked migration succeeded before service update. The exact published digest is running in a completed, healthy rollout; `/health` and `/ready` return 200, protected menu routes return 401 anonymously, and menu POST CORS passes. The load balancer uses `/ready`; the bounded API/worker scan recorded no warnings, errors, tracebacks or HTTP 5xx.
- Configuration: post-rollout HMAC comparison reports zero differences in existing credentials, budgets, all eight Gemini settings and task/service configuration. The worker remains `cooking-store-worker:2`; raw settings were not retained.
- Website: READY production deployment `dpl_FKwS3x6XtPvLCTvDp3aGabYhMPx2` at `https://cook-j6iuddvmn-jerrys-projects-08f739a2.vercel.app`. Deployment metadata matches the frozen source commit; both public aliases point to this exact deployment. Seven routes, 25 assets and all five font files passed; public asset/font bytes exactly match the reviewed candidate. The bounded 15-minute Vercel scan ending `2026-09-26T05:54:48.553636Z` reports zero error, fatal or HTTP 5xx records.
- Hosted browser: all 15 candidate cases passed across phone, tablet and desktop viewports. The protected preview initially redirected credential-free font requests to sign-in; the test harness then fetched the actual candidate fonts with authorized preview access and verified every SHA-256. After promotion, all three complete public export flows passed using normal application font requests, with no preview access or font relay. API and artwork responses remain controlled fixtures, and unmatched mutations are blocked. Each viewport produced a 1632 × 2112 PNG and a four-page Letter PDF containing the edited Chinese first dish and the final 42nd dish.

No usable authorized authenticated production account session was available for this release verification. Live authenticated quota enforcement and paid artwork generation are therefore **not claimed**. The authenticated quota, ownership, accounting and storage contracts passed against disposable PostgreSQL with a local provider fixture. No paid generation against production was performed for this release.

## Rollback and distribution limits

Pre-release API: `cooking-backend:25`, source `46e49d84b374572d27adfb07230779b38b492f08`, digest `sha256:657aa14a2332ad4832bc8845859b1a6b797959a3d7e9655c3deb787472421d5d`. Website rollback target: `dpl_byEVXLYjCbHviWuPqwMBb3hh55ie`, source `6f6c8753f4c77a8acb6e6671fa624b1df08fb8e3`. Worker baseline: `cooking-store-worker:2`.

If rollback is needed, first verify that no newer approved release has superseded these targets. Restore the prior API revision and website deployment independently; leave the additive schema in place during application rollback.

This rollout publishes the website/API only. Native source and JavaScript are verified, but no native binary or OTA update is distributed. The new print/sharing/WebView modules require a rebuilt app. Actual native PDF sharing remains unverified on a physical device.

Evidence directory: `/private/tmp/chef-menu-release-20260926`. Principal receipts: `runtime/runtime-result.json`, `runtime/runtime-menu-contract.log`, `web-runtime.json`, `backend-published.json`, `upload-verification.json`, `production-api-verification.json`, `production-web-verification.json`, `staged-verification.json`, and `live-verification.json`. Browser receipts and inspected export artifacts are under `.superpowers/menu-release-20260926/hosted-tests` in the release worktree.
