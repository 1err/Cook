# Muse shopping review redesign

Application source: `6e10d04c4b78df2fa099235ea8dc2b70101ed99e`, branch `codex/muse-review-ui-20260926`. Based on the deployed menu release, with only five frontend runtime files changed. No API, database, calculation-helper, or native release is included.

## Customer flow

Prepare with Muse presents a compact Review & copy → Paste into Muse flow. Product names and pack controls are readable on a phone; calculations and package-size corrections live under Details, and optional shopping preferences are collapsed. The footer stays visible while products scroll.

**Confirm quantities & copy** confirms the current request and immediately attempts the clipboard write. There is no separate checkbox to discover. Automatic estimates and one-pack starting counts remain labeled; starting counts do not promise sufficient coverage. Copy success shows **Open Muse**. Denied clipboard access opens selected request text for manual copying.

Invalid quantities or budget expose a fix action that focuses the affected input. A changed meal plan or obsolete shopping quantity version exposes an update action with visible retry errors; successful preparation closes the dialog and requires choosing products again. Request edits, including edit/revert, close, scope changes, staleness and refresh transitions invalidate previous confirmation and late clipboard responses. Copying does not mark retailer items added or place an order.

## Verification

- 676 web unit tests passed. The final targeted dialog run passed all 27 tests, including stale clipboard results and focus recovery.
- Web TypeScript and the production build passed with the production API origin and local email preview disabled.
- All 18 local browser cases passed across phone, tablet and desktop, using controlled API fixtures. Tests covered actual clipboard contents, estimate confirmation, manual quantity editing, invalid fields, stale-list failure/retry/reset, and a 25-product list.
- Axe reported no accessibility violations at all three viewports. Footer actions remained in view without horizontal overflow. English and Chinese phone layouts were visually inspected in the in-app browser.
- Independent code review found no actionable blockers. The redesign was also transplanted into the original working checkout with unrelated edits preserved; its TypeScript check and all 27 dialog tests passed. The production upload comes exclusively from the isolated committed release.
- Vercel dry-run discovery matched all 252 allowlisted source files and both SHA-1/SHA-256 hashes. No test fixtures or private environment files were uploaded.
- All 18 hosted candidate browser checks passed in 29.1 seconds. Vercel protection remained enabled; the test harness used authenticated GET-only reads of verified hosted files, while all 204 API requests used controlled fixtures. No external requests escaped the harness. Earlier protection and cold-relay failures were test-setup issues and are retained separately from the passing report.
- The production-target candidate is READY with matching source metadata. Seven hosted routes, 25 assets and all five existing menu fonts passed checks; expected new Muse markers and existing menu features are present.

Both `chef-world.com` and `www.chef-world.com` now point to this READY deployment. Public checks passed all seven routes, 25 assets and five fonts, with byte hashes exactly matching the candidate. A direct desktop browser case also passed on `https://chef-world.com` with normal public asset requests and actual clipboard assertions; its API calls remained fixture-controlled. No authenticated asset relay was needed after promotion.

## Release receipts

Published website: `dpl_8RRp3oikT3Z1neEPXSnsdyHVvEhX`, https://cook-enulufpco-jerrys-projects-08f739a2.vercel.app.

Previous website: `dpl_FKwS3x6XtPvLCTvDp3aGabYhMPx2`. Recheck live deployment identity before any rollback; do not replace a newer approved release.

Evidence: `/private/tmp/chef-muse-review-ui-20260926`, including unit/build logs, screenshots, upload hashes, source metadata and staged route/asset/font receipts. Browser checks use controlled shopping/auth data, not a live customer account or real retailer cart.
