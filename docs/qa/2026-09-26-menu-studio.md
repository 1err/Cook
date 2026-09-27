# Menu studio revision — September 26, 2026

## Customer changes

Users can select individual recipes or their complete library and create an editable restaurant menu. Three compositions—photo grid, illustrated list, and category board—support columns, spacing, colors, heading/body type, photo shape, section treatment, decorations, and artwork placement. Names, descriptions, optional prices, and badges remain editable. Hiding descriptions preserves them; menu edits do not change saved recipes.

A creative brief produces an AI design proposal that users explicitly apply or discard. Decorative artwork is a separate generation and acceptance action. Recipe photos can be supplemented or removed in the web menu editor. Wrapped section headings share one continuous label, category dishes share a panel, and menus without accepted artwork reclaim that space. Preview, PNG, and print/PDF use the same measured geometry and six bundled fonts; contrast is adjusted for the actual text surface, including manual colors.

Non-admin users may start one new menu per UTC day. The first Continue admits the session; same-ID retries, Back, edits, and exports do not count again. Administrators are exempt from menu creation limits. Existing AI/image rate, money, storage, and global controls still apply.

## API and privacy boundaries

- `POST /menus/designs` requires an existing owned menu creation and uses the existing text-AI budget, lease, whole-operation deadline, and cost ledger. One explicit attempt makes one provider call. Ambiguous failures and invalid model output do not trigger automatic replay or repair. The model receives visual preferences and content counts; dish text remains editable locally.
- Legacy artwork requests retain their v1 hashes. Design snapshots use versioned v2 hashes and centered artwork crops. A reused request UUID cannot silently generate a different design.
- `GET /menus/recipe-images/{recipe_id}` serves a current owned recipe's active owned-image receipt and never proxies arbitrary URLs. Web may try the exact original HTTPS thumbnail through credentialless browser CORS after a 404; unavailable images leave upload/retry available.
- Export photos are normalized to bounded 512px PNG pixels. Cancellation and account/source changes suppress late results. Drafts and photos are session-only. Native uses a network-disabled WebView normalizer and existing library photos; it has no separate menu-only photo picker.
- This revision adds no migration or production setting. The existing migration head remains `20260926_menu_creation`.

## Source and production identity

Backend application source: `7205a263d0f10eabbb2f11e5b05a4edf6bb2ba92`. It includes menu source `77161e6ab704a7db8d1c5ed73cca39bb168a261f` and the already-live shopping alias/mixed-garlic source `b3260bd2d1f4ce04b0bb35632dfa62c7c3db65b8`. Relative to 77161, only `CLAUDE.md`, the shopping service, and its alias tests changed; app/package and menu contract sources are unchanged.

Combined frontend application source: `1d41d23f13238bbda5d64c4aa9ac5849b2b528c6`. It descends from 77161 and includes the coordinated navigation, public recipe preview, cooking typography, Muse review, and menu integration work. Backend and frontend source SHAs intentionally differ and are verified independently.

| Deployment fact | Final verified value |
| --- | --- |
| API task definition | `cooking-backend:28` |
| Published and running API digest | `sha256:0c10673e9a9e7e36e22a834b84707232c1ec61908e0564e9fecf99a20e5bac80` |
| Backend source | `7205a263d0f10eabbb2f11e5b05a4edf6bb2ba92` |
| Vercel deployment ID and URL | `dpl_Dv3G4yHEtL8BgsMZNgPiVv54egG8` — [deployment](https://cook-ir0aa53dc-jerrys-projects-08f739a2.vercel.app) |
| Frontend source metadata | `1d41d23f13238bbda5d64c4aa9ac5849b2b528c6` |
| Both public aliases identify READY candidate | Passed: `chef-world.com` and `www.chef-world.com` both identify the exact READY deployment |
| Worker task/image unchanged | Passed: `cooking-store-worker:2`, original task/image fingerprint unchanged |

The backend fresh-build, published ECR, runtime-tested, and independently verified running image all match `sha256:0c10673e9a9e7e36e22a834b84707232c1ec61908e0564e9fecf99a20e5bac80`. API deployment `ecs-svc/8835753532233353033` completed successfully. The fresh frontend image manifest is `sha256:f954ddc5b96d5bfad87d5c8bca9dcd2727e3fa416a45ddc14f7f54ca9be5fd15`.

## Verification

- Final backend suite: **1,255 passed, 122 environment-gated tests skipped**, with real Chromium available. The earlier sandbox launch failures are superseded by this complete passing run. The focused PostgreSQL design/accounting/photo contract also passed.
- Shared renderer: **358 tests passed**, generated runtime and TypeScript checked. Nine real-browser cases cover all three layouts with normal, extreme-color, and no-art designs; checks include PNG photo pixels, artwork crop parity, print assets, text bounds, and reversible description visibility.
- API client: **64 tests across 13 files passed**, including bounded requests and complete artwork request snapshots.
- Native: **396 tests across 54 suites passed**, with TypeScript checked. The exact network-disabled normalization HTML decoded PNG/JPEG/WebP fixtures to bounded PNGs in a browser. This is source/runtime evidence; no native binary or OTA update was distributed.
- Combined frontend: **740 tests across 87 files passed**, with TypeScript checked. Its exact source upload manifest contains **262 files, six menu fonts, and 24,855,635 bytes**; discovered upload paths and hashes match the frozen allowlist.
- Local browser coverage includes the 10 desktop/phone menu-maker cases and the six menu-studio cases. The final six-case studio rerun passed after renderer polish. Flows cover full-library selection, daily admission/admin exemption, photo upload/removal, prices/badges, three compositions, AI apply/cancel, artwork acceptance, and PNG/PDF. Provider and account responses are fixtures.
- Fresh backend image runtime: **passed** for source 7205 and the exact published/running digest; all 146 application/migration/dependency/certificate/build hashes matched, all fixture contracts and six containment cases passed, graceful shutdown exited 0 without OOM, and both disposable containers plus their network were removed. The checks include locked fresh/repeat migrations, menu quota/design/photo contracts, cost reservations and lease cleanup, containment, graceful shutdown, and disposable-resource cleanup.
- Fresh frontend image runtime **passed** for source 1d41: production API configuration, required old/new feature markers, six exact font byte hashes/MIME/nosniff headers, and unknown-font rejection.
- Final production API: **passed** at 2026-09-27 04:35:02 UTC: exact completed API 28/source/digest, one healthy `/ready` target, `/health` and `/ready` 200, protected routes 401 including `POST /menus/designs` and the owned-photo route, production CORS, and unchanged original configuration. Complete bounded API/worker logs from 04:32:22 to 04:34:59 UTC contained 58 API events and no worker events, with zero warnings, errors, critical events, tracebacks, HTTP 5xx, or unavailable-import-worker events.
- Hosted candidate browser QA: **16 menu cases and 10 coordinated UI cases passed** across desktop and phone against the candidate. Export verification passed for the generated 1632×2112 PNGs and Letter PDFs, including selected English/Chinese dish text and one-page/three-page menus. Public export checks after promotion: **14 direct public cases passed**: four full menu/export cases plus ten UI cases across desktop and phone; no unexpected, flaky, or skipped cases.
- Staged/public assets and fonts: **10 routes, 38 script/style assets, and all six font files passed**; public asset bytes match the verified candidate. Bounded Vercel error/fatal/5xx observations: zero error, fatal, or HTTP 5xx records in the complete bounded 15-minute scan ending 2026-09-27 04:36:19 UTC.

The original configuration fingerprints were retained across the concurrent API 27 shopping release, with no recapture to hide differences. The pre-release comparison confirmed unchanged credentials, budgets, all eight Gemini settings, service configuration, and worker 2. Final preservation result: **passed**, with no fingerprint differences; credentials, budgets, eight Gemini settings, service configuration, and worker 2 remain unchanged.

No authorized production-account session or new paid-provider generation is claimed by these checks. Hosted fixture tests verify actual deployed frontend behavior with controlled API responses; they do not prove live account quota consumption or AI artwork quality.

## Evidence and rollback

Backend release evidence: `/private/tmp/chef-menu-studio-api-final-20260926`. Combined frontend evidence: `/private/tmp/chef-ui-menu-final-20260926`. Local browser evidence: `/private/tmp/menu-studio-web-qa`; renderer evidence: `/private/tmp/chef-menu-studio-renderer-20260926`.

Rollback API is `cooking-backend:27`, source `b3260bd2d1f4ce04b0bb35632dfa62c7c3db65b8`, digest `sha256:e04791690435b75ff77c28a8269ac660f2c3b382e065f3725b124f6a83666676`. The recorded pre-promotion website is `dpl_8RRp3oikT3Z1neEPXSnsdyHVvEhX`, source `6e10d04c4b78df2fa099235ea8dc2b70101ed99e`. Recheck live identities before an intentional rollback. Image rollback does not reverse database changes.

## Design artifacts

`docs/design/menu-studio-20260926` contains explicitly labeled generated concepts and written design direction. Figma authentication succeeded, but its Starter MCP call limit prevented canvas authoring; the permitted image-generation alternative was used. The empty Figma file is not a delivered design.
