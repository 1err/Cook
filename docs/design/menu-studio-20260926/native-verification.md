# Native menu studio verification — 2026-09-26

The native editor source now shares the three menu compositions, typography (including the bundled playful font), spacing, columns, photo masks, section treatments, artwork placement, description visibility and AI design contract with the web editor. Palette changes preserve the composition. Prices and little labels are editable per dish. AI proposals require explicit acceptance and retain edits made during generation.

Photos come from authenticated owned image receipts, with a public HTTPS fallback only for receipt-not-found responses and no forwarded authorization. A separate local WebView converts validated PNG/JPEG/WebP/GIF bytes into PNGs with a maximum 512 px edge. Its document blocks network and file access. Image work is bounded and aborted when selection or account session changes. The preview and print document reserve photo space only for successfully decoded assets. The native editor does not yet provide the web editor's standalone per-dish upload picker; a dedicated localized hint explains image failures without promising that control.

Verification on the current revision workspace:

- Mobile TypeScript check: passed.
- Complete mobile Jest suite: 54 suites, 396 tests passed. Log: `/private/tmp/menu-studio-mobile-final.log`.
- Native menu tests include delayed AI proposals, preservation of concurrent text/price/label edits, admission ID reuse, independent design controls, image cancellation, image-byte validation, bridge message matching, account changes, quota guards and export invalidation.
- Real local Chrome execution of the exact converter HTML passed PNG, JPEG and WebP decoding and normalization. A 1200 × 600 test image in each format produced a valid 512 × 256 PNG. The browser used synthetic test pixels and no external network requests. GIF signature acceptance is covered by the implementation, but a live GIF decode was not exercised by this browser check.
- Diff whitespace check passed.

These checks verify native source and the shared local rendering document. No iOS/Android binary was built or published, and device-native sharing remains a separate validation step.
