# Library navigation, public previews, and menu integration

Frontend application source: `1d41d23f13238bbda5d64c4aa9ac5849b2b528c6`, branch `codex/ui-polish-20260926`. This integrates the existing Muse review release and the coordinated menu studio release.

## Customer changes

- The logo keeps returning signed-in customers to Library; a separate Home icon opens the marketing homepage.
- Make a menu uses a menu-card icon and outlined treatment distinct from Add Recipe.
- Cooking step titles and instructions are slightly smaller; timers and cooking controls retain their behavior.
- Public recipe cards open read-only dish details with ingredients, instructions, tips, and source. Customers can save a personal copy and edit that copy; the public source has no edit controls.
- The combined menu studio adds photo and illustrated layouts, adjustable design controls, and editable dish text. Arriving photo updates send only image changes instead of retransmitting bundled fonts.

## Validation

The final frontend passed 740 tests across 87 files and TypeScript. The upload manifest includes exactly 262 source/assets files, six menu fonts, and 24,855,635 bytes. Hash verification excludes backend code, environment files, tests, and local preview fixtures. Fresh Linux/amd64 Docker build and isolated nonroot runtime passed fourteen routes and six font checks. Image digest: `sha256:f954ddc5b96d5bfad87d5c8bca9dcd2727e3fa416a45ddc14f7f54ca9be5fd15`. Hosted candidate checks passed ten routes, 38 script/style assets, and all six font hashes, including dynamically loaded menu assets.

The earlier local menu-creation warning came from a sample API server without `POST /menus/creations`; it was not evidence of a production failure.

All 26 hosted candidate browser cases passed: sixteen menu cases and ten navigation/public-recipe/cooking cases across desktop and phone. The UI cases checked Home navigation, Library logo destination, menu styling, public preview, personal copy/edit, cooking steps/timers, Chinese controls, and guest redirects. Candidate tests used real hosted frontend bytes through a read-only local relay with temporary Vercel access retained server-side.

Two harness issues were diagnosed and retained separately: the initial relay excluded harmless page prefetches; and Playwright's `serviceWorkers: block` injected an unguarded `navigator.serviceWorker` access into opaque sandbox frames. An isolated iframe positive control reproduced the latter. A scratch-only top-frame registration guard replaced that broken test injection; the application sandbox, source tests, and application error assertions remained unchanged. The clean sixteen-case run passed with all six candidate font hashes matching source. Ten exported PNGs were 1632 × 2112; four PDFs preserved Letter pages, Chinese text, edited first dishes, and the final 42nd dish. Desktop/phone PDF renders matched, with no observed clipping.

## Deployment evidence

Website `dpl_Dv3G4yHEtL8BgsMZNgPiVv54egG8` is READY at `https://cook-ir0aa53dc-jerrys-projects-08f739a2.vercel.app`, with exact source metadata and upload-manifest verification. Both `chef-world.com` and `www.chef-world.com` point to this deployment. Ten live routes, 38 assets, and six fonts passed; live asset bytes match the reviewed candidate. The bounded 15-minute Vercel error/fatal/HTTP5xx scan ending `2026-09-27T04:36:19Z` recorded zero entries. This is a release observation, not ongoing monitoring. Evidence directory: `/private/tmp/chef-ui-menu-final-20260926`.

Browser checks use controlled authentication/recipe/menu responses and actual hosted frontend bytes. They do not establish real provider quality, live account quota enforcement, or a paid AI generation. Coordinated backend source is `7205a263d0f10eabbb2f11e5b05a4edf6bb2ba92`. It includes menu source `77161e6` and the separately deployed shopping alias source `b3260bd`; the only differences from the earlier menu source are shopping service/tests and documentation. The matching API is `cooking-backend:28` at digest `sha256:0c10673e9a9e7e36e22a834b84707232c1ec61908e0564e9fecf99a20e5bac80`. The coordinated menu task verified locked migration, healthy completed rollout, health/readiness, menu authorization boundaries, CORS, and zero differences in existing configuration fingerprints. Worker revision 2 is unchanged. Backend evidence is in `/private/tmp/chef-menu-studio-api-final-20260926/production-api-verification.json`. This release does not publish a native mobile binary.

After promotion, all fourteen direct public browser cases passed on `https://chef-world.com`: ten UI cases plus four full menu export cases, across desktop and phone. These loaded normal public assets and fonts with no relay or preview access. API responses remained controlled fixtures; no real user recipe changes or paid generation were performed. Temporary protected-candidate access was removed and both local verification relays were stopped.

The isolated release branch also merges backend source `7205a263` after staging to preserve the now-live shopping changes for future work. Its frontend inputs remain byte-identical to deployed source `1d41d23f`. The root working checkout was not deployed. Previous website rollback reference: `dpl_8RRp3oikT3Z1neEPXSnsdyHVvEhX`; recheck live state before using it.
