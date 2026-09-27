# Menu studio revision — September 26, 2026

## User-facing change

The menu maker now supports three independent compositions: a food-photo grid, a category board, and an illustrated dish list. Users can choose columns, spacing, palette, heading/body type, photo shape, section treatment, decorations and illustration placement. Dish names, descriptions, optional prices and badges remain editable; hiding descriptions preserves them. Web users can upload or remove dish photos without changing library recipes.

A creative brief produces a validated AI design proposal. Applying it is explicit and preserves selected dishes and concurrent text edits. AI artwork is a separate, explicit image-generation action, with the proposed art direction and layout included in the immutable request snapshot. Existing artwork recovery and acceptance are preserved. The one-new-menu-per-UTC-day admission remains unchanged for non-admins; admin creation is unlimited, with existing AI/image monetary and operational controls retained.

## Implementation boundaries

- `POST /menus/designs` requires an existing owned menu creation and uses the application's existing text-AI budget, lease, deadline and cost ledger. One click is one attempt; there is no automatic repair or replay after an ambiguous failure. The schema allows presentation data only.
- Legacy artwork requests retain v1 hashes. Optional design snapshots use versioned v2 hashes and centered art crops; an old request UUID cannot silently generate a changed design.
- `GET /menus/recipe-images/{recipe_id}` serves only the current owned recipe's recorded active owned image. It does not proxy arbitrary URLs. Web's optional original-thumbnail fallback uses credentialless HTTPS browser CORS, and failure leaves upload/retry available.
- Photos are normalized to bounded 512px PNG pixels for preview/export. Auth changes and cancellation suppress late bytes. Images and menu drafts are session-only; native photo loading uses a network-disabled WebView normalizer.
- Shared measured geometry drives SVG preview, PNG and print/PDF. Six local export fonts include a playful Chinese/Latin heading face. Renderer contrast is resolved per actual text surface, including manually chosen palettes.
- Native source parity does not publish an iOS/Android binary. Native currently uses library photos, without a separate menu-only photo picker.

## Verification before release

- Backend full suite: 1,230 passed and 122 environment-gated tests skipped; 16 browser fixtures could not launch Chromium inside the sandbox. Rerunning their complete scraper file with browser permission passed all 64 tests, covering those 16 failures. The focused PostgreSQL design/accounting/photo contract also passed.
- API client: 64 tests passed, including bounded requests and complete artwork snapshot replay.
- Web: 709 tests passed, including 71 menu tests and explicit design application, edits made during generation, cancellation, account changes, malformed designs, photo byte/pixel limits and upload/removal races.
- Native: 54 suites / 396 tests and TypeScript passed. The exact network-disabled normalization HTML decoded real PNG/JPEG/WebP fixtures to bounded PNGs in a browser.
- Shared renderer: 358 tests passed; checked generated runtime and TypeScript, all three layouts, photo pixels, artwork cropping, print parity, long content, CJK and reversible description visibility. Nine browser cases (three layouts with normal, extreme-color and no-art designs) also passed. Wrapped headings use one continuous label; category dishes share one panel; unused artwork space is reclaimed.
- Browser: 16 desktop/phone scenarios passed. Tests covered complete-library selection, daily admission/admin exemption, photos including previously photo-less uploads, prices/badges, all three compositions, AI proposal apply/cancel, image generation acceptance, PNG and PDF. Test data and provider responses were fixtures, not production writes or new paid-provider calls.
- Browser evidence: `/private/tmp/menu-studio-web-qa`; shared renderer evidence: `/private/tmp/chef-menu-studio-renderer-20260926`.

## Design artifacts

`docs/design/menu-studio-20260926` contains generated visual concepts and a written design direction. These are explicitly labeled concepts. Figma account access succeeded, but the Starter MCP call limit prevented canvas authoring, so the allowed image-generation alternative was used. The empty Figma file is not a delivered design.

## Release status

Production source identity and release gates will be recorded after deployment. The current deployed Muse shopping revision is included before source freeze to preserve concurrent production changes. New menu endpoints require backend deployment before web promotion. No new migration or production configuration is required by this revision.
