# Muse shopping and pack suggestions release

The user authorized production deployment after reviewing the Muse shopping flow and asking for help choosing pack counts. Frozen application source: `219c6bcd7ac4bdd259cf46381c06aa1cc0607c86` (feature commit `be2e04e` plus Chinese unit support), based on production recipe-editor source `63ddb1848d9970e9ab2bafe2d7dd084144b0775d` and its documentation commit `b208272`.

## Delivered behavior

- Smart shopping offers Prepare with Muse after products are selected. Customers review exact products, total pack counts, unresolved ingredients, budget, and substitution preferences, then copy a structured request and open Muse.
- Pack suggestions combine matching ingredient needs, convert compatible mass/volume/count units, and round up to whole purchasable packs. The explanation shows the needed amount, package size, supplied amount, and leftover amount.
- Chinese Weee pound/ounce labels (磅/盎司) are supported. Fluid-ounce qualifiers and uncertain range labels require review rather than mass conversion.
- Customers can edit pack counts and provide a package size when a listing is unclear. Ambiguous or incompatible quantities require review instead of a guessed count. Existing manually confirmed additions require checking the actual cart total.
- The request instructs Muse to add only any shortfall, preserve unrelated cart items, follow the selected substitution rule, and stop before checkout. Chef World does not claim a retailer cart write from copying the request.
- English and Chinese strings, account/week reset behavior, keyboard focus, manual quantity edits, pantry exclusions, and existing shopping progress are preserved.

## Verification

- Fresh locked dependency install; 601 web tests, 249 shared tests, and 36 API-client tests passed. Web TypeScript and an optimized production build passed.
- 24 browser checks passed on phone, tablet, and desktop against the production build, covering the Muse request and existing shopping flows. Retailer/API responses were controlled fixtures for these browser checks; no customer cart was modified.
- Independent source review found only 14 intended paths changed, exact reviewed new-file contents, and 67 additional translation keys per language with existing strings unchanged. Existing production shopping layout and the latest recipe editor/import features are retained.
- All 213 uploaded source files match the frozen commit. Vercel's dry-run file list and content hashes match the upload manifest; no local build, backend source, secrets, or preview server code was uploaded.
- A fresh Vercel build without build-cache reuse completed successfully. Six hosted routes returned HTTP 200. The 22 checked CSS/JavaScript assets contain production API configuration and expected Muse request/pack features, with no local sample-server markers.

## Production result

Initial feature deployment `dpl_56uwBFGfoQ19YP8SWvazyntLwNnS` was promoted and verified on both domains. A signed-in live browser loaded real Weee matches and rendered automatic pack explanations and the review dialog. This revealed the missing Chinese pound/ounce aliases; 18 regression cases were added, bringing quantity-helper coverage to 104 tests. The final artifact changes only that helper among the same 213 upload paths.

Final production deployment: `dpl_7h33SMUgPbeYLR4yML79AM6zbe8Z`, `https://cook-12ahs9i7e-jerrys-projects-08f739a2.vercel.app`.

- Final promotion succeeded; both `chef-world.com` and `www.chef-world.com` resolve to READY deployment `dpl_7h33SMUgPbeYLR4yML79AM6zbe8Z`.
- All six live routes returned HTTP 200. All 22 CSS/JavaScript asset paths and SHA-256 hashes exactly match the verified staged build. Chinese mass aliases and the complete fluid-ounce guard were checked in the hosted JavaScript.
- The signed-in production browser loaded 25 real Weee matches. In the Muse dialog, a real `8 盎司` bean product suggested one pack for a 20 g need, with 226.8 g per pack and 206.8 g left over. Unknown quantities still blocked copying until review.
- The final deployment's bounded 15-minute Vercel log scans returned zero error/fatal and HTTP 5xx records at verification time. This is a release observation, not ongoing monitoring.
- No request was submitted to Muse and no retailer cart write or checkout was performed. Automated clipboard/handoff tests passed; live verification established the production review UI and real product quantity calculation.

## Scope and rollback

This publishes the website, including mobile browsers. The native implementation remains in the main working checkout and is not included in this website release. A separate native binary is necessary for the newly added clipboard dependency; no native binary or OTA update was published. No backend, database, or worker deployment is part of this release.

Pre-feature website deployment: `dpl_E4wVbZRN2a1LtG2ird75WNbY3FyH`. Rollback requires promoting that website deployment; no schema downgrade is required.

Evidence: `/private/tmp/chef-muse-release-20260925/` and its `chinese-units/` subdirectory, including tests, build logs, upload manifest, Vercel records, and staged/live route and asset checks. Documentation commits may follow the frozen runtime source without changing the deployed code.
