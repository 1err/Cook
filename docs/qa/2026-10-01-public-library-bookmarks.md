# Public Library bookmark polish — October 1, 2026

Implemented on `codex/public-library-bookmarks-20261001` in the managed `smart-shopping-guide-release` worktree, based on `26e95d8`. That base contains the verified October 1 shopping-guide release and production recipe source-link editor. The primary checkout's unrelated changes were not included. Application source `84796fa13c3e6cd55d67d9ae2c110df1114f501d` is deployed as Vercel `dpl_7zo588ZExje354MF78Nk7RcgwSLQ`, READY on both Chef World domains.

Public recipe cards now show a 44px circular bookmark over the photo. Outline means a personal copy can be added; filled sage means already saved. A single English/Chinese hint above the grid explains the convention. Recipe-specific accessible names, hover/focus labels, Escape dismissal, and hoverable label content keep the control understandable. Saved controls remain keyboard-focusable and reject activation; no delete or unsave operation is introduced.

Saving shows a spinner, preserves focus, announces progress/success, and refreshes My Library. In-flight copies are tracked per recipe and duplicate activation is guarded. Failed copies expose the existing translated alert and re-enable the same bookmark for retry. Account-keyed mounting and late-response checks remain intact. The public card now uses a valid `div` with `listitem` semantics, replacing an `article` with an unsupported role. Public detail links, time disclosures, search/filter behavior, natural image ratios, and shortest-column masonry remain available.

Validation:

- All 856 web tests passed across 92 files, including 13 library tests and meaningful simultaneous-copy, duplicate-prevention, focus-retention, retry, and late-unmount coverage.
- Next.js production build passed compilation and TypeScript checking.
- Ten local fixture browser cases passed: English and Chinese at 1440, 1100, 820, 390, and 320px. Checks covered natural photos, non-overlapping masonry, 44px targets, keyboard and Escape behavior, hoverable labels, accessibility scans, saving/pending/success/error/retry, search/filter, and browser errors.
- Four equivalent production-build smoke cases passed: English/Chinese at 1440 and 320px.
- Existing public-library natural-photo/masonry tests passed in desktop, tablet, and phone projects against the intentionally updated public-grid visual baseline.
- `git diff --check` passed.

The preview uses a temporary local API fixture and public image URLs read from the existing visible public library. Preview copy actions do not write production data. No provider tasks, backend changes, native release, production recipe copies, or retailer cart writes occurred. The website release is recorded below.

Evidence: `/private/tmp/chef-public-library-bookmarks-20261001/` contains fixture metadata, verification scripts/results, full web test/build logs, public-masonry results, accessibility receipts, and English/Chinese desktop/phone screenshots. The `production/` subdirectory holds the production-build smoke results. Local review URL: `http://127.0.0.1:3203/library?view=public`; fixture API listens on `127.0.0.1:8123`.

## Production release verification

Vercel `dpl_7zo588ZExje354MF78Nk7RcgwSLQ` (`https://cook-l8wpwi1wz-jerrys-projects-08f739a2.vercel.app`) serves `chef-world.com` and `www.chef-world.com`, both inspected as READY. Remote Next.js build completed in approximately 94 seconds. The first CLI status stream disconnected after uploading; Vercel's direct deployment status confirmed the same candidate completed successfully, and no duplicate deployment was created.

All 289 preceding-production upload files matched base `26e95d8`. The isolated staging directory contains 290 committed frontend files, including the new bookmark component. Upload SHA-1 and committed SHA-256 comparisons passed for every file. No local `.next`, fixture API setting, `.env`, dependencies, or unrelated primary-checkout changes were uploaded. Both hosted browser suites verified the compiled API base is `https://api.chef-world.com`.

Six hosted candidate and six post-promotion live fixture cases passed in English/Chinese at 1440, 390, and 320px. They verify the same save, pending, retry, focus, Escape, hover, natural-photo, masonry, accessibility, search/filter, and console behavior as local checks. Eight public routes and 72 script/stylesheet requests passed across both domains, confirming the new localized bookmark UI and preserved shopping guide. A separate real signed-in Chrome read confirmed all 16 visible saved recipes use filled bookmarks and the one-time hint; no recipe was copied. The bounded five-minute production website error scan returned zero entries.

Release receipt and source/upload/public/browser proofs: `/private/tmp/chef-public-library-release-20261001/`. Temporary deployment access files were removed after verification. Website rollback is `dpl_ACp7BxcHJxfTdvKeSQ119r39SueK`.
