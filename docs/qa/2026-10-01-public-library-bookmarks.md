# Public Library bookmark polish — October 1, 2026

Implemented on `codex/public-library-bookmarks-20261001` in the managed `smart-shopping-guide-release` worktree, based on `26e95d8`. That base contains the verified October 1 shopping-guide release and production recipe source-link editor. The primary checkout's unrelated changes were not included. This redesign has not been deployed.

Public recipe cards now show a 44px circular bookmark over the photo. Outline means a personal copy can be added; filled sage means already saved. A single English/Chinese hint above the grid explains the convention. Recipe-specific accessible names, hover/focus labels, Escape dismissal, and hoverable label content keep the control understandable. Saved controls remain keyboard-focusable and reject activation; no delete or unsave operation is introduced.

Saving shows a spinner, preserves focus, announces progress/success, and refreshes My Library. In-flight copies are tracked per recipe and duplicate activation is guarded. Failed copies expose the existing translated alert and re-enable the same bookmark for retry. Account-keyed mounting and late-response checks remain intact. The public card now uses a valid `div` with `listitem` semantics, replacing an `article` with an unsupported role. Public detail links, time disclosures, search/filter behavior, natural image ratios, and shortest-column masonry remain available.

Validation:

- All 856 web tests passed across 92 files, including 13 library tests and meaningful simultaneous-copy, duplicate-prevention, focus-retention, retry, and late-unmount coverage.
- Next.js production build passed compilation and TypeScript checking.
- Ten local fixture browser cases passed: English and Chinese at 1440, 1100, 820, 390, and 320px. Checks covered natural photos, non-overlapping masonry, 44px targets, keyboard and Escape behavior, hoverable labels, accessibility scans, saving/pending/success/error/retry, search/filter, and browser errors.
- Four equivalent production-build smoke cases passed: English/Chinese at 1440 and 320px.
- Existing public-library natural-photo/masonry tests passed in desktop, tablet, and phone projects against the intentionally updated public-grid visual baseline.
- `git diff --check` passed.

The preview uses a temporary local API fixture and public image URLs read from the existing visible public library. Preview copy actions do not write production data. No provider tasks, backend changes, native release, or website deployment occurred.

Evidence: `/private/tmp/chef-public-library-bookmarks-20261001/` contains fixture metadata, verification scripts/results, full web test/build logs, public-masonry results, accessibility receipts, and English/Chinese desktop/phone screenshots. The `production/` subdirectory holds the production-build smoke results. Local review URL: `http://127.0.0.1:3203/library?view=public`; fixture API listens on `127.0.0.1:8123`.
