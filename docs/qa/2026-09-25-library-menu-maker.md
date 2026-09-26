# Library menu maker — implementation and verification

Historical local-feature record. The subsequent [daily-limit integration and release record](2026-09-26-menu-release.md) supersedes the integration boundary and adds server-admitted menu sessions.

Status: implemented and locally verified on an isolated feature branch. Native PDF sharing still requires an on-device check. No production deployment is included.

## Experience

Open **My Library → Make a menu**. Choose individual recipes, **Select all** for the entire owned library, or **Select matching** for the current filter. Selection is separate from recipe navigation. Continue with at least one dish.

Choose Cozy café, French bistro, Garden table, Italian supper, Chinese teahouse, or Minimal modern. Edit the title, subtitle, dish names/descriptions, and sections. These edits belong to the menu; they do not update library recipes. Back to selection retains edits for retained dishes. Drafts exist only for the current session, reset on account changes, and warn before leaving with edits.

Each template works immediately without generating an image. An explicit artwork request uses the selected style and optional visual instructions (maximum 300 characters). AI decorates the page; recipe names remain editable text. A generated candidate replaces accepted artwork only after **Use artwork**. Changing styles and text, previewing, and exporting use no image attempts.

Web can download each PNG page or open Print/PDF. Native creates and shares a Letter PDF, with printing as the fallback when sharing is unavailable. Long menus continue across pages. Menus do not include invented prices or allergen claims. There is no cloud draft storage or public menu link.

## Engineering contracts

- `packages/shared/src/menu` owns immutable draft helpers, six styles, font-measured layout, renderer protocol, self-contained preview, and script-free print HTML.
- Shared text runs place the same text on canonical baselines in preview, PNG, and PDF. Ordinary dishes remain together on one page; exceptionally long dishes continue without clipping. Generation and export are separate operations.
- Fonts are bundled in `packages/shared/assets/menu-fonts` with licenses and provenance: Inter, Source Serif 4, and Noto Sans CJK SC. Load bytes only when opening the maker and reuse them between edits. Font assets must be included in standalone web output and the native bundle.
- The browser preview validates source/channel/revision; the native bridge validates channel/revision. A late renderer response cannot unlock export for a newer draft. Documents contain embedded bytes, with no provider/auth credentials.
- Image recovery snapshots the original request ID/style/instructions and has a 90-second client deadline covering generation, authenticated file retrieval, and body reading. Automatic recovery reads status; explicit **Check again** may replay the exact original attempt after a missing status. RN cancellation does not depend on `DOMException` or `AbortSignal.reason`.
- `20260925_menu_artwork` follows `20260925_recipe_images`. Apply migrations before serving the feature. Legacy rows receive `purpose='recipe_cover'`; their hashes/results remain unchanged. Cover and menu purposes use the same image counters and membership entitlement, and a request ID cannot admit both purposes.
- New API routes: access, generation, result status, and authenticated PNG file under `/menus/artwork`. Only style and optional visual preferences are sent to the provider. Asset reads use recorded account-scoped local/S3 keys, bounded to 10 MiB plus one byte, without arbitrary URL fetching.
- Native modules: `expo-print`, `expo-sharing`, `react-native-webview`, and direct `expo-asset`. A rebuilt custom app is required for device verification; a JavaScript export alone does not prove native PDF sharing.

## Verification evidence

The task uses an isolated feature worktree and a disposable PostgreSQL database. Fixture tests and live provider checks are recorded separately. The source checkout's unrelated work is preserved.

Verification completed against the isolated feature tree:

| Area | Evidence |
| --- | --- |
| Shared drafts/styles and renderer | 229 shared tests; draft preservation, pagination, escaping, assets, and bridge revisions |
| Durable image admission | 33 focused SQLite tests; 9 PostgreSQL tests including simultaneous cross-purpose collision and last-allowance contention |
| Migration compatibility | Upgrade, downgrade, and re-upgrade preserve a seeded legacy digest and result fields |
| Artwork API/storage | 218 focused menu/image/API security tests; 80 new menu route/storage cases |
| Browser renderer | 4 final Chromium and WebKit checks pass; 4 Letter PDF pages and 1632×2112 PNG |
| Request recovery | 31 API-client tests including mutable caller payload and RN-like abort behavior; 15 focused web menu tests including stalled file/body recovery |
| Web application | Full final suite: 426 tests pass. Web TypeScript passes |
| Production output | Next production build passes; all five standalone font routes return bytes matching the source SHA-256, and unknown fonts return 404 |
| Built application browser flows | 26 passed, 4 existing viewport-specific skips across menu/library/image-generation suites; menu-only rerun after recovery fixes: 9 passed; final pagination/export rerun: 3 passed. Complete 42-dish PNG/PDF flow on phone, tablet, and desktop |

Independent reviews covered admission, API/storage, client recovery, rendering, both UIs, and final integration. Corrected findings include native cancellation portability, immutable recovery payloads, retaining accepted artwork during overlapping renders, React Strict Mode history cleanup, closing print windows during readiness, the complete 90-second artwork download/body deadline, the empty-library import shortcut, correct messaging for shared global image limits, and keeping ordinary dish names/descriptions together across PDF page boundaries. No recipe mutation or owner/purpose isolation issue was found.

The authenticated local API was also exercised directly with a synthetic 48-recipe library: Select all under a six-result search included all 48, Back retained custom title/subtitle/artwork, accepting generated artwork was explicit, and all original recipe names remained unchanged. A real browser download with eight English/Chinese dishes was inspected as a 1632×2112 PNG (1,507,142 bytes; SHA-256 `054828620d823ef86931b2ff402c1af308682c2143881d463f0186d6ab813ed7`). A 390×844 phone viewport had no horizontal overflow.

Browser fixture runs use the actual renderer, fonts, canvas, print document, and PNG/PDF output while mocking API responses. The separate local API check uses real authentication, PostgreSQL admission, and storage with reusable provider fixture bytes. The one real provider request is documented below. These evidence categories do not imply production verification.

Final exported PDF inspection confirms 4 pages at 612×792 points, all 42 dish names and their descriptions on the same respective page after NFKC text normalization, and no PDF JavaScript. Noto CJK extraction may use visually equivalent Kangxi radicals; normalization is used only for extraction assertions, not rendering.

Native verification: all 50 Jest suites / 392 tests pass, including 28 focused menu/library cases; mobile TypeScript passes. The iOS JavaScript export includes 1,861 modules and all five bundled fonts, including the full 16,437,364-byte CJK asset. The iOS bundle was re-exported successfully after the final shared pagination adjustment. A development simulator app compiled and installed successfully. These checks establish code/bundle/native-module compatibility, but actual native PDF sharing remains unverified as explained below.

## Environment limitations

The supplied reused Python environment cannot collect the unrelated video-import test module because its `youtube_transcript_api` lacks `AgeRestricted`. Task 2's remaining backend suite passed 564 tests with 16 skipped; 16 browser DOM tests passed separately. Do not treat this environment issue as a passing full backend suite.

The rebuilt iOS simulator app compiled successfully, installed, and launched on an iPhone 16 Pro simulator (0 build errors; one existing SDWebImage deployment-target warning). The local Metro startup encountered a sandbox port-scanning failure, and simulator UI inspection did not complete. Consequently no native PDF/share artifact was verified, and physical-device sharing remains unverified. Browser PDF output and native unit tests do not substitute for this check. A real provider request is recorded below. No production release or deployment verification has been performed by this task.

## Configured provider check

One real generation succeeded through the local authenticated menu API and disposable PostgreSQL database, using the existing application configuration (`gpt-image-2`). The provider returned HTTP 200 in about 15 seconds; status completed and the authenticated file route returned `image/png`. The resulting 1024×1536 artwork is 2,166,348 bytes (SHA-256 `14b774800e4ece095d6600001bca85d6aa363756636d0f98c1f368ab9494bcc2`). Visual inspection confirmed a text-free watercolor teacup, tomato, and gingham border on cream paper. No recipe text was submitted.

The check retained one request ID for idempotent recovery; it did not automatically retry with a new ID. Subsequent local UI fixture runs reuse those bytes without another provider request. This proves the configured local key/model path at this time; it does not verify a production deployment.

## Integration boundary

This feature was developed in an isolated snapshot of the user's working checkout (`5a7d252`), preserving unrelated source changes. A separate task later released equipment removal from source `8ec4dab`; that release also depends on newer import-job/language code absent from this snapshot. A read-only patch applicability check confirmed it cannot be copied wholesale into this baseline. No equipment or production state was changed by this task. Future release integration must apply the menu feature diff to the then-current application branch and preserve that release; do not deploy the old snapshot directly.
