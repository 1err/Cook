# Ingredient search and unified Library release

Released 2026-10-01 to [Recipe library](https://chef-world.com/library).

## Behavior

The Library retains All recipes, My library and Public library across Recipe name and Ingredients modes. Match all requires every selected ingredient to appear in the recipe; Match any requires at least one. Neither rule claims that the selected ingredients cover the whole recipe or its quantities. The remaining-ingredient control shows the actual distinct ingredient names on hover, focus or tap, and dismisses with Escape or outside interaction.

Matching and pagination happen on the server across the entire visible collection. English and Chinese aliases, chicken cuts and preparation labels normalize conservatively. Chicken broth, potato starch and sweet potatoes keep their separate identities. Personal copies replace the original in All recipes; Public library retains the published originals. Private recipes belonging to other people and hidden personal recipes stay excluded.

Desktop uses three photo columns; phones use compact photo rows. Switching collection or search mode preserves the relevant query, ingredient chips and match rule. Categories apply only in Recipe name mode. Existing bookmark, menu, timing and recipe-detail behavior remains available.

## Deployed identity

- Application source: `d9e1cf4ea965c5d73b73ac73aea68aaf7bea9e66`.
- Frontend: `dpl_6ByJKuKfrctVyhotgrjgZQfCZVEz`, READY on both `chef-world.com` and `www.chef-world.com`.
- All 296 uploaded source files match the committed source. The newer cooking-navigation release at `8a3e803a6f3fb890b2693385b09e06724519f21c` was merged and preserved before publishing.
- API: `cooking-backend:45`, completed rollout, one healthy task and healthy load-balancer target.
- Immutable API image: `sha256:b94c325aee1e3542907d2e940d600911daa769b8dcbe323c3539263773a4f765`.
- Locked migration exited 0. No schema change is introduced. Runtime settings and the worker remain the same; AWS reordered its read-only task compatibility list.
- Test and documentation updates after the application commit are separate from the uploaded application source.

## Verification

- Backend: 1,641 passed, six existing skips. The ingredient suite includes 37 real PostgreSQL tests for aliases, all/any, scopes, privacy, cursor binding, deduplication and matches beyond the first browsing page.
- Web: 882 passed; shared: 407 passed; API client: 68 passed.
- Library browser regressions: 13 passed, two intentional skips for a resize test run only on desktop.
- Fresh backend and web images built successfully. Backend image source hashes match 163 committed files; runtime includes 18 actual HTTP checks and repeated migration. The web image ran without network access and served 15 routes and 42 assets as a non-root user.
- Six responsive cases each on the fresh image, protected candidate and live frontend: English and Chinese at 1440, 390 and 320 pixels. Matching, collection changes, preserved state, popover contents and placement, hover transfer, touch and Escape passed. No page errors, horizontal overflow or WCAG A/AA violations were recorded, including with the popover open.
- Direct live verification: 68 public page/asset requests across both domains, correct API binding and ingredient-search code, API health/readiness, anonymous authentication boundaries and CORS preflights.
- Five-minute bounded scans: no API errors, warnings or HTTP 5xx; no frontend error, fatal or HTTP 5xx records.

Browser journeys use the actual deployed frontend with disposable PostgreSQL recipe data and routed fixture photos. They do not establish signed-in behavior with a real production account. Live API and public-page checks above were direct. No production recipe/account writes, paid AI execution or native binary release occurred.

## Evidence

[Machine-readable release receipt](2026-10-01-ingredient-library-release.json)

[English phone results](artifacts/ingredient-library-2026-10-01/390-en-ingredients.png), [desktop ingredient popover](artifacts/ingredient-library-2026-10-01/1440-en-remaining.png), [Chinese narrow-phone popover](artifacts/ingredient-library-2026-10-01/320-zh-remaining.png). Screenshots show fixture data on the live frontend.
