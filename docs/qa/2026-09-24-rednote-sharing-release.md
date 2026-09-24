# RedNote and direct-sharing website release

User-authorized release: preserve the current editorial import UI, add manual video upload, and include RedNote in the URL option. Base is the live Gemini quality release `3911c5152c85febb39b724cfaee25be20c24001b`, API revision16 and Vercel `dpl_CN9EDdt5CXUJuhZLfLgrZZ4NBPJP`.

## Scope

- Existing title, tagline, manual recipe button, review/candidate flow, styling and layout retained. Tabs: Video link, Upload video, Paste recipe text. URL label: YouTube, TikTok, or RedNote URL; supports copied share messages.
- Media uses the existing asynchronous Gemini import job endpoint and its advertised14MiB cap. No model, prompt, budget, schema, migration or background-worker configuration changes.
- Public RedNote note/short-link retrieval with exact-host redirects and identity checks. Accessible CDN videos use bounded downloads and existing Gemini analysis. Login-gated posts explain the manual-video/text fallback. Retrieval tokens survive internal queueing and are omitted from saved attribution; terminal jobs clear private payloads.
- Installed Android Chrome web share receiver; locally staged, account-bound payload through login/registration/email verification; no automatic extraction or save. Generic file MIME normalized to a recognized extension before backend byte-signature validation. Normal pages/API responses are not cached.
- Privacy copy updated for media processing and temporary browser storage. iPhone system-share reception still requires a native app build; this release is the website.

## Verification before frozen artifacts

- Full web suite:503 passed, plus the expanded auth-redirect file5/5 (two additional tests).
- Shared package and API-client suites passed; web TypeScript and production build passed.
- Independent review found two issues (generic shared-file MIME, copied YouTube/TikTok share-text normalization); both reproduced with failing tests, fixed and verified.
- Desktop and phone browser scenarios exercise manual media upload, copied RedNote text, real service-worker+IndexedDB handoff through sign-in, deletion, and title-field Android shares. API results are mocked; real-device OS share-sheet operation remains unverified.
- Backend focused suite249 passed, including actual isolated fetch-worker serialization and PostgreSQL queue/token cleanup. Full database-enabled suite and final browser results recorded in deployment follow-up.

## Release gates

Freeze only the isolated release checkout; fresh immutable backend and web builds, runtime checks, locked migration, exact-digest ECS rollout, production health/readiness/CORS and bounded error scan; stage the exact frontend, verify it, then promote. Preserve API16 as rollback reference (older15 cannot handle the quality release's nullable step durations). Preserve existing Gemini credentials/settings and worker revision2. Do not touch existing accounts or recipes in smoke tests; any disposable fixture must be owned, private and removed.

Direct RedNote URL extraction remains conditional on public access; receiving a share link does not grant access to its underlying video. No login bypass or third-party resolver was added.
