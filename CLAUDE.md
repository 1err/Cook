# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This file is the authoritative reference for what the codebase currently does.** The older `CODEBASE_WALKTHROUGH.md` has been removed — there is no parallel narrative anymore. Trust this file plus the code. **When you change behavior, API surface, file layout, env vars, or deployment, update the matching section here in the same change.**

## Product summary

A personal cooking assistant. Each user has an account and a private recipe library populated through manual entry, pasted recipe text, public YouTube captions/title/description, or accessible public RedNote posts. Optional, explicitly configured Gemini analysis can read public YouTube video/audio, anonymously accessible RedNote video, or user-uploaded media. The public import workflow supports YouTube and RedNote links; TikTok and Douyin are unsupported. Import jobs return editable drafts with a completeness review and source evidence. Ingredient-only sources remain partial recipes rather than receiving an invented cooking method. Recipe detail shows verified source moments, timing provenance, and step images or shared action pictograms. New imports receive labeled planning estimates for unstated step times; older or explicitly cleared timings may still be unspecified. The backend owns one normalized active cooking session per account. Web and mobile expose Cook as a primary destination: users can start a planned or manually selected multi-dish session, follow one step at a time, run passive timers when a duration is available, switch dishes, see progress, and resume the same account session across devices.

Users can also assign recipes to days of the week in the planner (breakfast / lunch / dinner slots). The centered desktop Planner keeps the complete week in one viewport; each populated meal slot adaptively fills one to three compact recipe rows and scrolls in place for a fourth or later recipe. Its saved-recipe rail has no footer action (the empty-state import guidance remains). The desktop recipe picker uses a three-column, image-rich card grid with a visible Add action for each result. The shopping list page aggregates ingredients across the planned week inside the same restrained 1120px shell and title rhythm as Library. The web original view shows planned meals and the preparation action; ingredient checkboxes, copy, and product selection appear only in the prepared smart-list view. Temporary refinement failures expose a labeled checklist with the recorded recipe quantities and an explicit retry. Native retains its immediately usable basic checklist (check/share and selectable text). Smart preparation produces a grouped grocery list via an LLM call plus suggested store products from Weee backed by a multi-layer cache. Web and mobile then offer a guided Weee cart companion: safe top matches are selected by default, alternatives and an estimated subtotal stay reviewable, and the app opens one URL-validated official-host product page at a time while recording only progress the user explicitly confirms.

Positive cache rows are shared across all users: after one user triggers a successful scrape and the result is committed to PostgreSQL, subsequent users can receive that fresh row immediately. A serial background warmer opportunistically force-refreshes the configured common queries every 24 hours while the process remains alive; its interval resets on restart and there is no durable catch-up. Backend startup does not launch a warming sweep.

Smart shopping quantities are consolidated deterministically before the model organizes names/categories. The exact parser preserves fractions, bounds, repeated recipes, and explicit alternate measurements. Purchase aggregation merges only a short Chinese alias allowlist: 生抽/生抽酱油/鲜味生抽 → 生抽; 老抽/老抽酱油 → 老抽; 油/食用油/植物油 → 食用油. Other sauces, oils, and name modifiers remain distinct. A separate purchase normalizer may estimate one metric total for supported pantry ingredients (salt, sugar, all-purpose flour, cooking oil, soy sauces, and oyster sauce), always marked `about`/`约`. Garlic cloves use a documented 3 g estimate only when combining with a recorded weight; recorded equivalent weights take precedence, and vague pieces or scallion sections remain unconverted. Displayed totals omit taste and spoon-conversion explanations; vague-only amounts show `适量`/`to taste`, and missing units remain flagged. Saved complete metric equivalents replace eligible primary measurements once; they do not override an already metric, cleared, bare, or uncertain primary quantity. Existing compiled lists remain cached until the customer explicitly prepares them again; checkmarks and selections are not silently reset. These estimates do not change Muse's conservative pack calculation rules.

The web beta polish keeps Library, Planner, Shopping, Cook setup, Import, and Settings on the shared page-header spacing. On narrow screens the shopping preparation action comes before planned meals in both reading and visual order; desktop retains its two-column layout. Library load failures use a translated recovery message and retry action. Empty personal Library and manual Cook selection link to public recipes. Settings sharing controls, recipe tags, and shopping meal/week summaries follow the selected English/Chinese language. Primary mobile actions have at least 44px touch height, and Library/Cook text inputs use 16px to avoid automatic mobile zoom.

## Repo shape (npm workspaces + Python)

Visible Instacart controls are removed from web and mobile for the beta release at the owner’s request. The unused panel components, shared helpers, and backend export endpoint remain for possible future integration; they do not alter Weee lookup, cart selections, or progress.

- `apps/web` — Next.js 15.5.24 App Router (`@cooking/web`). Cookie-based auth. Pages: `import/`, `library/{,[id]}`, `library/friends/{,[userId]/{,[recipeId]}}` (friend library search + read-only browse + copy), `planner/`, `cook/`, `shopping-list/`, `recipe/[id]` (timed tutorial read view plus Start/Add/Open cooking actions), `recipe/[id]/tutorial/edit` (focused tutorial editing and preview-only enrichment), `admin/dashboard/` (administrator growth analytics), `preview/` (admin cache console), `settings/` (sharing, verification, sign-out-everywhere, password-confirmed deletion, support/privacy), `login/`, `register/`, `check-email/`, `forgot-password/`, `reset-password/`, `verify-email/`. Library remains the authenticated landing page; primary order is Library / Planner / Shopping / Cook. Settings and a Delete account shortcut live in the NavAuth dropdown. The shortcut opens the existing password-and-acknowledgement confirmation in Settings. Cook supports planned/manual setup, multi-dish focus, passive timers, offline replay, and account session sync. Shopping includes selectable Weee matches plus a native-dialog cart review and one-at-a-time guided handoff.
- `apps/mobile` — Expo / React Native iOS app (`@cooking/mobile`). Bottom tabs are Library / Planner / Shopping / Cook over per-tab native stacks, with Account and Import as root-level modal flows. Source layout is feature-folders + a small design system (see "Mobile structure" below). Product surfaces include auth/recovery flow, account verification/deletion/sign-out-everywhere and support/privacy, Library list with **segmented control between "My Library" and "Public Library"** (catalog browse + one-tap copy-to-library, already-copied detection via `catalog_source_recipe_id`), **friend library sharing** (search icon in Library header → `FriendSearchScreen` (email lookup) → `FriendLibraryScreen` (list + copy with already-copied detection); Account toggle "Share my library" flips `users.is_library_public`), Recipe detail (timed tutorial labels, images/pictograms, Edit tutorial, Start/Add/Open cooking actions, and the editor-only "Add/Remove public library" menu item gated by `/recipes/catalog/editor-status`), focused or full Recipe edit, Planner (week navigation + bottom-sheet recipe picker), Cook (planned/manual setup, multi-dish focus, passive timer ring/tray, owned local notifications, screen wake, offline replay, and account sync), Shopping (smart list + per-ingredient selectable Weee product picks + **"Load top picks from Weee" batch-first button** that opens all panels, publishes fresh cache hits, and sends only misses through one serial live worker + native cart-review modal/guided handoff + per-category **"Already have" subsection for checked items** + planner-stale detection), and Import (manual creation, pasted YouTube/RedNote links or recipe text, optional video-library upload, cancellable jobs, partial-draft/evidence review, explicit reanalysis replacement, and iOS Share Sheet URL prefill). The native Share Sheet requires a custom iOS development/EAS build and is absent from Expo Go; pasted-link entry remains the fallback and the Android path.
- `packages/shared` — types, week/meal-plan/ingredient/category helpers, store enum, the pure retailer-neutral cart-draft/price/confirmation model, client-safe UUID generation for idempotent cooking actions, and i18n strings (`packages/shared/src/messages/{en,zh}.json`). **Single source for these helpers** — pages import from `@cooking/shared` directly; no per-app re-export shims under `apps/web/app/lib/`.
- `packages/api-client` — `createApiClient({ baseUrl, auth })`. `auth.kind: "cookie"` adds `credentials: "include"`; `auth.kind: "bearer"` always uses `credentials: "omit"` and adds `Authorization: Bearer …` when `getToken()` returns a token. Tokenless native login/registration also omit cookies so a previous OS cookie cannot interfere with account changes or origin checks.
- `backend/` — FastAPI + async SQLAlchemy + Alembic. **Postgres only** (asyncpg).
- `scripts/` — manual cache warming and cleanup utilities, plus `docker-up.sh`.

Public Library web cards place a 44px bookmark on the photo instead of repeating a text button under every recipe. An outline adds a personal copy; a filled sage bookmark indicates an existing copy. One translated hint explains these states above the grid. Hover/focus labels and recipe-specific accessible names describe the action; saved and pending controls remain focusable with guarded clicks. Each recipe tracks its own in-flight copy, announces progress/success, and becomes retryable after an error. Photo aspect ratios, masonry placement, public detail links, and personal-library refresh are preserved.

## Library menu creation

My Library offers **Make a menu** on web and native. Opening the compact menu picker loads the complete owned library so Select all includes recipes beyond visible browsing pages. Users choose up to 24 dishes, optionally supply a title and visual description, and click **Generate menu**. AI composes one complete portrait PNG with food illustrations and dish labels. Web downloads the PNG; native previews and shares it. There are no layout controls or editable text overlays in this flow. Recipe data is unchanged. Draft selections and results are session-only and reset on account changes. Selecting more than 24 dishes never silently truncates the library; the Generate button remains disabled until the selection fits.

Non-admin accounts may generate one new menu per UTC day; UUIDs in `ADMIN_USER_IDS` are exempt from this creation limit. `GET /menus/access` returns the server allowance and reset. The new `POST /menus/artwork` body uses `mode: "full-menu-v1"`, one immutable request UUID, optional title (120 characters), optional brief (1,200 characters), and 1–24 unique owned recipe ID/name snapshots. The backend validates ownership and exact current names, then atomically admits the menu creation and existing image/money reservations. No separate creation request precedes Generate. The same request replays before current recipe validation or quota checks. Changed payloads conflict; recipe deletion or rename does not prevent recovery of an already-admitted image. Admin exemption does not bypass image attempt, monetary, storage, membership or global controls.

The full-menu image uses the existing provider, model and reviewed portrait accounting bound. Full-menu deadlines are 180 seconds for the provider, 225 seconds for the operation and 255 seconds for the durable job/lease. Clients allow 240 seconds for status resolution and 270 seconds for the complete operation. Stop waiting cancels local waiting; Check my menu recovers the same immutable request. Ambiguous transport failures never start an automatic new generation. Explicit recovery may replay the exact UUID/body when status is absent. The authenticated PNG route preserves owned-image receipts and account-deletion cleanup. Dish names are generated pixels, so the result reminds users to review names before sharing.

Legacy v1/v2 decorative-artwork request hashes, `/menus/creations`, `/menus/designs`, owned recipe-image export, renderer components, fonts and PNG/PDF helpers remain for compatibility. They are not mounted by the simplified menu entrypoint. No migration or production configuration changes are needed for full-menu mode. Existing migrations remain `20260925_menu_artwork` and `20260926_menu_creation`. Native source updates require a separate native release. See `docs/qa/2026-09-27-simple-menu.md` for verification of the current flow, including a real isolated nine-dish generation; earlier studio evidence remains in `docs/qa/2026-09-26-menu-studio.md`.

## AI recipe covers and cost reporting

Recipe import review and full recipe editing on web and native offer **Generate with AI**. Generation creates a preview; users choose **Use image** or **Discard**, then save the recipe normally. Applying a cover preserves concurrent text edits. Requests use account-owned UUIDs and status recovery to avoid billing a duplicate request after a lost response. The backend owns access, counters, ownership and storage. Signed-in users receive 3 admitted image attempts per UTC day; administrator accounts receive 100. These are maximum allowances, subject to shared monthly AI and cumulative storage safeguards. The entitlement/access-mode switch supports a later paid-member rollout without accepting client-side membership claims.

Images use the existing server-side OpenAI key with a bounded `gpt-image-2` request (one low-quality 1024-square PNG). Image calls join the existing durable AI monetary ledger, using reviewed standard token pricing and conservative reservations before provider work. Successful provider usage is reconciled even if subsequent validation or storage fails; missing usage and uncertain failures retain a reservation. Regular accounts share their existing monthly allowance; administrator image calls can use the configured global monthly allowance, while every account still shares the same global ceiling. Trusted `ADMIN_USER_IDS` accounts use the configured global monthly allowance for shared metered text, video, and image calls. Ordinary accounts retain `AI_ACCOUNT_MONTHLY_BUDGET_USD`; catalog-editor status and email do not grant an exemption. All calls retain atomic global reservations, the modeled USD 30 hard cap, and uncertain-call reservations. Production uses a USD 29 global monthly budget and USD 3 ordinary-account monthly budget.

The administrator dashboard's **Costs** tab reports the current UTC month's app-recorded AI estimates, tokens, call counts, model/operation breakdown, image outcomes and remaining monthly allocation. Unpriced or in-flight calls and reserved amounts stay separate from known estimates; the first ledger record is shown and earlier spending is not reconstructed. OpenAI invoices and usage outside this app, provider discounts, credits, taxes and hosting may differ from the ledger. An independently cached AWS Cost Explorer report shows estimated account-wide unblended costs and service breakdown; it is not claimed as app-only spending. AWS reads use the existing task role with only `ce:GetCostAndUsage`, bounded timeouts and caching. Unavailable AWS/Vercel data is never presented as zero. Provider billing links remain the authority for invoices. Native code requires a separate native release; deploying the website does not publish an iOS binary.
## Muse shopping handoff

Web and mobile smart Shopping also offer **Prepare with Muse**. Web smart mode includes a compact, always-visible English/Chinese numbered guide: check off ingredients already at home before loading picks, load and choose Weee products, then review/copy a request and paste/send it in Muse. The review suggests editable total pack counts (1–99) from shopping-list amounts and explicit package sizes, plus an optional USD budget for the listed products and ask/skip substitution preferences. Shared `musePackSuggestion.ts` sums requirements for a grouped product, converts compatible mass/volume/count units, and rounds up whole packs. Web places package-size editing, calculation, coverage, and leftover amounts behind each product’s Details disclosure; native shows its existing calculation review. Customers can enter or correct a package size from the listing when the title does not provide one; that reviewed size is included in the Muse request. Manual edits (including cleared inputs) survive reopening and unrelated matches, with a “Use suggestion” action to restore the calculated count. Pack estimates distinguish calculated counts, approximate counts (including about/约, numeric ranges, and complete compatible amount sums), and a one-pack starting count when sizes/amounts are missing or measurements differ. Starting counts never claim sufficient coverage or leftovers. Excessive counts, invalid numeric inputs or explicit package sizes, and overlap with a product already marked added still require a manual quantity. On web, a two-step review uses large pack controls and a persistent **Confirm quantities & copy** action: this click explicitly confirms the current quantities and immediately copies the same request, without a separate checkbox. Estimates and one-pack starting counts remain labeled; optional shopping preferences and unmatched ingredients are collapsed. Invalid inputs receive focus from **Fix quantities** or **Fix budget**. Stale lists offer an explicit refresh with visible retry errors, then require product selection again. Copy success exposes **Open Muse**; denied clipboard access exposes selected request text. Native retains its checkbox review for automatic approximate/starting quantities. Request edits, close, scope changes, stale lists, and in-flight refreshes invalidate review and late clipboard results. The request carries each quantity source and tells Muse not to assume a starting pack is enough or increase reviewed counts without asking. There are no density-based weight/volume guesses, and calculations use the refined shopping amount rather than claiming an exact raw recipe need. Shared `museShopping.ts` groups selected safe Weee product links, omits manually confirmed selections, and includes pending/unmatched ingredients as unresolved. The generated English/Chinese request asks Muse to check the existing cart, add only any shortfall, preserve unrelated items, and stop before checkout. Copying or opening Muse never changes cart-confirmation state. Web offers a selectable preview and text download; native uses `expo-clipboard` with selectable-text fallback when copying is unavailable. Customers open their own Muse account at `https://muse.ai/` and paste the request; there is no public Muse task API integration, shared-login mechanism, or hosted shopping-list link in this release. Pack counts/preferences stay in component memory, scoped to account/week; changed product/ingredient content invalidates reviewed quantities. There are no new persistence keys or backend routes. Native custom development/production binaries need rebuilding to include the new Expo clipboard module; unsupported binaries still show the selectable request. Retailer authorization remains a separate release requirement before promoting automated Weee cart writes. Native code is available in the main working checkout; this website-only release does not publish a native binary.

## Public RedNote and YouTube imports

Link imports currently accept only YouTube and RedNote (小红书), including full copied RedNote share text and HTTP xhslink short links. TikTok and Douyin are not advertised or admitted by public source validation. Share-prefill keeps user control: prepare an editable review draft, then save explicitly.

RedNote retrieval uses pinned curl-cffi with an anonymous browser-compatible client, not a paid downloader or personal cookies. It retries the exact token-bearing public note inside a trusted login redirect once; source attribution and completed jobs omit the share token. Genuine authentication requirements remain actionable upload/text fallbacks. Known numbered video/backup CDN hosts are allowlisted alongside the existing named CDNs.

Public RedNote downloads are bounded to 150 MiB on temporary disk. Above the 30 MiB Gemini limit, local ffmpeg preparation accepts up to ten minutes/4K and returns a bounded MP4. Preparation preserves audio, uses up to 720px width and 15 fps, and bounds decoder/filter/encoder threads for the half-CPU production task. Compression subprocesses are killed/reaped on timeout or cancellation. Durable RedNote imports use a seven-minute account/global admission deadline. Production sets `GEMINI_TIMEOUT_SECONDS=120`, clamped to the remaining admission deadline; other AI operations retain the existing 85-second overall deadline, monetary limits and quotas. No schema change is required.

## Deployment (last recorded production context)

The October 1 bookmark-toggle release uses application source `477bca35d8ab69e7808a42fff96bb489ddd40e5e` as API `cooking-backend:43` (`sha256:2b33a7e7d31cb902225b7c62bc80d77727cb50cf86a9f670c16bc5b7a2a84e59`) and Vercel `dpl_4EQ56Hyv3KLdT4bgvnyYJVqXyc7b`, READY on both Chef World domains. Public Library bookmarks save, remove and restore the same edited recipe; removal preserves published sources and meal-plan/cooking references. The current shopping-refinement backend is preserved. All 290 uploaded website files match committed source; 1,615 backend tests, 860 web tests, the production build, fresh UID1001 image with 22 authenticated disposable HTTP checks, and six local/candidate/live EN/ZH fixture cases each passed. Migration/rollout, old-server retirement, health/readiness/auth/CORS, configuration/retailer-worker preservation, public page/assets and bounded logs passed. No production recipe mutation, paid provider task or native release occurred. Rollbacks are API42 and `dpl_7zo588ZExje354MF78Nk7RcgwSLQ`; see [bookmark toggle QA](docs/qa/2026-10-01-public-library-bookmark-toggle.md).

The October 1 Public Library bookmark release uses application source `84796fa13c3e6cd55d67d9ae2c110df1114f501d` as Vercel `dpl_7zo588ZExje354MF78Nk7RcgwSLQ`, READY on both Chef World domains. Public grid cards replace repeated library button rows with accessible photo-corner bookmarks and one English/Chinese hint. All 290 uploaded files match committed source; 856 web tests, local/remote production builds, six candidate and six live fixture cases, 80 public requests, and a real signed-in read passed. The bounded five-minute website error scan was empty. The shopping guide/source-link editor are preserved. No backend/native release, provider task, production recipe copy, or cart write occurred. Rollback is `dpl_ACp7BxcHJxfTdvKeSQ119r39SueK`; see [the bookmark release verification](docs/qa/2026-10-01-public-library-bookmarks.md).

The October 1 smart shopping guide website release is deployed from application source `737553f5163e0ff2ccc2b6dee58ad7328198dba1` as Vercel `dpl_ACp7BxcHJxfTdvKeSQ119r39SueK`, READY on both Chef World domains. It preserves the production recipe source-link editor and shopping progress while adding English/Chinese instructions for checking pantry items, choosing Weee products, and copying/pasting a reviewed Muse request. All 289 uploaded files match committed source; 854 web tests, both production builds, 18 fixture browser cases across local/candidate/live and 44 public requests passed. The bounded website error scan was empty. No backend or retailer cart writes were performed. See [the release verification](docs/qa/2026-10-01-smart-shopping-guide-release.md).

The September 30 UTC RedNote/YouTube import release uses backend application source `bef00f31f07d6708675458abd449bcf17b1c92ba`, API `cooking-backend:38` and image `sha256:96d4ef01f52afd4b1e32ab5e2c109f7810fe734d3dbbf30f70681a6b226e96ec`. Website application source `893238e3435390c6a646b7543a25fec6aa456d10` is Vercel `dpl_Ev9vmCDkBfEwNLAmyZ2RT6k7EiiP`, READY on both Chef World domains. Later source commits changed backend preparation/diagnostics and browser test helpers; website application code did not change. Public imports accept only YouTube and RedNote, including copied share text, and reject TikTok/Douyin. Anonymous RedNote retrieval adds no paid downloader or personal cookies. Retailer worker `cooking-store-worker:2` is unchanged.

Full final backend tests passed (1,576 passed, 6 skipped), independent focused review passed 29, and fresh-image desktop/phone browser cases passed 20/20. Fresh backend/web images, the exact non-root AWS backend runtime, locked migration, exact digest/revision, health/readiness/auth/CORS and configuration preservation passed. Revision38 reuses that immutable image with only the Gemini timeout raised from 35 to 120 seconds; service configuration, other AI overall deadlines, monetary limits and quotas are preserved. All 1,054 uploaded website source files matched the committed release. After all earlier API workers stopped, a temporary private account exercised the real public login/import/poll workflow and received a 15-ingredient/15-step RedNote draft within 194 seconds; no library recipe was saved and the account was removed. The earlier signed-in browser test also reached editable review. See [RedNote/YouTube release QA](docs/qa/2026-09-30-rednote-youtube-import-release.md) for the separate real-provider result, retired-worker gate, exact evidence and limitations. No native binary or OTA update was published. API rollback is revision37 with the same image and previous 35-second timeout; website rollback is `dpl_7hkpveh1BJuFHRXiAfKjEy9bPVBc`. Recheck live state before another release. A later documentation-only commit does not change the deployed application source.

The later September 30 admin AI budget hotfix is deployed from backend application source `f56f0ad9add845eeaad120b8c8bbf91a0937bf5e` as API `cooking-backend:40` at `sha256:e0c4af80834ee62ce1c92b96ce4bdea13886c4c3fe726447f9e0526c4f78d90c`. Trusted admins use the remaining shared USD 29 monthly AI budget for metered text/video calls, matching the existing image policy; ordinary accounts retain USD 3. Unknown reservations, ledger balances, all other operational guards and the retailer worker are preserved. Revision 39 was a temporary USD 4 allowance-only release; revision 40 restores the ordinary USD 3 cap and applies the trusted-admin policy. Full backend tests passed 1,581 with 6 skips, fresh backend/web image and exact published-image runtime checks passed, and locked migration, completed rollout, retired-worker gate and production HTTP/log checks passed. The existing signed-in admin account successfully imported its YouTube video into a 15-ingredient/11-step review draft, with no recipe saved. Website runtime inputs are unchanged and no website/native deployment was made for this hotfix. See [admin AI budget hotfix QA](docs/qa/2026-09-30-admin-ai-budget-hotfix.md). A later documentation-only commit does not change deployed application source.

The following September 29 entry is retained as historical context.

The September 29 beta UI polish website is deployed from application source `2edf8d75ecfe1b66a39335a2ef9e25fdf8a9f609` as Vercel `dpl_7hkpveh1BJuFHRXiAfKjEy9bPVBc` on both Chef World domains. All 294 uploaded files matched the committed source. Local web/shared tests passed (842/392); the hosted suite passed 252 initially with one sharing-navigation failure, then both affected sharing cases passed all six focused desktop/tablet/phone rechecks without browser errors. Post-promotion checks passed 28 routes and 92 assets, matching desktop headers, and 320/390px Chromium/WebKit fixture flows. Separately, the real signed-in Chrome session confirmed the live Upload video control and 30 MB limit in desktop/phone layouts, and the real API returned `video_analysis: true`, `media_upload: true`, `max_media_bytes: 31457280`. The bounded post-release runtime/error and HTTP 5xx scans were empty. Website rollback is `dpl_CbYEXheXbCWHEpGPqeZEMqkXXC67`. No backend/native release was performed. Sanitized receipts are under `/private/tmp/chef-ui-polish-release-20260929`; fixture UI tests do not claim paid AI provider execution.

The following September 28 entry is retained as historical context.

The September 28 website-beta release uses backend/frontend application source `b6e596d2248168d09d4ba802c4bb26afee696699`. Verified production identities are API `cooking-backend:31` at `sha256:ae421f8ce75fa87c5c9427facbd6775bc67cd2980306b8c0a687bcec47e1dd5b` and Vercel `dpl_Ciwo5jxo2MAPdGX7ujnuyXBo5NSe`, READY on both `chef-world.com` and `www.chef-world.com`. Worker `cooking-store-worker:2` and API task/container/service configuration fingerprints are unchanged. The integrated source preserves the live salt correction and prior menu, import, homepage, navigation and retailer behavior, and adds the five website audit fixes plus honest shopping fallback/retry with quantity and progress preservation.

Fresh backend/frontend images and actual non-root image runtime checks passed. Locked migration, exact revision/digest, readiness/auth/CORS, configuration preservation and bounded API/worker logs passed. All 282 Vercel uploaded source files matched the approved source; candidate rendering checked desktop/phone homepage and 320/390 px shopping fallback, Muse export, retry and progress preservation using synthetic API fixtures. Two earlier bounded real-provider refinement checks passed without production data writes. Public checks passed 162 page/asset requests across both domains and five direct-public browser cases; bounded post-promotion logs returned no errors or HTTP 5xx. See [website beta release QA](docs/qa/2026-09-28-beta-release.md) for public verification, exact evidence windows and limitations. No native binary or OTA update was published. Rollback references are API30 and `dpl_AjEhB4aaBLHGmdodJJHzcVfaG6US`; recheck live state before another release. The later deployment-helper/documentation commit does not change the deployed application source.

The user's typical local dev loop:

```bash
docker compose down && docker compose up --build -d   # then open http://localhost:3000
```

### Frontend — Vercel

- Project hosts both `chef-world.com` and `www.chef-world.com` plus the auto preview URL `cook-lake-alpha.vercel.app`.
- **Vercel project setting *Root Directory* = empty.** The whole build runs from the repo root.
- **Repo-root `vercel.json`** is the single source of truth:
  - `framework: "nextjs"`
  - `installCommand: "npx --yes npm@11.19.1 ci --no-audit --no-fund --workspace=@cooking/web --include-workspace-root"` — uses the lockfile and the enforced npm version so workspace security overrides are respected. The workspace flags install the web app and root tooling; mobile is built separately with Expo. Dependency audits run as a separate CI gate and retain their reports.
  - `buildCommand: "npm --workspace @cooking/web run build"` — runs `next build` inside the `@cooking/web` workspace.
  - `outputDirectory: "apps/web/.next"` — relative to the repo root.
- **Repo-root `package.json` lists `next` as a `devDependency`.** This is required: Vercel's framework detector reads the project's root `package.json` (regardless of Root Directory) and refuses to deploy without seeing `"next"` listed. The version must match what `apps/web/package.json` declares. When upgrading Next, update both files.
- **All Build & Development Settings overrides in the dashboard must be OFF.** `vercel.json` is the source of truth. Dashboard overrides layer on top of Vercel's default install pass and reintroduce the idealTree collision.
- **Web uses React/React DOM 19.1.5; mobile retains React 19.1.0 for Expo SDK 54.** Root and web React type packages use the 19.1 line. Keep platform resolution isolated: Metro must use the mobile React installation, and web compilation must resolve compatible React/DOM types. Verify both application type checks, the web production build and a native JavaScript bundle after dependency changes.
- Production env vars (Vercel → Settings → Environment Variables → Production):
  - `NEXT_PUBLIC_API_BASE = https://api.chef-world.com` (so the browser calls the ECS backend, not localhost).
- History notes (don't repeat these mistakes):
  - Root Directory used to read `frontend/` from before the monorepo split, which broke every deploy with `The specified Root Directory "frontend" does not exist`.
  - Setting Root Directory to `apps/web` *seems* logical but doesn't help: Vercel still reads the repo-root `package.json` for its Next.js version check, and we can't reach a clean configuration from there without a dashboard install-command override that hits idealTree collisions. Root Directory must be empty.
  - `framework: "nextjs"` in `vercel.json` does **not** bypass the version-detection check; it only pins the framework choice. The check still requires `next` in the project's root `package.json`.

### Backend — AWS ECS

- Optional Instacart setup (not yet deployed/configured): backend-only `INSTACART_API_KEY` plus `INSTACART_ENVIRONMENT=development|production` (defaults to development). Missing or rejected credentials return a clear 503 setup-required response; there is no sample-link fallback. Production keys require Instacart approval. Local Compose already loads these through `backend/.env`. See `docs/qa/2026-09-14-instacart-setup.md`.

- Cluster: `cooking-cluster`. See the recorded production context above for the latest verified release. The deployment script registers a new revision for each immutable image release.
- Image: built from `backend/Dockerfile` (Python 3.12 slim + Playwright Chromium). Listens on `:8000`.
- Public hostname: `https://api.chef-world.com` (fronted by ALB / domain mapping outside this repo).
- Production env vars (live in the ECS task definition, **not** in the repo):
  - `AUTH_SECRET=<long random string>`
  - `AWS_REGION=us-east-1`
  - `S3_BUCKET_NAME=cooking-images-930067562682`
  - `DATABASE_URL=postgresql+asyncpg://cooking:<url-encoded-password>@cooking-db.co944gii0fur.us-east-1.rds.amazonaws.com:5432/postgres` — note the `%` in the password is URL-encoded as `%25` in the actual env value (Alembic and asyncpg both fail otherwise; see commit `ea811a6`).
  - `CORS_ALLOW_ORIGINS=http://localhost:3000,https://cook-lake-alpha.vercel.app,https://chef-world.com,https://www.chef-world.com`
  - Historical cookie settings: `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`. HTTPS `chef-world.com` and `api.chef-world.com` are different origins but the same site; subdomains alone do not require `SameSite=None`. Review the actual frontend/API deployment relationship. Truly cross-site cookies need `SameSite=None; Secure`, and cross-origin browser requests still need explicit credentialed CORS. Production requires secure cookies.
  - `OPENAI_API_KEY=<real key>` — set in the ECS task def env (not in this repo). When unset/empty, text extraction reports HTTP 503; shopping refinement and tutorial metadata can use local conservative fallbacks. Production credentials must be supplied outside the image.
  - Optional video/media analysis requires server-side `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.5-flash-lite`, matching `GEMINI_PRICE_MODEL`, a nonempty reviewed `GEMINI_PRICE_VERSION`, and positive `GEMINI_INPUT_USD_PER_MILLION_TOKENS` / `GEMINI_OUTPUT_USD_PER_MILLION_TOKENS`. The current code accepts only that reviewed model and rate floors of USD 0.30 input / USD 2.50 output per million tokens, including thinking output; recheck current provider pricing before activation. `GEMINI_TIMEOUT_SECONDS=35` and `GEMINI_MAX_OUTPUT_TOKENS=8000` are defaults. Missing key or pricing disables the capability; configuration is not a live provider health check. Gemini shares `AI_MONTHLY_BUDGET_USD`, `AI_ACCOUNT_MONTHLY_BUDGET_USD`, and the existing USD 30 modeled global hard cap with OpenAI. These credentials/settings belong on the API service, whose import workers perform analysis; the separate retailer worker does not need AI access.
- Database: AWS RDS Postgres at `cooking-db.co944gii0fur.us-east-1.rds.amazonaws.com:5432`, database `postgres`, user `cooking`. `DATABASE_SSL=true` is enabled in production with the bundled regional RDS CA certificate.
- Image storage: S3 bucket `cooking-images-930067562682` in `us-east-1`. New recipe uploads are validated by the backend and stored as exactly those bytes under an account-prefixed key when both storage settings are configured. Both storage modes return `upload_url: ""` and `file_url`.
- Migrations: `python -m app.migrate` runs as a bounded, PostgreSQL-locked release task using the same immutable image before API service update. API/worker startup never migrates. The additive beta/analytics merge revision preserves the deployed analytics schema and tracking history while applying the beta migrations. Non-root containers require the uploads bind mount to be writable by UID 1001. Production also requires a separate Linux durable worker, verified `TRUSTED_PROXY_CIDRS`, and explicitly priced AI allocation; see `docs/capacity-operations.md` before deploying.

**Deploy procedure (single script):**

`TASK_ENV_OVERRIDES_FILE=/absolute/private/path.json` optionally supplies a JSON object of environment names and string values. The script validates and privately snapshots it before building, rejects names conflicting with ECS secret references, and merges it into the selected container in the same revision as the new image. Use this for approved administrator IDs and production settings; keep the file outside the repository and never print its contents. Existing values, other containers, and tags are preserved.

```bash
bash scripts/deploy-backend.sh
```

What it does: refuse uncommitted backend/release inputs → archive committed backend source into a private temporary context while preserving tracked read/search modes for the non-root runtime → build/push `:<full-git-sha>` → read the exact image digest from build metadata → verify the service revision is unchanged → register a task revision using `image@sha256:...` → run and verify its one-off migration task → recheck service identity → update the service → verify the requested deployment ID, task revision, running image digest, `/ready` and HTTP probes. A stable service following an automatic rollback is treated as failure. The AWS account comes from the active CLI identity unless explicitly configured. Temporary task definitions may contain secrets, so they are private, never printed and removed on exit. No `:latest` tag is modified. Serialize production deployment jobs because ECS has no conditional service-update operation. Run only when deployment is explicitly intended.

**Recovery and alerting (verified September 29, 2026 UTC):** RDS `cooking-db` has automated backup retention 7 days and deletion protection enabled, independently read back as available with no pending modifications. The dedicated `chef-world-ops-alerts` SNS topic and six metric alarms cover API readiness, combined ALB/target 5xx, API memory, worker memory/metric absence, DB free storage and DB CPU/metric absence. Notification actions remain disabled pending a designated confirmed operator subscription and actual alarm/recovery inbox delivery. Account-mail feedback resources were preserved. `scripts/prepare-recovery-alerts.py` produces guarded offline request bodies only; it never calls AWS or applies changes. Standard ECS metrics avoid paid Container Insights, but worker presence does not prove queue progress. Image S3 versioning/lifecycle/replication are not configured; DB backup alone cannot recover deleted image bytes. See `docs/recovery-alerts.md` for exact thresholds, cost assumptions, delivery drill and the not-yet-executed private restore rehearsal.

**Rollback:** the script reports the previous task-definition ARN. Deliberately restore that revision with ECS, wait for stability, and verify its expected image digest and HTTP behavior. Database migrations must remain backward compatible with the previous revision; image rollback does not reverse data changes.

**Deploy order when a feature spans backend + web** (e.g., friend-library, future similar features): deploy backend FIRST (`scripts/deploy-backend.sh`), verify the new route returns `401` not `404` against `https://api.chef-world.com`, THEN merge the feature branch to `main` (which auto-triggers Vercel). Reversed order ships web UI hitting 404s on prod backend.

### Local Docker stack

`docker-compose.yml` brings up Postgres + a one-shot locked migration + backend + web; the backend waits for migration success. Backend `.env` is loaded via `env_file: backend/.env`, but local compose-level overrides force `DATABASE_URL`, `DATABASE_SSL=false`, and a localhost CORS list. The web container is built with `NEXT_PUBLIC_API_BASE=http://localhost:8000` so the browser still talks to the host-published port. `./backend/uploads` is bind-mounted into `/app/uploads` so locally-uploaded recipe images survive container rebuilds (matters when `S3_BUCKET_NAME` is not set in local `backend/.env`).

### iOS — EAS Build

- App is published as `Chef World` (`apps/mobile/app.json::expo.name`). Bundle identifier: `com.chefworld.cooking` (iOS + Android). Deep-link scheme: `cooking://`.
- **Expo SDK 54** (`expo@^54.0.0`, `react@19.1.0`, `react-native@0.81.5`). New Architecture is enabled. Cooking alerts/wake use SDK-matched `expo-notifications@~0.32.17` (also in `app.json::plugins`) and `expo-keep-awake@~15.0.8`.
- The “Import to Chef World” iOS Share Sheet is supplied by `expo-share-intent`. It is a native extension target: Expo Go cannot contain or test it. Use a custom development client, internal EAS build, or production build. Manual pasted-link import remains available without the extension and is the Android path (`disableAndroid: true` in the plugin config).
- Build profiles live in `apps/mobile/eas.json`:
  - `development` — dev client + simulator. `EXPO_PUBLIC_API_BASE=http://localhost:8000`. Use this for day-to-day iteration.
  - `preview` — internal-distribution build pointed at production API (`https://api.chef-world.com`). No dedicated staging environment exists yet; revisit `eas.json` when one does.
  - `production` — store-bound build. `autoIncrement: true` so EAS owns build numbers (matches `appVersionSource: "remote"`).
- Submit profile (`eas.json::submit.production.ios`) has placeholder `appleId` / `ascAppId` / `appleTeamId` — fill in before the first `eas submit -p ios`.
- One-time prerequisites:
  ```bash
  npm i -g eas-cli            # only if you don't already have it
  eas login                   # interactive Expo account login
  eas build:configure         # creates the project ID on Expo's side (only once)
  ```
- Typical flow:
  ```bash
  cd apps/mobile
  eas build --profile development --platform ios   # custom dev client; current profile targets simulator
  eas build --profile preview --platform ios       # shareable internal build
  eas build --profile production --platform ios && eas submit -p ios
  npx expo start --dev-client                       # Metro for an installed custom client
  ```
- Real-device dev: set `EXPO_PUBLIC_API_BASE=http://<lan-ip>:8000` in your shell before `expo start --dev-client` (the `localhost` default resolves to the phone itself, not your machine).

#### Running the dev client locally — gotchas worth remembering

Three things will eat hours if you don't know them up front. The simulator's redbox error message is misleading in two of these cases ("Could not connect to development server" when Metro is actually fine).

1. **Backend must be running first.** The dev client hits `http://localhost:8000` by default (`apps/mobile/src/config.ts::getApiBase`). Without `docker compose up --build -d` from the repo root, every API call returns "Network request failed" — the simulator boots fine but login fails immediately. Easy to forget after a fresh laptop reboot. Verify with `curl http://localhost:8000/health`.

2. **Hotspot / "constrained" network interfaces blackhole the bundle.** When the Mac's active interface is on a phone hotspot (typically `172.20.10.x`, marked `flags=…constrained` in `ifconfig`), Expo prints `exp://<hotspot-ip>:8081` on startup and the simulator's bundle fetch silently times out at 30s. Metro is healthy (`curl http://localhost:8081/status` returns 200), but the simulator can't reach the hotspot IP. Fix:
   ```bash
   cd apps/mobile
   REACT_NATIVE_PACKAGER_HOSTNAME=localhost npx expo start --ios --clear
   ```
   Forces Metro's bundle URL to `http://localhost:8081/...`. The simulator can always reach `localhost`.

3. **Don't run `npm run mobile:ios -- --clear` from the repo root.** npm strips the `--clear` flag with an `Unknown cli config "--clear"` warning, so Metro starts with a stale Babel cache. The worklets plugin (`react-native-worklets/plugin`, used by Reanimated 4) needs the cache cleared on fresh installs (otherwise you'll get cryptic "Reanimated is not configured properly" failures). Run the expo CLI directly:
   ```bash
   cd apps/mobile && npx expo start --ios --clear
   ```

If you see the "Could not connect" redbox, check in this order: is `curl http://localhost:8081/status` returning 200 (Metro alive)? is the bundle URL on-screen using `localhost` and not a hotspot IP (gotcha #2)? did the bundle compile finish (look for `Bundled <ms> apps/mobile/index.js (N modules)` in Metro stdout)? If Metro alive + URL is localhost + bundle never compiles, suspect a workspace resolution failure — `apps/mobile/metro.config.js` must be present (see "Cross-package imports" below).

## Commands

### Web / mobile (run from repo root)

Use Node 22 (at least 22.9) and npm 11.19.1. `packageManager`, `engines`, and `.npmrc` enforce the installer version; CI and Docker use the same version. The `npx` install below does not change the host's global npm. See [dependency verification](docs/qa/2026-09-15-dependency-audit.md) for the workspace override regression and remaining advisories.

```bash
npx --yes npm@11.19.1 ci    # installs all workspaces from the committed lockfile
npm run web:dev            # next dev on :3000
npm run web:build
npm run web:start
npm run web:lint           # legacy interactive Next lint setup; no ESLint config is committed
npm run mobile:start       # expo start
npm run mobile:ios         # expo start --ios
npm run mobile:android
npm run test:web          # web Vitest suite
npm run test:mobile       # mobile Jest suite
npm run test:shared       # shared domain and API-client suites
npm --workspace @cooking/web run test:e2e  # web Playwright suite (starts Next dev)
npm --workspace @cooking/web run test:e2e -- import.spec.ts
npx tsc -p apps/web/tsconfig.json --noEmit
npx tsc -p apps/mobile/tsconfig.json --noEmit
cd apps/mobile && npx expo config --type prebuild   # resolve native plugin config without generating ios/android
```

The web unit suite uses Vitest, native mobile uses Jest/RNTL, browser flows use Playwright, and the backend uses pytest. A focused test can be passed after `--`, for example `npm --workspace @cooking/web test -- StepListEditor.test.tsx` or `npm --workspace @cooking/web run test:e2e -- tutorial.spec.ts`.

### Backend (run from `backend/`)

Requires Python 3.11, 3.12, or 3.13 (3.14 is not supported — pydantic-core Rust bindings).

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
playwright install chromium    # store scraper uses Playwright

cp .env.example .env
# Required: DATABASE_URL (postgresql+asyncpg://...), AUTH_SECRET (random, ≥32 chars for production).
# Optional: OPENAI_API_KEY, reviewed GEMINI_* configuration, AWS_REGION+S3_BUCKET_NAME, COOKIE_SECURE/SAMESITE, ADMIN_USER_IDS, PUBLIC_LIBRARY_EDITOR_USER_IDS.

python -m app.migrate          # serialized, bounded release migration
python run.py                  # uvicorn on :8000 with reload
.venv/bin/python -m pytest -q  # full backend pytest suite
```

`AUTH_SECRET` must be a random value of at least 32 characters in production, enforced at startup. Development authentication also rejects values shorter than 16 characters. The `.env.example` placeholder must be replaced.

`DATABASE_URL` must be `postgresql+asyncpg://...`; startup hard-fails on SQLite or missing URL (`backend/app/core/config.py::Settings.require_postgres`). Special characters in the password (notably `%`) must be URL-encoded.

The current head is `20260924_video_import`, following `20260924_email_onboarding`. It adds `recipe_import_jobs` and allows `cooking_session_steps.duration_seconds=NULL` only with `duration_source='unknown'`; existing numeric timings are preserved. Downgrade refuses while untimed session rows exist rather than inventing replacement times. Apply the migration before the new API/clients. `20260924_email_onboarding` adds the new-account verification flag with a false default for existing accounts and follows `20260924_beta_analytics_merge`, joining deployed `20260924_analytics` and the beta chain: `20260914_ai_usage` → `20260918_recipe_pages` → `20260918_ai_cost` → `20260918_jobs` → `20260918_request_limits` → `20260918_plan_revision` → `20260918_upload_budget` → `20260922_store_waiters` → `20260922_account_lifecycle`. The earlier hardening revision `20260914_ai_usage` follows `20260827_cook_sess` (earlier tail: `20260510_user_lib` → `20260514_recipe_tut` → `20260825_step_meta` → `20260827_cook_sess`; see `backend/alembic/versions/`). `20260825_step_meta` backfills JSON tutorial steps; `20260827_cook_sess` adds normalized session, dish-snapshot, step-state, and mutation-idempotency tables. New revisions: `alembic revision -m "msg"` then edit the generated file.

### Docker

```bash
docker compose up --build              # postgres + one-shot migration + backend + web
./scripts/docker-up.sh                 # same, but retries on Docker Hub 502s
```

The web Dockerfile’s build context is the **repo root** (it needs `packages/`), not `apps/web`. The `./backend/uploads` host dir is bind-mounted to `/app/uploads` for local image persistence when S3 is unset. Backend image installs Playwright Chromium with `--with-deps` (large; expect long first build).

### One-off scripts

```bash
python scripts/precompute_store_products.py          # warms persistent store-product cache
python scripts/cleanup_bad_store_cache_queries.py    # deletes cache rows containing 新鲜 / 切块
# Friend-library end-to-end smoke (requires jq + 2 test accounts):
JD_EMAIL=jd@gmail.com BOB_EMAIL=bob+test@example.com \
  bash backend/scripts/smoke_friend_library.sh <jd-pw> <bob-pw>
```

## API surface (current)

Mounted in `backend/app/main.py`. Protected routes use `get_current_user`. Public routes include `/auth/{register,login,logout,capabilities}`, password-reset request/confirm and email-verification confirm, `/health`, `/ready`, and `/uploads/*`. Public account mutations still have origin/body/admission protections; verification request, logout-all and account deletion require authentication.

| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/register` | Creates a verification-required account, commits its first link before requesting email, sets HttpOnly cookie and returns `access_token` plus verification flags. Unconfigured email returns 503 before creating an account. 8-char min password. |
| POST | `/auth/login` | Same |
| POST | `/auth/logout` | Revokes the presented token (including legacy tokens), then clears cookie |
| GET | `/auth/me` | Returns `{id, email, is_library_public, is_admin, email_verified, email_verification_required}` |
| GET | `/auth/capabilities` | `{password_recovery, email_verification}`; false until email is configured |
| POST | `/auth/password-reset/request` | `{email}`; generic `{ok:true}` for configured delivery, uniform 503 when unavailable |
| POST | `/auth/password-reset/confirm` | `{token,password}`; consumes expiring link once, revokes prior sessions/links; no automatic login |
| POST | `/auth/email-verification/request` | Authenticated; requests a replacement verification link |
| POST | `/auth/email-verification/confirm` | `{token}`; consumes expiring verification link once |
| POST | `/auth/logout-all` | Authenticated; increments account session generation and clears cookie |
| DELETE | `/auth/account` | Authenticated `{password}`; wrong password 403; atomically deletes owned relational data and admits image cleanup |
| POST | `/auth/library-visibility` | Body `{is_public: bool}`. Flips current user's library-sharing flag. Returns `{is_library_public: bool}` |
| GET | `/recipes/import-capabilities` | Authenticated `{video_analysis,media_upload,max_media_bytes}` configuration capabilities; clients hide unavailable media controls |
| POST | `/recipes/import-jobs` | 202; queue a draft import with `mode: link\|text\|video`, `url`/`source_url`, `transcript`, optional notes/title/tags; no recipe save |
| POST | `/recipes/import-jobs/media` | 202; multipart `file` plus optional notes/title/source_url and JSON-array `library_tags`; supported audio/video containers up to 30 MiB |
| GET | `/recipes/import-jobs/{id}` | Account-owned `{id,status,recipe,error}`; status is queued/processing/completed/failed/cancelled; missing/expired IDs return 404 |
| DELETE | `/recipes/import-jobs/{id}` | Cancel an account-owned job and clear retained draft/input/media |
| POST | `/recipes/parse/link` | Retained synchronous compatibility route; public YouTube/RedNote draft, optional configured YouTube audiovisual fallback or `analyze_video=true`; no recipe save |
| POST | `/recipes/parse/transcript` | Retained synchronous compatibility route; pasted text draft, optional original `source_url`; no recipe save |
| POST | `/recipes/upload-image` | Multipart, 10 MB/signature-checked. Backend stores exact bytes in S3 or local disk; `{upload_url:"",file_url}` |
| GET | `/recipes` | **Deprecated compatibility array**: complete owned recipes; older released clients remain supported without silent truncation |
| GET | `/recipes/page` | Bounded owned summary page (`limit` default 40, maximum 100; `cursor`, title substring `q`, repeated AND `tags`) |
| POST | `/recipes` | Saves reviewed import or manually entered recipe; no parse/provider call |
| GET | `/recipes/{id}` | |
| PATCH | `/recipes/{id}` | Partial update of `title`, `source_url` (safe HTTP(S), max 4096; null clears), `thumbnail_url`, `ingredients`, `library_tags`, `description`, `total_time_minutes`, `steps`, `tips`, `equipment` |
| POST | `/recipes/{id}/tutorial/estimate` | Owned-recipe check plus preview-only enrichment of submitted `{steps}`. Returns `{steps}` without saving; only a later `PATCH /recipes/{id}` persists the user's draft. |
| DELETE | `/recipes/{id}` | 204 |
| GET | `/recipes/catalog` | **Deprecated compatibility array**: complete public catalog |
| GET | `/recipes/catalog/page` | Bounded public summary page; same query contract; `already_saved` scoped to caller |
| GET | `/recipes/catalog/editor-status` | `{ can_manage: bool }` based on explicit account-ID permissions |
| POST | `/recipes/catalog/{id}/copy` | Clone a public recipe into the caller's library (idempotent via `catalog_source_recipe_id`) |
| POST | `/recipes/{id}/catalog` | `{ is_public: bool }` — toggle catalog visibility (editor-only) |
| GET | `/users/search?email=` | Exact email match. 200 with `{id, email, is_library_public}` only when target's library is public AND not the caller. 404 otherwise (uniform — no enumeration leak). |
| GET | `/users/{user_id}/recipes` | **Deprecated compatibility array**: complete friend library when public and not self; 404 otherwise |
| GET | `/users/{user_id}/recipes/page` | Bounded friend summary page; sharing checked on every page; same filters/cursor contract |
| GET | `/users/{user_id}/recipes/{recipe_id}` | Friend recipe detail on demand, with caller-scoped `already_saved`; private import text omitted |
| POST | `/users/{user_id}/recipes/{recipe_id}/copy` | Idempotent clone into the caller's library. Sets `catalog_source_recipe_id` on the new row. |
| GET | `/meal-plan?start=&end=` | Inclusive YYYY-MM-DD range, maximum 31 days; each stored day includes `revision` |
| PUT | `/meal-plan/{date}` | Slot arrays (maximum 100 IDs each) plus `expected_revision`; stale writes return 409. Legacy `recipe_ids` and omitted revisions remain deprecated compatibility paths |
| GET | `/cooking-session/active` | Current user's canonical active snapshot or `null`; persists elapsed running timers as `needs_attention` without completing them |
| POST | `/cooking-session` | Body `{recipe_ids}`. Snapshots owned recipes; 409 `active_session_exists` when the account already has a session |
| POST | `/cooking-session/{id}/dishes` | Add owned recipe snapshots to the active session |
| DELETE | `/cooking-session/{id}/dishes/{dish_id}` | Remove a dish; removing the final dish discards the session |
| POST | `/cooking-session/{id}/steps/{step_id}/actions` | Idempotent revision-checked transition: start/pause/resume/extend timer, complete, skip, reopen, or take alert ownership |
| POST | `/cooking-session/{id}/finish` | Deletes an all-resolved session; unresolved work returns 409 `session_not_complete` |
| DELETE | `/cooking-session/{id}` | Explicitly discard the active session |
| GET | `/shopping-list?start=&end=` | Aggregates ingredients across week's meal plans |
| POST | `/shopping-list/instacart` | Authenticated stateless export `{title, items:[{name,quantity}]}` → `{url}` via official Instacart API. 1–100 items; title ≤120 chars, names/quantities ≤200. Typed setup/provider/timeout/rate-limit failures; no cart writes or checkout. |
| POST | `/shopping-list/refine` | LLM grocery list. Stateless. Body `{items: [{name,quantity}]}`. Returns `{remove: [], likely_pantry: [], purchase_items: [...], refinement_status: "refined"|"fallback"}` — `remove`/`likely_pantry` are always empty (legacy contract; staples come back inside `purchase_items` with `category: "Pantry & Dry Goods"`) |
| GET | `/store-products?query=` | Cache-or-live lookup. Omitted `store` returns `{products, expires_at, server_time}`; explicit legacy `store=weee` returns `StoreProduct[]`; Amazon/unknown return 400 before lookup. Confirmed no-results is 200; exhausted transient scraping is typed 503 with `Retry-After: 3`. |
| POST | `/store-products/batch` | Body `{queries: string[]}`: at most 100 queries, 512 characters each. Returns `{entries, server_time}` with cache-only L1/L2 `fresh`/`missing` entries preserving cleaned unique order; never starts Playwright. Shared HTTP admission applies. |
| GET | `/admin/cache-preview` | Paginated cached rows, warm-set classification |
| POST | `/admin/cache-refresh` | `{stale_only: bool}` — kicks the warmer task |
| GET | `/admin/cache-refresh-status` | Background task progress |
| POST | `/admin/cache-refresh-one` | Force-refresh a single (query, store) row |
| GET | `/menus/access` | Daily menu creation allowance; admin exemption and UTC reset |
| POST | `/menus/creations` | Admit one owner-scoped menu session, idempotently |
| POST | `/menus/designs` | One explicit, budgeted design proposal for an admitted owned menu session |
| GET | `/menus/recipe-images/{recipe_id}` | Bounded bytes from a current owned recipe and active owned-image receipt |
| GET | `/menus/artwork/access` | Existing image access policy for menu decoration |
| POST | `/menus/artwork` | Generate an explicitly accepted portrait artwork candidate |
| GET | `/menus/artwork/{request_id}` | Recover this account's menu artwork result |
| GET | `/menus/artwork/{request_id}/file` | Return bounded authenticated PNG bytes |
| GET | `/recipes/image-generation/access` | Authenticated image access, daily allowance and UTC reset |
| POST | `/recipes/generate-image` | Durable, idempotent AI cover preview; never saves the recipe |
| GET | `/recipes/image-generation/{request_id}` | Recover an owned image-generation request |
| GET | `/admin/ai-costs` | UTC-month recorded AI estimates, tokens, outcomes, reservations and coverage |
| GET | `/admin/infrastructure-costs` | Cached AWS account-wide month-to-date estimated costs and service breakdown |
| GET | `/admin/ai-usage` | UTC-month modeled costs/reservations, tokens and bounded account page |
| GET | `/admin/operating-limits` | Configured cost/AI/upload/job ceilings and cumulative upload reservations; not billing verification |
| GET | `/ready` | 200 when required schema/database available; bounded 503 otherwise |
| GET | `/health` | `{status:"ok"}` |
| GET | `/uploads/...` | Static files from `LOCAL_IMAGE_UPLOAD_DIR` (default `<cwd>/uploads`) |

| POST | `/analytics/events` | Allowlisted page views and retailer handoffs; server derives optional account identity |
| GET | `/admin/analytics/overview` | UTC 1–90-day audience, acquisition, activation, and retention reports |
| GET | `/admin/analytics/users` | Paginated email search, roles, tracked logins, current inventory |
| GET | `/admin/analytics/users.csv` | Private, formula-safe export; maximum 10,000 accounts |
| GET | `/admin/analytics/users/{id}` | Account details and latest 50 events in the selected range |
| PATCH | `/admin/analytics/users/{id}/test-status` | Set traction exclusion without changing permissions |

Analytics requires migration `20260924_analytics` before deploying its backend. Successful auth/product operations are recorded after business transactions complete, in an independent bounded transaction. Browser navigation captures allowlisted paths, coarse device/browser, domain-only referrers, and short campaign identifiers. DNT/GPC disables browser collection and browser attribution. Server-confirmed operational events remain recorded. No polling becomes activity. Raw events retain 90 days, non-identifying daily totals 13 months, and account milestones survive raw pruning until account deletion. The hourly maintenance job uses an advisory lock and bounded deletion batches. Report SQL has a five-second statement timeout; collection has a 1.5-second deadline. Current reporting reads indexed raw data for exact distinct-user ranges; daily totals are retained for future aggregate-only historical reporting. Collection error counts are process-local diagnostics and reset on restart. Reports label missing/partial coverage and exclude configured admin/test accounts by default; directory/export include every account. Anonymous browser traffic is observational and cannot prove unique people, orders, or revenue.

Admin endpoints are gated by `is_admin()` in `backend/app/core/admin.py` using `ADMIN_USER_IDS` (verified account UUIDs). Auth responses include `is_admin`; the web uses this server-provided capability. Empty configuration grants nobody access, and claiming an email never grants privileges.

## Architecture notes that aren’t obvious from a single file

### Two auth modes share one API

`backend/app/api/auth.py::get_authenticated_user` accepts **either** an `Authorization: Bearer` header (mobile) **or** the `access_token` HttpOnly cookie (web), validating identity and session revocation. `get_current_user` additionally rejects verification-required, unverified accounts with HTTP 403 and code `email_verification_required`. App endpoints use this guard; account status, verification requests, sign-out-everywhere and deletion remain reachable through the authenticated dependency. `/auth/login` and `/auth/register` set the cookie *and* return `access_token` in the body so mobile can stash it in `expo-secure-store` (`apps/mobile/src/lib/auth.tsx`). New authenticated endpoints work for both clients automatically.

Sibling HTTPS app/API subdomains are cross-origin but normally same-site. Use `COOKIE_SECURE=true` in production; `SameSite=lax` works for same-site deployments. Truly cross-site preview domains require `SameSite=none` plus secure cookies. `HTTPGuardMiddleware` checks unsafe cookie-authenticated browser requests against exact trusted origins, including login/register origins, while preserving native bearer requests. JSON bodies are limited to 1 MiB and multipart bodies to 12 MiB before parsing. New registration rejects passwords longer than 72 UTF-8 bytes; bcrypt work runs outside the event loop. Legacy long-password logins remain compatible; the new password-reset flow enforces the current UTF-8 byte bound. API validation responses omit submitted values and validation context; the shared client displays only safe validation messages.

Web/native logout, sign-out-everywhere and deletion wait for server success before clearing the current account; network/server failure stays visible and retryable. Authentication expiry clears private state, and late account actions/refreshes cannot overwrite a newer identity. Web synchronizes ownership across tabs and fails closed on a known account change even if its refresh fails; a same-account verification refresh may retain the current user on transport failure. Protected web children and native navigation remount by account ID. Native serializes SecureStore writes, invalidates only the token that received a 401, and preserves its saved token on bootstrap transport errors. After successful revocation, secure-token deletion, account caches and owned cooking alerts are independent cleanup steps; a storage failure cannot restore the UI. Login preserves the current account's valid offline cooking queue.

JWTs carry a unique token ID and `users.auth_version`; legacy generation-zero tokens work until the account is revoked. Logout persists a token-digest revocation until expiry. Logout-all/password reset increment account generation; deletion removes the account. Account-link tokens are stored as SHA-256 digests, expire by database time and are consumed once under the account lock. Replacement links invalidate earlier links of that purpose.

### Account email and deletion lifecycle

New registrations set `email_verification_required=true`, create and commit a hashed verification link with the account, and queue its first email. Existing accounts retain a false requirement flag without being falsely marked verified. Web signup and pending-account login open `/check-email`, preserving a safe app destination. Resend, status refresh, settings and sign-out remain available; only verified server state unlocks protected children. The screen does not resend automatically on mount, so it does not invalidate the signup link. The avatar menu opens and focuses deletion confirmation at `/settings?delete=1#delete-account`; Cancel clears the password/acknowledgement and returns focus.

`app/api/account_routes.py`, `db/repo_accounts.py`, `services/account_email.py` and `jobs/account_cleanup.py` own recovery, verification and cleanup. Email defaults disabled. Activation requires `EMAIL_PROVIDER=ses`, `SES_REGION`, `SES_SENDER_EMAIL`, `SES_IDENTITY_VERIFIED=true` only after actual sender/sending-access verification, and `PUBLIC_WEB_ORIGIN` matching an exact CORS origin (HTTPS in production). The task role needs sender-scoped `ses:SendEmail`. Default reset/verification TTLs are 1,800/86,400 seconds. Address/IP admission limits apply. Links use `/reset-password#token=...` and `/verify-email#token=...`; pages capture then remove fragments and avoid third-party assets. Native recovery requests complete in the same web flow. Capability booleans describe configuration, not live delivery health. Missing setup returns uniform 503; delivery failures use secret-free logging and generic accepted responses. Delivery is an in-memory post-response task, so a process crash may require a replacement link.

Password-confirmed deletion atomically removes identities, action links, sessions, owned recipes/plans/cooking state and non-monetary account counters while queuing owned-image cleanup. Email-derived abuse scopes are removed only in this transaction; a minimal UUID tombstone subsequently sweeps only UUID-derived counters/scopes, preventing deletion of a newly registered account's email limits. Global/account monetary ledgers and reservations remain for reconciliation and cannot be refunded by deletion/recreation. Cleanup ownership rows and tombstones survive account deletion; retention of those minimal records, backups and shared copies needs an explicit operating policy. See [data inventory](docs/data-inventory.md) and [account lifecycle evidence](docs/qa/2026-09-22-account-lifecycle-implementation.md).

### Cooking-session domain and concurrency

Web planned cooking defaults to the browser's local calendar date, matching the planner, including near a UTC date boundary.

Web cooking refreshes ignore responses or errors made stale by an accepted local session change. Lower versions cannot rewind pending step requests or queued progress; after reconciliation, a current refresh accepts authoritative state even if optimistic work inflated the prior local version, and offline replay still runs. A current refresh can replace the session with a different identity or `null` after a change on another device.

`cooking_sessions.user_id` is unique, so an account has at most one active session. `cooking_session_dishes` and `cooking_session_steps` copy recipe title, image, ingredients, tutorial text, timing provenance, attention type, action type, and existing step image. They deliberately retain `recipe_id` only as provenance rather than a foreign key: later recipe edits/deletion cannot alter an in-progress cook. Finishing or discarding deletes the normalized session and all children; V1 keeps no history.

Step mutations and expiry-updating reads lock the user-scoped session row; step actions require the step's current `revision`. Every mutation carries a random mutation UUID and device ID; `cooking_session_mutations` makes retries idempotent. Two devices can safely advance different dishes because revisions live on steps. A stale mutation returns a stable 409 `detail.{code,message}`; ownership misses use 404. Starting/resuming a passive timer records an absolute `timer_ends_at` plus alert owner. Unknown-duration steps cannot start a timer but can still complete or skip. Reads turn elapsed running timers into `needs_attention`; they never auto-complete or advance the dish. Completing/skipping explicitly advances the earliest locked step. Shared progress uses duration weights when every dish step has a time and step counts when any time is unknown; deterministic attention ordering lives alongside it in `packages/shared/src/cookingSession.ts`.

Web (`apps/web/app/cook/`) and mobile (`apps/mobile/src/features/cook/`) refresh the canonical session on focus and every five seconds while visible. Focused dish is device-local. Only step actions queue offline; cached progress remains readable, while create/add/remove/finish/discard require connectivity. The validated cache/queue key is `cookingSession:v1:{userId}` and logout removes it. Replay is FIFO with original mutation IDs, stops on retryable failures, and reloads canonical state on revision conflict. Native uses `expo-notifications` for device-owned timer alerts and `expo-keep-awake`; logout cancels only cooking-owned scheduled alerts. Web alarms require the browser to remain open and Wake Lock support varies. Notification, sound, vibration, and wake preferences are independently editable; both clients support explicit alert takeover.

### Where LLM logic lives

Prompts live in `backend/app/extract.py` and `backend/app/refine.py`. Shopping rows retain original recipe ingredient contributions as `source_items`; web/mobile submit those originals rather than recounting displayed totals. Refinement asks GPT to group clear synonyms and consolidate quantities into one practical amount/range, with about/约 for estimates. Every original source ID must appear exactly once; invalid partitions or conflicting names fall back to the deterministic list with `refinement_status: "fallback"`. Accepted source groups keep their valid totals while individual invalid amounts are recovered from original quantities. If any original quantity or category remains unresolved, the usable result reports `"partial"`; fully validated or recovered totals report `"refined"`. Legacy name/category-only responses also report fallback. Smart-list quantity version 2 prompts cached lists to refresh. Text calls use `app/core/llm.py::complete_chat`; optional audiovisual calls use `app/services/video_analysis.py::complete_video`. The application reuses one `AsyncOpenAI` client and closes it at shutdown. The text default is `gpt-6-luna`, Standard processing with `reasoning_effort: none`, a 35-second per-call timeout, no automatic SDK retries, a 4,000-token completion cap, and a 60,000-character combined prompt cap. The pinned SDK sends the reasoning option through `extra_body`. Reviewed Luna accounting uses $0.125/M input (a conservative cache-write bound) and $0.50/M output; rejects input bounds above 272K; and retains reviewed GPT-4o mini rates for explicit rollback. Configure these through `OPENAI_MODEL`, `OPENAI_TIMEOUT_SECONDS`, `OPENAI_MAX_OUTPUT_TOKENS`, and optional `OPENAI_PROJECT`. Gemini uses bounded REST `countTokens` then `generateContent`, with no generation retry. Each generation reserves the reviewed model's full 1,048,576 input / 65,536 output token bounds before provider work; reconciliation includes thinking tokens, and uncertain charged usage keeps the reservation. Both providers share the two-generation maximum per admitted operation. Logs exclude submitted text, keys, and upstream error bodies. Cancellation propagates.

Missing AI configuration returns HTTP 503 for extraction; no demonstration recipes are generated. Shopping refinement preserves original items with `Other` categories when AI fails, and tutorial estimation preserves step text/identity using local metadata defaults. The unused broken extraction/refinement service wrappers and fabricated extraction stub have been removed. The empty `remove`/`likely_pantry` arrays remain at the HTTP boundary for client compatibility.

New Chinese imports use Simplified Chinese for recipe display text, including titles, ingredient amounts/notes, steps and tips. Extraction/audit prompts request Simplified Chinese and an offline OpenCC conversion normalizes remaining Traditional characters. Japanese/Korean recipe prose is preserved. Source excerpts and raw extraction text stay verbatim; script-equivalent action, ingredient, and timer comparisons do not rewrite the evidence. Explicit user title overrides and saved/manual recipes are untouched. This adds no provider call or migration. This follow-up is deployed in the release recorded above.

`app/api/ai_budget.py` admits import, refine, and tutorial-estimation requests through atomic PostgreSQL counters in `ai_usage_counters`. Defaults: 6 requests/minute and 50/day per account; 60/minute and 1,000/day globally. All four reservations commit before provider work. Rejected reservations roll back together and return HTTP 429 with `Retry-After`; counter-storage failures fail closed with 503. UTC windows use the database clock and are shared across replicas/restarts. Accepted attempts remain charged on downstream failure. One extraction request can make two bounded calls; these counters are operation allowances. Separately, `repo_ai_cost` atomically reserves conservative per-call monetary cost globally and per account, reconciles authoritative token usage once, and retains unknown costs. Shared leases default to four app-wide/one per account; one 85-second deadline covers admission, source work and provider work. Video source work uses a killable process with a deadline/parent watchdog and drained-pipe cleanup. Paid calls require verified dated supported-model prices and explicit monetary allocations; both allowances default to zero. Configuration and database reservation clamp global modeled app usage to at most USD 30 per UTC admission month. `backend/.env.beta.example` is an unactivated USD 29/app, USD 3/account overlay with USD 1 headroom, GPT-4o mini rates of USD 0.15 input/USD 0.60 output per million tokens and dated price metadata. Verify rates and a dedicated company-controlled project/key before applying it. The cap excludes taxes, unrelated key consumers, hosting, provider price changes and billing-period timing; provider alerts are not invoice hard stops. The older combined USD 150 planning assumption is superseded by the owner's acceptance of existing hosting. Stateless external work closes known read-only sessions before waiting: keyless AI admission, tutorial ownership reads, image uploads and Instacart export. Do not commit unrelated work implicitly in authentication dependencies.

### Refine is on-demand and per-week-cached

On web, the original shopping view shows planned meals and the smart-list preparation action. Ingredient checkboxes, copying, and product choices appear after preparation; temporary AI failure still exposes a usable, labeled recipe checklist. Native retains its deterministic basic checklist with check/share/selectable text before refinement. Failed initial reads expose Retry, and optional meal-preview failure does not block preparation. Smart checks, product choices, and cart state remain separate and persisted per week.

Web refinement failures from temporary service/network errors or AI admission limits expose a labeled grocery checklist from freshly fetched server-aggregated quantities, with an explicit retry and no automatic paid retry. A 45-second client deadline bounds refinement waiting. Whole-result provider or structural failures set `refinement_status: "fallback"` and show the unavailable notice/retry. Source-checked results that retain an original quantity or default category report `"partial"` and remain in normal Smart mode without the outage notice. Fully validated or recovered results report `"refined"`. Missing status remains compatible with older servers. Exact ingredient-name/quantity pairs preserve checkmarks and hidden rows across reorder/retry; changed quantities reset their progress. Unchanged ingredient sets retain Weee selection/cart progress. Account/week/request generation checks reject delayed results, and authentication or validation failures are not converted to fallback.

`/shopping-list/refine` only fires when the user explicitly prepares, refreshes, or retries a list. On web, `app/lib/userStorage.ts` scopes the following base keys with `:user:<encoded-user-id>` after authentication. It removes legacy/prior-owner application keys when ownership changes while preserving unrelated browser data and user preferences. Delayed refinement and product work are invalidated on unmount/account change. The shopping page persists four base keys per week:

- `smartShoppingList:{weekMonday}` — refined payload + `_ui.{hidden,checked}` + `_plannerFingerprint` (`sessionStorage`); writes and removals are best effort when quota/privacy settings deny storage
- `smartShoppingProducts:{weekMonday}:weee` — Weee product picks with authoritative expiry (`sessionStorage`); open panels without a retained positive are requeued on reload, and writes/removals are best effort
- `smartShoppingCart:{weekMonday}:weee` — safe explicit product choices plus confirmation tokens bound to canonical ingredient key + selected URL (`sessionStorage` on web, mobile `ephemeral` storage); skips are open-review state only and are never persisted. Reset writes an empty tombstone before removal; mobile serializes per-week cart mutations so a later choice cannot be overwritten by an older asynchronous reset, and both clients suppress stale same-session hydration when storage denies both operations.
- `cw.analytics.v1` — first-party random visitor (90 days), 30-minute activity session, allowlisted campaign/referrer context; never an account ID or email. No storage when DNT/GPC is enabled. Background API polling does not extend the session.
- `plannerWeekFingerprint:{weekMonday}` — written by planner; shopping page compares against `_plannerFingerprint` to mark the smart list **stale** when the planner changed afterward (`localStorage`)

Don’t add automatic refine triggers — token cost is intentional.

The product-picks payload also stores `queries`, a canonical mechanical key to first-cleaned-query map. Existing payloads without it are migrated from the current smart-list spelling and legacy raw keys. Hydration, Retry, exact-expiry reload, aliases, and later persistence keep that first spelling while using the canonical key only for identity; the coordinator rotates its in-memory spelling map when the page generation changes. A malformed batch `fresh` entry (empty, unsafe, expired, missing a future expiry, or expiring more than 24 hours from receipt) is never treated as a true empty; it falls back to serial GET. Batch rows are validated independently: valid requested hits publish first, while only malformed, duplicate, or omitted requested keys become misses and unknown keys are ignored. Web live, batch, and persisted positives share the backend mechanical product contract: collapse whitespace, require a 1–120-character name, require a safe official product URL, deduplicate name or URL case-insensitively in order, and retain at most three. Batch fallback queues all misses at their latest promoted priorities before starting the worker. Clearing the page state, unmounting, or advancing the lookup generation settles old promises to idle and aborts its batch/GET signals; identity guards prevent late old callbacks from releasing or mutating the newer generation's serial worker.

### Import flow (job, review, save)

Web `apps/web/app/import/page.tsx` and the native Import modal create `/recipes/import-jobs`, poll for a draft, and call `POST /recipes` only after review. `packages/api-client/src/recipeImport.ts` bounds polling to ten minutes and cancels active jobs on abort/error, including when creation returns its ID after cancellation. Unmount/account changes suppress late results. The synchronous `/recipes/parse/{link,transcript}` routes remain for compatibility; no parse route saves a recipe. Errors, pasted-text recovery, and cancelled reanalysis preserve the current draft, notes, and original source URL. Reanalysis presents a candidate that requires an explicit apply/keep choice before replacing manual edits. Import controls are EN/ZH localized; capability-fetch failure leaves text/manual import available.

Links accept strictly validated public HTTPS YouTube/TikTok URLs. YouTube caption retrieval uses `youtube-transcript-api==1.2.4`, retains segment IDs/times and track metadata, and prefers the original language. Available title/description accompanies captions. When captions fail, bounded public metadata/watch/player/anonymous Jina Reader description fallbacks remain available. TikTok uses only its public oEmbed title/caption. These retrieval paths do not download video. When configured, Gemini analyzes a canonical public YouTube URL if captions are unavailable or only description text was found; users can also explicitly request video analysis. Video analysis observes audio and sampled frames, not just captions, but public availability/provider access is not guaranteed. There is no direct TikTok audiovisual URL path.

`/recipes/import-capabilities` gates media controls and returns the size limit. Web accepts MP4/MOV/WebM video and MP3/M4A/WAV/FLAC/WebM audio; native uses the existing `expo-image-picker` video library picker for MP4/MOV/WebM without an audio-picker dependency. The backend validates matching MIME/container signatures and a 30 MiB byte limit, then sends inline media to the optional Gemini adapter. Uploaded media and public YouTube analysis share extraction and completeness checks; neither uses Whisper. Without that configuration, users receive pasted-text/manual recovery guidance.

`app/api/routes_imports.py`, `jobs/recipe_imports.py`, and `db/repo_import_jobs.py` own persistent account-scoped jobs. PostgreSQL admits at most one active job per account and 32 queued/processing jobs globally. API lifespan starts bounded import workers; no separate import-worker service is required. Workers claim with row locks, recheck account session generation, obtain existing AI admission/cost leases, and release transactions before external work. Jobs expire one hour after creation; terminal jobs clear source payload/media, and expiry maintenance removes rows. Cancel/account revocation prevents late result publication. Expired processing leases fail for explicit retry instead of automatically repeating potentially paid work. Results remain drafts until saved.

Manual entry uses shared `createManualRecipeDraft` and the same existing editor/`POST /recipes` save path without parse, tutorial estimation or other provider work. Clients require a trimmed title, at least one named ingredient and one step text; editable empty rows are removed at save. This path remains available when AI is unavailable/exhausted.

On iOS, `expo-share-intent` can prefill the same Import modal from a shared supported URL after auth/navigation restoration. The Share Sheet is a native extension and therefore requires a custom iOS development/EAS build; Expo Go cannot exercise it. Unsupported shared content is cleared without disrupting normal launch. Pasting a link manually remains the universal fallback and the supported Android flow.

Extraction inventories ordered atomic actions, including transfers, oil reuse, fat rendering, ingredient additions, heat changes, doneness, and finishing. Both prompts request separate tutorial rows for distinct operations and concise evidence without imposing a fixed step count. Video extraction and audit use separate JSON response schemas from `services/video_response_schemas.py`; the audit requires a nested object with explicit boolean verdicts and warning/reference arrays. A second bounded call audits completeness/order and returns a repaired procedure even when the first pass already contains steps. The audit preserves the first draft's ingredients and other recipe fields; failure or insufficient remaining deadline retains that draft with `needs_review`. `services/tutorial_quality.py` checks action evidence and coverage rather than trusting an audit verdict alone. Model analysis still requires user review and is not proof that every visible action was captured. No third generation is used to recover a failed audit; truncated generations are rejected after actual token usage is reconciled.

Draft `import_review` carries `status: ready|needs_review`, warnings, `source_kind: captions|description|video|media|text`, and `can_analyze_video`. A conservative check names ingredients mentioned only in preparation when other cooking/use steps exist; preparation-only recipes and ambiguous shortened Chinese names are excluded from that warning. It never invents a use or treats a shortened name as verified provenance. Ingredient-only sources keep their ingredients and original link with an incomplete-method warning; they do not receive an inferred typical procedure. A link with neither usable ingredients nor steps returns a recovery error. Source-backed steps carry instruction provenance/excerpts and available source times; review and detail expose source-moment links only for validated canonical YouTube URLs. Clip timestamps never become cooking durations. Unsupported or unclear methods stay explicit and editable. Both extraction passes now request a practical planning duration for each existing step; after grounding, `services/tutorial_timing.py` fills any timing gaps and bounds implausible brief-action estimates without inventing instructions or upgrading review status. Source/user times remain authoritative; video clip length is never cooking time. Missing recipe totals use the rounded-up sum of step durations, labeled Estimated total by clients when estimates contribute.

### Production durable jobs and capacity controls

Retailer HTTP requests, including cache hits/batches, pass replica-shared PostgreSQL admission: default 120 global/30 account requests per minute, 12 global/2 account concurrent leases, 30-second HTTP deadline and 40-second recovery lease. Durable polling defaults to two seconds with a 25-second request wait; caller timeout does not cancel the persistent job. Query/batch validation and retryable 429/503 responses bound load; auth/cache sessions close before admission/lease cleanup to avoid pool deadlocks.

`STORE_JOBS_MODE=auto` selects durable mode in production and local mode otherwise; production rejects local mode. Durable misses and warmer work use PostgreSQL jobs with bounded admission (100 queued/running), deduplication, one globally owned scrape, fencing, fixed leases, retry caps and shared status. API replicas never launch browsers. Run a separate Linux `python -m app.jobs.worker` task using the same image. Its subreaper supervisor marks `cleanup_pending` before external work and confirms descendant cleanup before releasing ownership; uncertain cleanup blocks recovery until verified operator action. Cache-hit completion never rewrites the stored timestamp. The persistent warm schedule coalesces missed runs; latest progress survives worker restart. Detailed process-local machinery in the following section is retained for development only.

Connection validation counts API/worker pools, rollout overlap, each worker supervisor's independent connection, one migration and the administration reserve. Pools have no default overflow and bounded checkout/statement/lock waits. `/ready` verifies required schema without requiring an exact future Alembic head. The historical cost preparation tool `scripts/prepare-scaling.py` still refuses incomplete estimates or totals above USD 150 and never applies infrastructure. Its old threshold is not the current owner-approved total-budget requirement. These safeguards are not a production capacity or billing guarantee; use the beta handoff for current scope.

### Store-product lookup is batch-first, strictly fresh, and serial

Modern single and batch responses include a UTC `server_time`, sampled after lookup. The shared API-client expiry normalizer converts `expires_at - server_time` into a device-local expiry anchored at request start, charging the entire request/JSON latency against freshness. Web direct requests and native API-client methods both apply this once before validation and persistence; the normalizer removes `server_time` afterward to prevent double translation. A device clock offset therefore cannot reject a fresh first response or extend the 24-hour limit. Invalid or transit-expired batch entries become misses while other hits remain usable. Older servers without the field retain the prior strict absolute-expiry checks. Durable positive job completions re-read the current authoritative L2 winner through the same DB-age translation as ordinary cache hits, rather than replaying raw DB timestamps or stale job products; empty results still have null expiry. This fix needs both API and client updates, and requires no migration or worker changes.

`backend/app/services/store_product_service.py` owns the in-memory L1, PostgreSQL `cached_store_products` L2, keyed single-flight coordination, and live-scrape queue (`CACHE_TTL_SECONDS = 86_400`, `CACHE_MAX_ENTRIES = 256`, `CACHE_VERSION = "v7"`). L1 is a bounded TTL/LRU that touches hits, evicts the least-recently-used entry under churn, and opportunistically prunes expired entries globally. L1 publication is generation-monotonic: an older, equal-timestamp, future, or invalid candidate cannot replace or erase a valid newer entry, and a delayed L2 read returns the in-process winner. Rows from other cache versions are inert. PostgreSQL is the authority for persistent generation and freshness: single and batch L2 each use one row query cross-joined to a materialized one-row `clock_timestamp()` observation, so every returned row shares one database instant without a second session execute. L2 accepts only finite `0 <= observed_at - updated_at < 86_400 seconds`. That authoritative base age is translated onto local receipt time for API expiry and a local monotonic anchor for L1 lifetime, so host/DB wall-clock offset does not reject a valid winner or grant future skew. The anchor is captured before the database await and preserved unchanged through validation and L1 insertion; all response and handoff latency is therefore charged against age rather than donated back to TTL. A row exactly 24 hours old is expired in single L2, batch L2, and L1. Expired rows are never returned or shown as fallback, including when refresh fails. Empty results and failures are not persisted as 24-hour entries.

`backend/app/services/store_scraper.py` is now a compatibility export facade only; it does not own a second cache, queue, browser lifecycle, or query-preparation implementation.

`prepare_store_query` performs mechanical cleanup only: trim outer whitespace, collapse repeated internal whitespace, reject Unicode-whitespace-only input, case-fold the cache/single-flight identity, and detect CJK for the existing language-specific Weee search route. It does **not** remove quantities, descriptors, preparation words, or modifiers and does not perform semantic ingredient normalization or aliasing. Mechanically identical inputs join by the case-insensitive key, while the first cleaned spelling is retained for the batch and live requests sent upstream. Unsupported stores are rejected before service work.

`backend/app/core/store_products.py::normalize_store_products` is the one mechanical product normalization used at scraper, L2 read/write, L1, and publication boundaries: retain original order, require safe official product URLs, deduplicate name/URL pairs case-insensitively, and keep at most three rows. It deliberately does not collapse weight or punctuation variants (`Rice 1 lb` and `Rice 2 lb` remain distinct). Legacy or corrupt L2 rows are normalized before return so persisted, published, and restart results match.

Web and mobile bulk loading split the visually ordered, mechanically deduplicated list into sequential cache-only `POST /store-products/batch` requests of at most 100 queries; 200 ingredients need two preflights. `loadStoreProductBatches` checks generation/unmount state between chunks. All fresh hits publish before live work starts; only misses enter one ordered live-GET worker. Manual opens, hydration misses, bulk misses, Retry, and exact-expiry reloads share that worker, with interactive work promoted ahead of the next queued bulk miss. Batch query size/count and shared HTTP limits apply; oversized list preflights no longer trigger per-item fallback merely for exceeding 100 ingredients. Each product panel shows up to three validated choices. Web and mobile reject live or persisted positive responses whose authority is expired or more than 24 hours from receipt. An unexpired retained client result renders immediately; at its authoritative `expires_at` boundary the client removes it and re-enters the same single-worker lookup flow, so a stale price is never displayed.

### Instacart shopping links

Instacart is a dormant integration with no visible web/mobile controls in this beta. Its retained code is implemented in `backend/app/services/instacart_service.py`, `routes_instacart.py`, the shared `instacart.ts` item-selection/link-validation helpers, and web/mobile `InstacartShoppingPanel.tsx`. It requires no store-product lookup or smart-list preparation. Both panels invalidate generated links and cancel pending work when their source list/week changes; empty, refreshing and stale lists cannot be exported. Opening Instacart does not mark groceries checked or added. Seven-day upstream links exist only in panel memory; no persistent storage keys or database migrations were added. Quantities are preserved in display text, and structured measurements are emitted only for recognized unambiguous values. Exact HTTPS Instacart result hosts are validated server/client; real development-host validation remains pending a key. New copy is EN/ZH (the provider-approved CTA stays English), with official logo assets; mobile provider colors live in `src/theme/colors.ts`.

### Guided Weee cart companion is local and user-controlled

`packages/shared/src/cartAssistant.ts` builds a pure provider-shaped draft from visible, unchecked, canonical-deduplicated ingredients. It discards unsafe URLs, keeps at most three safe choices, derives the first safe result as the default, accepts a still-valid explicit alternative, binds confirmation to ingredient + exact selected URL, and sums only standalone `$N[.NN]` or `US$N[.NN]` prices. Ambiguous, promotional, range, or non-dollar strings remain explicitly unpriced. A queued/loading row with no retained safe result is pending rather than unmatched; empty, error, unsafe-only, never-requested, and expired-unknown rows are unmatched. Mobile withholds cart authority until the current week's product cache has hydrated. Afterward it keeps pending, settled, and idle/expired-unknown distinct: dormant stored choices/confirmations survive unknown authority but are pruned only after a terminal product array or real string error proves them incompatible. A denied cache read settles to empty current-week authority so later live matches remain usable.

Web uses `CartAssistantDialog`; mobile uses `CartAssistantModal`. Both show ready/pending/unmatched/explicitly-confirmed counts, an estimated subtotal, selected products, and trust copy. They open exactly one currently URL-validated product page per user gesture. Opening never confirms anything: only **I added it** stores local progress, **Skip for now** advances only until the review closes, and **Undo** removes a confirmation. If the pass ends with any selected item skipped, the heading is **Review pass complete**; **Handoff complete** is reserved for a pass in which every selected item was explicitly confirmed. Checked/hidden rows leave the active draft; checked rows may retain cached retailer links but hide Top pick and all cart-selection controls. Changing a product invalidates its old confirmation, and product revalidation preserves progress while authority is pending but prunes it after a settled incompatible result. A successful smart-list regenerate or Back to original clears live products, selections, confirmations, skips, and review state; failures preserve them. Week changes hydrate only that week's ephemeral keys, and origin-week/generation guards prevent late web or mobile mutations from clearing the destination week.

There is intentionally no cart-write HTTP route or retailer authorization flow. As of this implementation, no published Weee consumer API, OAuth flow, bulk-cart endpoint, or documented add-to-cart deep link was found. Chef World does not accept Weee credentials, read/replay retailer cookies, call private endpoints, write a Weee cart, or perform checkout. The user opens URL-validated official-host product pages in their own Weee session and confirms progress locally; price, stock, package size, delivery eligibility, promotions, tax, fees, and the final cart remain authoritative on Weee.

Weee's Terms reviewed on 2026-08-29 prohibit automated or unconventional access and scraping. The existing public-search lookup scraper is therefore a separate authorization and policy risk that requires product/legal review and permitted access; validating an official-host URL is not a claim that the lookup is Terms-compliant. The cart companion does not expand that lookup into credential, cookie, private-endpoint, cart-write, or checkout automation. This is a product/engineering boundary, not legal advice.

The future direct path is a provider adapter only after Weee supplies a documented, permitted contract. Ask its partnership/affiliate/marketplace channels for short-lived user authorization, stable product identifiers, idempotent bulk/add-item behavior, per-item errors, regional availability, sandbox access, rate limits, and attribution rules. The current draft model can feed that adapter without changing the selection/review experience; it must report authoritative provider results rather than inferring success from a page open. See `docs/superpowers/specs/2026-08-29-weee-cart-companion-design.md` for the decision record and official contact references.

`backend/app/services/weee_scraper.py` performs at most three internal attempts for one logical lookup. Every attempt creates a fresh browser context and exactly one search page, and closes both in `finally`; classification and extraction share the same nearest-leaf visible search-card scope, prioritize the current `wid-product-card-container` marker, reject anchors inside recommendation/carousel regions, and never open product-detail pages. The final search URL must be HTTPS, contain no credentials or non-443 port, use an exact/subdomain official host, match the exact language search path with an optional trailing slash, and contain exactly one decoded `keyword` equal to the expected cleaned query; unrelated tracking parameters are allowed. Product URLs must be HTTPS product paths on an official `sayweee.com` or `weee.com` host (including subdomains). Challenge signals dominate products and empty signals, while conflicting visible search products plus a no-result marker remain untrusted. Only a visible, specific Weee no-result element with no challenge or scoped products is a true empty; the current English query-bearing no-result element must exactly name the submitted query, and generic global/body copy is insufficient. Product extraction prefers the card title over machine image metadata and takes the first primary currency amount rather than a later unit price. Navigation/hydration timeouts, challenges, unexpected routes, malformed or unsafe-only results, and browser failures are transient typed failures and are retried internally. A recovered later attempt completes the original request without surfacing an error. A confirmed empty result returns HTTP 200 with `products: []` and `expires_at: null`; exhausting all attempts returns HTTP 503 with detail code `weee_temporarily_unavailable` and `Retry-After: 3`.

**Development/local mode only:** the retained in-process implementation below runs one live scrape per process. Production requires `STORE_JOBS_MODE=durable` and uses the shared worker described above; do not apply these local-mode scheduling guarantees to production. Same-key callers join one cancellation-shielded job with identity-token waiter accounting. Waiter release is itself cancellation-shielded and identity-idempotent; when the final waiter leaves an unfinished flight, its lease is invalidated and its active child is cancelled, while any remaining same-key waiter preserves the shared flight. Every terminal path of an invalidated active flight—including a child that converts cancellation into an ordinary exception—must reach physical quiescence before its quarantine is cleared. Interactive work is normally preferred, while a background job advances after at most eight bypassing interactive jobs or 30 seconds of queue age; the fairness streak resets whenever the relevant background backlog disappears or the worker reaches idle. The live queue expires a job after 180 seconds, the front door waits at most 240 seconds, a live operation gets 125 seconds, worker shutdown waits 10 seconds, and detached live operations get a bounded 10-second shutdown drain. Scraper operations get 20 seconds each, each attempt gets 35 seconds, all three attempts share a 110-second operation total plus at most 15 seconds of aggregate cleanup, individual cleanup calls get 5 seconds, and detached Playwright operations get a bounded 5-second shutdown drain. These monotonic budgets are test-patchable. A logical timeout settles its caller promptly, but the physical serial permit remains quarantined until the cancellation-resistant root and all registered Playwright descendants/resources reach fixed-point quiescence. Existing queued work and new admission fail promptly with typed transient errors while quarantined, an independent watchdog still expires unstarted jobs, and admission recovers automatically after physical release. Every live job owns an invalidatable generation lease checked before persistence, at the commit point, and before L1/waiter publication; timeout/shutdown paths invalidate browser resources and prevent cancellation-resistant late work from publishing. A late page/context cleanup failure is surfaced before retry and retires the exact owning browser rather than silently releasing serial ownership. Failed child, browser, or Playwright cleanup remains in an explicit retirement registry; this includes the exact Playwright owner when Chromium launch fails and its immediate `stop()` raises, times out, or is caller-cancelled. No retry or new browser launch is allowed while a prior browser/driver remains owned or retirement is unconfirmed, and a later acquisition/shutdown retries the retained retirement. Queue-wait telemetry records actual selected priority and wait duration, including promotion and expiry.

Authenticated cold-miss routes, including admin single-query force refresh, end their short L2/auth read session before awaiting the live queue; the SQLAlchemy session may then begin a new short post-wait read transaction. Positive writes use a separate short session and commit before L1 publication or waiter resolution. Commit is an explicit shielded ownership boundary: `commit_started` is set immediately before invocation, after which the actual outcome is awaited and no rollback is claimed to undo an uncertain commit. Before that point a failed write is rolled back normally. The repository persists each candidate with one PostgreSQL `INSERT ... ON CONFLICT DO UPDATE`; PostgreSQL `clock_timestamp()` generates the candidate timestamp, observes the returned winner, and evaluates whether an incumbent is future poison. Its volatile conflict-evaluation semantics are required because transaction-start `CURRENT_TIMESTAMP` can be older than a concurrent winner after a blocked conflict. The predicate accepts a strictly newer candidate or replaces an incumbent later than the evaluation-time database clock; equal timestamps and genuinely newer nonfuture incumbents remain authoritative. Candidate wins return normalized data, generation, and observation directly from `RETURNING`; when the conditional update loses, the same transaction reads the conflict winner with a fresh database observation after PostgreSQL's conflict wait. The write commits that authoritative row, and L1 plus the response publish the winner rather than the losing candidate. This database clock domain is deliberately translated at the service boundary rather than compared to the application host clock. An invalidated generation may safely finish an already-started commit under serial quarantine, but cannot update L1 or resolve waiters. The service’s release behavior is explicit so non-route callers do not have unrelated work rolled back or closed by surprise.

`backend/app/jobs/cache_warmer.py` traverses `cache_warmer_queries.py::ALL_QUERIES` serially at background priority, isolates per-query empty/failure outcomes, and force-refreshes on the opportunistic 24-hour APScheduler interval. The offline-curated source contains 390 unique, grocery-searchable English and Simplified Chinese terms grouped into 13 reviewable food categories; intentional common English plurals expand that source to 405 exact runtime queries. The catalog is Asian-first while retaining broad global staples, and category/size/duplicate/cleanliness quality gates live in `backend/tests/test_cache_warmer_queries.py`; 405 runtime queries is the current reviewed ceiling. Scheduled and manual starts share one atomic tracked-run gate, so neither can start a second full run while the other is active. Status remains `running` while a cancellation-resistant tracked task is physically active, and unexpected tracked-task failures are consumed and logged with an identity guard. The interval resets on process restart and performs no persistent catch-up. Backend startup only starts the scheduler; it does not launch a live-scrape sweep. Admins can still drive the warmer from `/preview` through `/admin/cache-refresh*`.

Application shutdown stops lookup admission, settles queued callers with typed transient errors, cancels/awaits the active worker and tracked warmer, drains tracked detached work to a fixed point within bounded shutdown budgets, closes pages, contexts, shared browser and Playwright resources, and then disposes the database engine. Late successful resource acquisitions are closed instead of published, browser lifecycle generations prevent shutdown from resurrecting globals, and cancellation-resistant worker/warmer/browser/database references remain owned until they actually finish so a later cleanup can retry. Database disposal is application-owned and continues shielded after its caller's deadline or cancellation; the engine and session maker remain coherent until actual success, initialization refuses during active disposal, and a failed or externally cancelled disposal can be retried deterministically. Every later phase still runs when an earlier cleanup fails or the shutdown caller is cancelled; failures are reported and caller cancellation is propagated afterward. Startup re-enables admission and resets fairness state. Shutdown/resource close is idempotent and cancellation is not swallowed.

### Image uploads switch on env

Shared auth and upload counters use PostgreSQL time and commit before expensive work. Auth hashes normalized account/IP scopes rather than retaining raw identifiers. A single outer proxy trust layer accepts forwarded identity only from explicit narrow `TRUSTED_PROXY_CIDRS`; production requires verified ALB subnets and disables duplicate Uvicorn interpretation. Uploads additionally reserve cumulative account/app count and bytes before storage: defaults 200 objects/100 MiB per account and 10,000 objects/5 GiB globally. Unknown writes and abandoned drafts remain charged. Historical objects require inventory before these counters describe the entire bucket.

`POST /recipes/upload-image` reads at most 10 MiB plus one detection byte and verifies a matching JPEG/PNG/GIF/WebP signature. It rejects mislabeled active content; this is a signature check, not full decoding or malware scanning.

With both S3 settings, `save_recipe_image_s3` stores exactly the checked bytes under `recipes/{account_id}/{uuid}.{ext}` using a bounded SDK call in a worker thread. Without S3, the same checked bytes are written to the local upload directory. Both return `{upload_url: "", file_url}` so existing clients skip their legacy second PUT. No new presigned PUT capability is issued. New uploads reserve durable ownership coordinates before storage under `recipes/{account_id}/{uuid}.{ext}` in both storage modes. Account deletion marks owned objects for cleanup; pending/recent uploads retain their five-minute settling window. `ACCOUNT_CLEANUP_ENABLED=true` starts an API-lifespan poller (`ACCOUNT_CLEANUP_POLL_SECONDS=30`) with leased/backoff retries and prefix-scoped S3 deletion; it never fetches arbitrary URLs. Recipe/cooking-snapshot references, including normalized URL aliases, defer deletion. Reference writers lock the ownership row; a late copy retains recipe data but cannot reattach an image already being deleted. Late upload completion preserves `deleting` state, invalidates the old cleanup lease and queues another delete after settling. Provably owned legacy configured-bucket S3 URLs may be adopted; unowned legacy local objects and historical ownership uncertainty require separate inventory. Ordinary recipe deletion does not itself run an orphan sweep; shared copies and backups are not immediately erased.

### Public catalog gating

`can_manage_public_catalog()` in `backend/app/core/admin.py` admits an account only when its UUID appears in `PUBLIC_LIBRARY_EDITOR_USER_IDS` or `ADMIN_USER_IDS`. Empty configuration denies access in every environment. The former email-based and inferred-local-development exemptions have been removed. Set IDs from verified existing users before deploying this change; neither a new signup nor the frontend can grant permissions.

Recipe creation uses an atomic PostgreSQL owner-guarded upsert. A collision with another user's ID returns 409 without changing the row. New recipes are private with no copy provenance, and retries cannot change owner, publication, or provenance. Catalog publication and friend/catalog copying remain separate authorized operations. Both copy paths lock the receiving account before checking prior copies, returning a deterministic existing match when legacy duplicates exist. Public/friend recipe projections and new cross-account copies omit `raw_extraction_text`, which can include private import guidance. Owner reads and historical stored copies remain unchanged; shared UI uses the public description instead of raw import text.

### Friend library sharing is orthogonal to the public catalog

Two separate visibility models coexist:

- `RecipeModel.is_public_catalog` (per-recipe flag) drives the global editor-curated catalog at `/recipes/catalog/*`. Flagging a recipe is gated by explicit catalog/admin account IDs (see "Public catalog gating" above).
- `UserModel.is_library_public` (per-user flag) drives friend-library sharing at `/users/*` (search by email, list a friend's library, copy from it). Anyone can flip this for themselves via `POST /auth/library-visibility` — no editor gating. When on, your entire library becomes visible to anyone who searches your exact email.

`POST /users/{id}/recipes/{rid}/copy` and `POST /recipes/catalog/{id}/copy` both set `catalog_source_recipe_id` on the new row, and bounded summary/detail responses expose caller-scoped `already_saved`; clients need not download the entire owned library to detect copies. The friend-library code lives in `backend/app/db/repo_users.py` + `backend/app/api/routes_users.py`. Smoke testable via `backend/scripts/smoke_friend_library.sh <jd-pw> <bob-pw>`.

**Deploy order for features that add backend endpoints + web UI** (applies to friend-library and anything similar): deploy the new backend ECS task def FIRST so the new routes exist on prod, THEN merge the feature branch to main (which auto-triggers Vercel). If reversed, web ships UI that hits `404` on prod backend until ECS catches up. Quick prod readiness check before merging web: `curl -i https://api.chef-world.com/<new-route>` should return `401 Not authenticated` (route exists, just needs auth) not `404 Not Found` (route doesn't exist yet).

### API base resolution

- Web (`apps/web/app/config.ts::getApiBase`) — `NEXT_PUBLIC_API_BASE` if set, else `http://localhost:8000`. Vercel builds bake in `https://api.chef-world.com`; Docker compose bakes in `http://localhost:8000`.
- Mobile (`apps/mobile/src/config.ts::getApiBase`) — `EXPO_PUBLIC_API_BASE` if set, else `http://localhost:8000` with a one-time console warning. **Real-device** testing requires LAN IP (`http://192.168.x.x:8000`); `localhost` resolves to the phone itself. For testing against prod, set `EXPO_PUBLIC_API_BASE=https://api.chef-world.com` in the Expo env.

### Cross-package imports

Web and mobile depend on `@cooking/shared` and `@cooking/api-client` via `file:` workspace links. `apps/web/next.config.mjs` lists them in `transpilePackages` — add new shared packages there too, or Next won’t transpile them. The web Dockerfile's build context is the **repo root** for the same reason. `@cooking/api-client` exposes the full recipe surface including catalog ops: `recipes.catalog()`, `recipes.copyCatalog(id)`, `recipes.editorStatus()`, `recipes.setCatalogVisibility(id, isPublic)`. Web currently uses raw `apiFetch` for the catalog routes; mobile uses these typed methods.

For mobile, `apps/mobile/metro.config.js` adds the workspace root to `watchFolders` and `resolver.nodeModulesPaths`. The `disableHierarchicalLookup` flag is intentionally left at the default (off): with the SDK 54 dep tree, several Expo transitives (`expo-asset`, `babel-preset-expo`, etc.) end up nested at `apps/mobile/node_modules/expo/node_modules/` rather than hoisted to the root — Metro needs hierarchical walking to find them. Without the workspace-root `watchFolders` + `nodeModulesPaths` entry, Metro hangs on bundle compile (the simulator shows a misleading "Could not connect to development server" red error after a 30s timeout). When adding a new shared package, no Metro changes are needed; just install it in `apps/mobile/package.json`.

The mobile `babel.config.js` uses `require.resolve("babel-preset-expo")` and `require.resolve("react-native-worklets/plugin")` rather than bare specifiers. This is necessary because npm sometimes installs these into `apps/mobile/node_modules/` rather than hoisting to the repo root, and Babel runs from `<root>/node_modules/@babel/core/...` where Node's standard resolver can't reach into a sibling workspace. `require.resolve` runs from the babel.config.js file's location, sidestepping the issue.

Pages and components import shared helpers (week math, meal-plan slot helpers, ingredient formatting, shopping categories, recipe tag groups, `getRecipeTags`) directly from `@cooking/shared` — there are no per-app re-export shims under `apps/web/app/lib/`. The one truly web-only lib is:

- `app/lib/recipeCategories.ts` — re-exports `RECIPE_TAG_GROUPS` / `TAG_LABELS` / `CATEGORY_LABELS` / `LIBRARY_FILTER_CHIPS` / `recipeTagGroupFor` / `RecipeTagSlug` from `@cooking/shared`, plus the web-only `categoryBadgeStyle(slug)` (returns `CSSProperties` — needs the React DOM type). Mobile imports the shared exports directly.
- `app/lib/recipeTags.ts` is a thin re-export of `getRecipeTags` from `@cooking/shared`; existing callers don't need to change. Mobile uses `import { getRecipeTags } from "@cooking/shared"` directly.

The slug union `RecipeTagSlug` lives in `@cooking/shared/types`.

### Public website and recipe library layout

The web root `/` is a Chef World homepage with page-local English/Chinese switching.
Its feature tabs are ordered Recipes, Planner, Shopping, Muse, Menu maker, and Cook.
Recipes and Shopping use keyboard-focusable, fixed-height scroll viewports with
full-width screenshots. Planner uses a single static screenshot, and Menu maker
shows the actual creation page with its finished menu layered into the image.
Cook uses a centered, stationary step-completion video that autoplays silently and
loops, with native controls and no play-prompt overlay. Source failure shows a static
cooking screenshot. Its player is paused and unmounted when changing tabs; returning
to Cook starts the video again. Native controls remain available if autoplay is blocked. The preview does not call
application APIs or change a cooking session. Changing tabs also resets screenshot
scrolling. Missing scroll-preview images fall back to the existing screenshot. The click-to-play,
silent 30-second feature video remains a separate preview. `/about`, `/privacy`, `/terms`, and `/contact` are also public.
Their header and footer use the same Home/About/Contact/Privacy/Terms page links under
`apps/web/app/public-site/`. The header and home hero have an `Open app` link to `/library`;
existing authentication handles signed-in users or redirects guests to login. The homepage defaults to English; its language switch translates only the public page
and its navigation, without changing the saved language preference for the bilingual
web app. Other public pages remain English. Screenshot tabs support keyboard navigation
and enlargement; enlarged tall screenshots remain scrollable, while Cook offers its
static screenshot for closer viewing. The separate 30-second tour has native controls,
no autoplay, and a text alternative.
The hero Open app button retains white text on hover; partnership copy uses the light foreground to preserve readable contrast on sage.
The signed-in app header keeps its brand link pointing to `/library` and provides a small
translated Home icon beside it for returning to `/`. My Library's outlined menu-card
action remains visually distinct from the primary Add Recipe action.
Existing `/login` and `/register` routes link back to the public policies. This is not an
invite-only registration gate. The current contact is `jerryxiang24@gmail.com`.

`lib/publicRoutes.ts` is the exact public-path allowlist used by the session-expiry redirect
and app header. A 401 still clears stale private state, but leaves those public pages
readable; protected pages retain their existing login redirect. Public content is rendered
without waiting for authentication or backend availability. `sitemap.ts` lists only the
informational pages; robots rules are crawler guidance, not access controls.

Public-library cards open authenticated `/library/public/[id]` previews with ingredients,
steps, and tips. These use the existing sanitized catalog read and render tutorials with
`canEdit={false}`; they expose no editing or cooking action for the catalog source.
Users can save a private copy or open their existing copy. Publishing and source mutation
permissions remain enforced by the existing backend; this preview adds no API routes.

The public Privacy Notice describes actual storage, AI processing, sharing/copying,
externally hosted resources, and manual data requests. Keep `public-site/documents.ts`
aligned with `docs/data-inventory.md` when behavior changes.
No retailer partnership or API access is claimed by the public overview.

Personal and catalog recipe lists use `library/LibraryMasonry.tsx`. It measures rendered
card heights and places each successive card in the shortest responsive column, with
ResizeObserver updates for images and width changes. The DOM retains recipe sort order
for keyboard and screen-reader navigation. Do not restore fixed modulo column assignment.
Browser regressions cover the seventh card, image loading, filtering, and 4/3/2/1-column resizing.

Desktop app routes use a compact 87.5% root type scale while keeping the 1280px shell.
The `data-app-shell` header marker scopes this to the workspace; public pages and mobile
retain their normal scale. The planner keeps its row heights, widens the recipe rail to
two columns at 1280px and above, and uses narrower planned-dish thumbnails.

### Recipe tags

Two parallel concepts on `RecipeModel`:

- `library_tags` (string of JSON array; new) — multi-select.
- `library_category` (nullable single string; legacy) — kept in sync as `tags[0]`.

`backend/app/models.py` defines `RECIPE_TAG_SLUGS` (frozen 31-slug set) and `LEGACY_LIBRARY_CATEGORY_TO_TAG` (e.g. `quick_dinner` → `quick`). Anything written to either column passes through `coerce_library_tags`. Request bodies in `routes_recipes.py` use the reusable `LibraryTags = Annotated[list[str], BeforeValidator(coerce_library_tags)]` from `app/api/_types.py` instead of repeating a per-model `@field_validator`. The same slug list is mirrored as a TS union in `packages/shared/src/types.ts::RecipeTagSlug` and re-listed in `packages/shared/src/recipeTags.ts::RECIPE_TAG_GROUPS`. **Adding a tag means three edits**: backend `models.py`, shared `types.ts`, shared `recipeTags.ts`.

### Recipe tutorial fields

`Recipe` carries five backward-compatible fields beyond the base ingredients/title set:
`description`, `total_time_minutes`, `steps`, `tips`, and `equipment`. They are stored in columns
added by `20260514_recipe_tut`; list-shaped fields remain JSON-in-Text, `description` is `Text NULL`,
and `total_time_minutes` is `Integer NULL`. Migration `20260825_step_meta` canonically backfills the
existing step JSON in place and is idempotent.

The canonical `RecipeStep` contract is:

```text
id: UUID string
text: non-empty string
duration_seconds: whole number | null
duration_source: stated | estimated | user | fallback | unknown
attention_type: hands_on | passive
action_type: prep | chop | mix | season | sear | simmer | boil | bake | rest | drain | assemble | plate | other
image_url: string | null
instruction_source: source | suggested | user | null
source_start_seconds, source_end_seconds: finite number | null
source_excerpt: string | null
```

Old strings and partial dictionaries remain accepted at request/repository boundaries. Canonical
normalization trims/drops empty instructions, preserves unique valid IDs and existing images, and
generates a UUID for missing/duplicate IDs. A legacy numeric duration with no provenance is
`stated`; malformed legacy metadata uses `fallback` / `hands_on` / `other`. Generated, stated, and
fallback durations clamp to 15–86,400 seconds; explicit user edits clamp to 1–86,400 seconds.
New imported nonblank steps receive source-stated or estimated timing. Web import/manual instruction edits also receive local estimates; blank placeholders and explicitly cleared times remain `null` / `unknown` and may show "Time not specified". Explicit unknown durations at persistence boundaries never receive a generic five-minute default.
Legacy rows lacking duration provenance retain their previous remaining-total/median/300-second
fallback normalization, and existing numeric fallback times are preserved. A source-stated
`total_time_minutes` is preserved; an absent total is derived only when every step has a duration.

Web and mobile import review plus saved-recipe tutorial editing preserve step IDs, order, metadata,
and hidden `image_url` values. Setting a duration marks it `user`; clearing it marks it `unknown`.
Editing instruction text marks it `user` and clears source excerpts/times. The web import/manual editor re-estimates non-user timing locally; saved-recipe tutorial editors retain their explicit estimate workflow. An explicitly user-set duration survives text edits. Source evidence lives in step JSON without a
new recipe column; `import_review` describes the draft response. Existing images take precedence
in detail; missing/broken images use the shared vector pictogram. "Estimate missing tutorial
details" explicitly estimates fallback/unknown timing in local editor state through the preview
endpoint; Cancel performs no PATCH, and Save PATCHes the steps. Reading a recipe or opening a
cooking flow must never silently rewrite tutorial metadata.

The September 25 recipe-editor refinements are included in the production release recorded
above. The web tutorial editor uses consistent scoped step cards with aligned duration, attention,
and illustration controls, a cooking-plan summary, and responsive phone layouts. Source-backed
timestamp links are labeled "Source"; authorship badges are hidden on recipe detail. Suggested-step
cautions remain visible while editing. Illustration choices and assets are unchanged.

Import/manual review exposes tag selection and cover uploads. Saved recipes also offer a direct
cover-photo change through a compact camera icon that PATCHes only the thumbnail. Import/full
edit retain labeled upload buttons. Pending image uploads block saving, failed
uploads retain the previous cover, and applying a later text/video candidate preserves the current
cover and tags. Ingredient quantities keep source units first; grams/mL equivalents are optional,
and estimates must remain approximate. Concise detail rows show only the ingredient name and
primary amount, without preparation-note subtitles. Notes remain available when editing;
untouched source text and alternate units remain in "Original amounts & notes".
Import ingredient rows keep notes and optional metric equivalents in a disclosure.

Recipe equipment lists are retired. Web and native recipe details, full editors, import review,
and reanalysis previews no longer display or edit equipment, and new imports do not request
or retain a separate equipment list. Existing tool mentions inside cooking instructions remain
part of the method. The optional API fields and database columns remain for older clients and
saved recipes; current clients omit equipment on create/update instead of rewriting saved data.

### Recipe view skin (sub-project E)

Recipe detail uses the cross-platform Culinary Workbench system from the UI reset. Web
`apps/web/app/recipe/[id]/page.tsx` keeps its route styling in `RecipeDetail.module.css`
(not `globals.css`), with a two-column ingredients/tutorial layout above its responsive
breakpoint and a single column below. `RecipeTutorial.tsx` owns the timed step read view;
`recipe/[id]/tutorial/edit/page.tsx` owns focused editing. Mobile
`RecipeDetailScreen.tsx` and `RecipeEditScreen.tsx` provide the same read/edit behavior
through native theme primitives and a vertical phone layout. Web SVG and native
`react-native-svg` render the same action primitive data from `@cooking/shared`.

### Meal plan storage

`MealPlanModel.recipe_ids` is a JSON-serialized string in a `Text` column. Newer rows are objects (`{breakfast,lunch,dinner}`); some legacy rows are arrays. `normalize_meal_plan_slots` (in `app/models.py`) handles both shapes on read and on PUT body parsing. Request normalization must retain only explicitly supplied fields, so omitted slot defaults do not erase legacy `recipe_ids`. Date inputs are validated; reversed ranges and ranges longer than 31 inclusive days are rejected for planner and shopping reads. Slot lists accept at most 100 recipe IDs each (255 characters per ID). Stored days have a positive revision; an absent day has implicit revision 0. Both current clients submit `expected_revision` on every edit. Atomic insert/update checks reject stale revisions with HTTP 409 and `meal_plan_conflict`; clients abandon queued edits for that date, reload its authoritative contents and revision, and ask the user to retry. A failed reload blocks further edits until refresh (the affected date on mobile; the existing failed-load guard for the whole visible week on web). Both clients still serialize rapid same-day mutations and preserve the existing non-conflict failure/rebase behavior. Deprecated writes that omit `expected_revision` remain last-write-wins for compatibility but increment the revision, so current clients detect their changes. Recipe deletion removes its ID in one atomic SQL update of affected rows and increments their revisions, preserving concurrent unrelated edits.

### Mobile structure

`apps/mobile/src/` is organized into:

- `theme/` — `colors.ts`, `spacing.ts`, `radii.ts`, `typography.ts`, `index.ts`. Plain imports (no `useTheme()` hook — no dark mode in scope). All hex codes live here; feature code never inlines colors.
- `lib/imageUrl.ts` — `resolveImageUrl(raw)` rewrites loopback hosts (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`) in image URLs to the configured `EXPO_PUBLIC_API_BASE` host. Backend's `/recipes/upload-image` stores absolute URLs built from `request.base_url`, which on local docker is `http://localhost:8000/...` — on a real phone, `localhost` is the phone. This helper applies at every image render site (library cards, recipe detail hero, planner picker rows + chips, import preview). Cleaner long-term: backend stores relative URLs and clients prefix; for now the rewrite is mobile-only and doesn't touch web rendering.
- `features/library/Friend{Search,Library}Screen.tsx` — friend-library surface pushed onto `LibraryStackParamList`. Search header icon (`LibraryListScreen.tsx`) → `FriendSearch` (email input, `users.searchByEmail`) → `FriendLibrary` (list + `users.copyFriendRecipe` with already-copied detection on `catalog_source_recipe_id`). Profile toggle `Share my library` in `ProfileScreen.tsx` flips `users.is_library_public` via `useAuth().setLibraryVisibility`.
- `components/` — primitives: `Screen` (safe-area + optional KeyboardAvoidingView + ScrollView with `contentInsetAdjustmentBehavior="automatic"`), `Card`, `Button` (variants `primary | secondary | ghost | destructive`, fires `expo-haptics` selection feedback on primary press-in), `IconButton`, `EmptyState`, `TextField`, `ListRow`. Import from `@/src/components`.
- `navigation/` — `RootStack` swaps between auth and `MainTabs`; Import and Account are sibling root flows. `RootStack` also consumes a ready/authenticated `expo-share-intent` payload once, extracts a supported URL, opens `ImportModal({ initialUrl })`, and resets the intent. `MainTabs` is Library / Planner / Shopping / Cook and `CookStack` owns `CookHome`. All `ParamList` types live in `navigation/types.ts`.
- `features/<area>/` — screens grouped by feature (`auth/`, `library/`, `planner/`, `cook/`, `shopping/`, `import/`, `profile/`). `features/import/sharedVideoUrl.ts` is the pure exact-host HTTPS YouTube/TikTok extractor used by the Share Sheet bridge; `ImportModalScreen` consumes `route.params?.initialUrl` only during reducer initialization. New feature work lands here, not in a flat `screens/` directory.
- `lib/` — `api.ts` (`buildClient` + `useApiClient` hook), `auth.tsx` (`AuthProvider` + `useAuth`; clears `ephemeral` storage on logout), `storage.ts`, `haptics.ts`, plus `config.ts` at `src/` root for `getApiBase()`.

`RootStack` shows a `<SplashGate />` (centered ActivityIndicator) while `useAuth().loading === true`, so cold launches don't flash the Login screen before the SecureStore-saved token resolves. Pending verification-required accounts see account settings until verified; Main/Import are gated and a pending shared import remains available after verification.

### Mobile storage conventions

`apps/mobile/src/lib/storage.ts` exposes two backends:

- `persistent` — wraps `@react-native-async-storage/async-storage`. Used for planner fingerprints and per-user `cookingSession:v1:{userId}` cache/queue; `clearUserScopedPersistent()` removes both prefixes on logout. Web week keys additionally use its account-scoped storage wrapper; do not assume the physical keys are identical across platforms.
- `ephemeral` — in-memory `Map<string,string>` only. Mirrors web's `sessionStorage`: cleared on app kill, on logout, and on language change (Phase 4). Used for the smart shopping list cache, Weee product cache, and week-scoped `smartShoppingCart:{weekMonday}:weee` selections/confirmations. **Always re-validate against the planner fingerprint and current safe products on read** — the cache can be empty mid-session if the app was backgrounded long enough to be killed.

Both backends share the `json.get/set` helpers for typed JSON read/write. Don't reach for MMKV or Zustand — the persistent layer is small, performance is fine for the planner/shopping use cases, and divergent state-management patterns aren't worth it.

## Conventions

- **No `load_dotenv` in modules.** Only `app/main.py` calls it. Modules read settings via `app.core.config.settings`.
- **OpenAI client construction** is centralized in `app/core/llm.py::get_openai_client()` — don't re-implement the env-key check + `AsyncOpenAI(...)` constructor anywhere else.
- **Layering:** routers (`app/api/*`) stay thin; orchestration in `app/services/*` (real services like `shopping_service`, `storage_service`, `store_product_service`, and `weee_scraper`; `store_scraper` is a temporary compatibility facade); SQL in `app/db/repo_*.py`; general Pydantic models in `app/models.py`; the cohesive cooking-session contracts/state machine live in `app/cooking.py`; SQLAlchemy lives in `app/db/models.py`. Don’t import session/engine into services or models. Reusable Pydantic types shared by routers live in `app/api/_types.py`.
- **All recipe / meal-plan queries scope by `user_id`** (multi-tenant). Repos enforce this — never query `RecipeModel`/`MealPlanModel` directly without it.
- **Recipe IDs are app-generated strings** (`uuid.uuid4().hex` from extract or random UUID from copy); user IDs are real `UUID(as_uuid=True)`.
- **Frontend pages use plain CSS classes** from `apps/web/app/globals.css` (Material/Stitch-inspired palette + Material Symbols icons), not Tailwind. Some inline `style={{}}` objects are sprinkled in; Tailwind utility classes are **not** configured.
- **i18n:** all visible web strings go through `useT()` and `MESSAGE_MAP` from `@cooking/shared` (loaded from `packages/shared/src/messages/{en,zh}.json`). Two-language toggle (English/Chinese) lives in `lib/i18n.tsx`.
- **Privileges:** configure immutable account IDs on the server. Web navigation consumes the `is_admin` capability from auth responses; never reconstruct privileges from an email or client-side allowlist.
- **Mobile design system rule:** no raw hex codes outside `apps/mobile/src/theme/`. Feature code imports from `../../theme` (or however many `..`s); the linter check is `grep -rE "#[0-9a-fA-F]{6}" apps/mobile/src/{features,navigation,components}` returning hits only inside `theme/` (none everywhere else). Same goes for typography — use the `typography` presets, not ad-hoc `fontSize`/`fontWeight`.
- **Mobile typing:** all `ParamList`s live in `apps/mobile/src/navigation/types.ts`. Use `CompositeScreenProps` for screens that need to navigate across nested navigators (e.g. a Library tab screen pushing `ImportModal`, which is on the Root stack).

### Recipe page transition and ordering

My Library and Public Library retain separate pagers, errors and explicit retry controls; catalog loading is lazy. Failed refresh retains loaded cards and pagination, and only successful catalog refresh clears optimistic copy markers. Search/refresh/unmount generations suppress stale results. Empty libraries lead to import/manual creation.

Current web/mobile Library, public/friend libraries, planner pickers and cooking pickers use `{items,next_cursor}` summary pages. Summaries carry title/image/tags/time, ingredient/step counts and caller-scoped `already_saved`; instructions, ingredients and private import text are detail-only. Search is a literal case-insensitive title substring; multiple tags use AND semantics, including existing legacy-category fallback. More results require a user action; refresh/search changes invalidate older in-flight pages. Planner, shopping and planned cooking fetch only referenced recipe details with at most four concurrent detail requests, so recipes outside the first page still resolve.

Web planner load failures, including failed referenced-recipe detail reads, disable changes and expose the existing retry control. A failed load never publishes an empty planner fingerprint; retry restores saved slot IDs and revisions before editing resumes.

Cursors are signed and bound to caller, library and normalized filters. Database ordering is a bounded lower-title prefix, the complete lower-title and ID; full titles break prefix ties. Prefix indexes allow existing long Unicode titles and PostgreSQL incremental sort, while `(user_id,catalog_source_recipe_id)` supports per-row copy state without reading the caller's library. Pages use current committed visibility: newly inserted earlier rows appear on refresh; renamed rows may move across the cursor, so clients deduplicate IDs. There is no snapshot/total-count promise.

The three old array endpoints are deliberately untruncated and OpenAPI-deprecated for older installed mobile releases. They remain an unbounded compatibility liability; current client pagination does **not** establish bounded cost for older clients. Remove or add explicit guards only after communicating and enforcing a minimum supported client version. No retirement date is asserted here.

## Known cleanup targets (carry forward across sessions)

These are tracked here — not in commit messages — so each session can pick them up:

- `LEGACY_LIBRARY_CATEGORY_TO_TAG` and the dual `library_tags` / `library_category` columns: once we backfill all rows so `library_tags` is always populated, drop the `library_category` column + the legacy mapping + the `getRecipeTags` fallback branch.
- `apps/web/app/globals.css` is ~88 KB. Worth a sweep for orphaned selectors, but only after the next round of UI changes — not blind dead-CSS hunting.
- `cache_warmer_queries.py::ALL_QUERIES` (405 exact queries from 390 curated source terms) — audit full-run duration plus production hit, empty-result, and match-quality logs before expanding further; prune consistently unused or noisy queries instead of raising the reviewed 405-query ceiling without evidence.
- `apps/web/.env.local` is committed to disk locally and contains `NEXT_PUBLIC_API_BASE=http://localhost:8000`. It is gitignored, so this is fine, but the `.env.local.example` should remain the source of truth for new clones.
- **EAS dev-build verification (deferred):** the SDK 52 → 54 upgrade was validated via `tsc --noEmit` + a successful Metro bundle compile, but `eas build --profile development --platform ios` was not run. Do that whenever you next have ~20 minutes to wait on a build, to confirm cloud builds still produce a working dev client.
- **`@react-navigation` v6 → v7 (deferred):** mobile is on `@react-navigation/native@^6.1.18`, `@react-navigation/native-stack@^6.11.0`, `@react-navigation/bottom-tabs@^6.6.1`. v7 is the current line; v6 still works on RN 0.81 + React 19 but won't get new features. Bump as a separate focused session — types tighten between v6 and v7 and most `ParamList` definitions need a sweep.
- **Smoke-test the mobile app on real hardware:** the SDK 54 upgrade unblocks Expo Go for non-native-extension surfaces on a physical phone (App Store Expo Go is SDK 54-only). The Share Sheet cannot work in Expo Go and must be checked in a custom development/EAS build. Run a full LAN pass to confirm planner bottom-sheet animations, smart-list reorder, image upload, and—in the custom build—shared YouTube/TikTok URL prefill under the New Architecture (Reanimated v4). The simulator passed but the bottom-sheet is the highest-risk area under New Arch.
- **`@gorhom/bottom-sheet` was force-bumped 5.1.1 → 5.2.13** during the SDK 54 upgrade (auto-resolved during `expo install --fix`). Watch for animation regressions over a few days; if anything feels off in the planner picker, that's the place to look.
- **Remaining mobile i18n coverage:** mobile already has `apps/mobile/src/lib/i18n.tsx` with `I18nProvider` / `useT()`, persists `cooking-ui-language`, and exposes the English/Chinese toggle in Profile. Tutorial, navigation, and core account surfaces use the shared message catalog, but some legacy/development-only mobile strings remain hard-coded. Migrate those strings to `useT()` as their screens are touched.
- **EAS submit credentials:** `apps/mobile/eas.json::submit.production.ios` has `REPLACE_WITH_*` placeholders for `appleId`, `ascAppId`, and `appleTeamId`. Fill these in before the first `eas submit -p ios`.

## Updating this file

Update the affected sections **in the same change** when you:

- Add/rename/remove an HTTP route (update the API table)
- Change an env var or its semantics (update `.env.example` *and* the Deployment section if it affects prod)
- Change an ECS task definition env var, image tag, or hostname (Deployment section)
- Change Vercel project settings or the Vercel build env (Deployment section)
- Add a sessionStorage / localStorage key, or change one
- Add a new package under `packages/` or a new app under `apps/`
- Add a feature surface to the mobile app that didn't exist before — update the `apps/mobile` bullet's surface list and the Mobile structure / storage conventions sections accordingly
- Change `apps/mobile/eas.json` build profiles, bundle identifier, deep-link scheme, or the SDK version
- Change the mobile theme tokens (any file under `apps/mobile/src/theme/`) or add a new component primitive under `apps/mobile/src/components/`
- Add a `persistent` or `ephemeral` storage key in `apps/mobile/src/lib/storage.ts`
- Move LLM prompts/models, change cache TTL/version, or change scraper concurrency
- Add a recipe tag slug (three places noted above)
- Touch admin gating, catalog gating, or any other auth/authorization rule
- Resolve or add to the "Known cleanup targets" list


### RedNote links and incoming website shares (September 24 release)

The website preserves the existing editorial Import layout and manual recipe creation. Source tabs are Video link, Upload video, and Paste recipe text. The URL field accepts full RedNote share messages as well as YouTube/RedNote links. Upload availability and maximum size come from `/recipes/import-capabilities`; the application's current inline-media cap is 30 MiB. It uses the existing asynchronous `/recipes/import-jobs` and `/recipes/import-jobs/media` pipeline and draft/candidate review, not the older synchronous local video endpoint.

Public RedNote retrieval is restricted to explicit note/short-link/CDN hosts, bounded redirects and response sizes. Login-gated notes provide an upload/text fallback. Token-bearing retrieval URLs survive internal queue ingestion but saved recipe attribution is canonical and token-free. Accessible embedded RedNote videos pass through the existing Gemini media analysis and tutorial quality pipeline. This does not guarantee that every externally shared RedNote URL is retrievable.

Installed Android Chrome sites receive links/text or one MP4/MOV/WebM through the manifest and narrowly scoped `chefworld-share-sw.js`. The worker intercepts only multipart POST `/share-target`; it does not cache normal pages or API calls. Browser IndexedDB holds at most three pending entries/60 MiB, with each video capped at 30 MiB and incoming multipart body at 31 MiB. Entries become inaccessible after 15 minutes and are physically pruned on subsequent activation/read/share. Opaque IDs survive login, registration, and verification redirects; first authenticated reads bind entries to that account. Receiving never starts AI work. Import success/discard deletes the pending entry; errors permit retry. Safari on iPhone does not expose an incoming web share target; native app sharing remains a separate build/release.

### Video size limit (30 MiB update)

The per-file media cap is 30 MiB (shown as 30 MB), with a 31 MiB multipart request envelope on the media-import route and incoming website share target. Base64 encoding makes a maximum-size file 40 MiB, below Google's documented 100 MB inline payload limit. The former 14 MiB cap reflected the older 20 MB request budget. Media capabilities remain the client source of truth; native pickers receive the larger cap from the same endpoint. Per-account daily byte admission (50 MiB), temporary share storage (60 MiB including metadata), model settings, token budgets, deadlines, and recipe-quality behavior are unchanged. Two maximum-size shared files plus metadata may evict the older pending item under the existing storage policy.

### Import experience (September 25 release)

The web Add a recipe screen places the import form/preparation card beside visible manual creation. Preparation replaces the source form with an honest Add source / Prepare draft / Review flow, preserving cancellation and entered sources. During link preparation, a source-aware estimate at the top of the card shows YouTube at about 1–2 minutes and RedNote at around 3 minutes, with a reminder that larger videos can take longer and to keep the page open. English and Chinese copy are supported. Estimates describe the submitted operation; uploads and text recovery do not inherit a retained link's estimate. Draft review uses a compact positive notice below the editor heading. The shared `getVisibleImportWarnings` presentation helper deduplicates notices and hides internal completeness/action/evidence/timestamp diagnostics on web and mobile while retaining the raw review metadata. Specific missing information and source-access notices stay visible; web omits "Details to check" entirely when none remain. This warning cleanup is deployed on the website; mobile source requires a separate native release. Video/media results omit redundant video analysis; text/caption recovery retains it when available. Add recipe text opens within the current draft, includes the existing edited method as context, and requires Apply new draft or Keep current draft before replacement. Context never promotes generated timer metadata to source text. Cancel, failed updates, and late job completion preserve the original draft.

In the web import/manual editor, nonblank instruction edits receive local Estimated timers while clearing stale source evidence. The dedicated saved-recipe tutorial editor retains its explicit estimation workflow. Automatic totals follow edited steps unless a user-entered total or a distinct initial total overrides the calculation. No extra model call, new schema, or migration is introduced. These changes are deployed in the September 25 import experience release; see the production context above.

### Recipe source editing

The owned web recipe editor offers Add link / Edit link in Sharing & source for every account. Save link immediately patches only `source_url`, preserving unsaved title, ingredients and tutorial edits. Attribution accepts safe HTTP(S) URLs independently of the supported video-import providers. Public catalog and friend source recipes stay read-only.
