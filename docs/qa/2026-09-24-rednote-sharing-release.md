# RedNote and direct-sharing website release

The user authorized publishing the existing editorial import UI with manual video upload and a YouTube, TikTok, or RedNote URL option. Application source is `51a93a0e2908702ba76fba752d6a77aa0e6b2dd8`, based on the deployed Gemini quality release `3911c5152c85febb39b724cfaee25be20c24001b`. The user assigned extraction-quality work to a separate task; this release preserves that implementation.

## Production release

- API: `cooking-backend:17`, immutable image `sha256:1beb7ccf9b1423a7f11eff251c0103875f5868b7c0cac00d0698d1549cae134c`.
- Website: `dpl_BDUk8YxXyLSmF41rwg8TGU15roGi`. Promotion verification confirms both `chef-world.com` and `www.chef-world.com` point to this deployment from the same application source.
- Worker: `cooking-store-worker:2`, unchanged.
- Previous release: API `cooking-backend:16` and website `dpl_CN9EDdt5CXUJuhZLfLgrZZ4NBPJP`.
- Final public import-page GETs returned HTTP 200 on both domains; `www.chef-world.com` redirects to the apex domain. Final API health/readiness checks also returned HTTP 200. Live browser checks passed on desktop and phone viewports, as detailed below.

## Scope

- Existing title, tagline, manual recipe button, draft review/candidate flow, styling, and layout retained. Tabs are Video link, Upload video, and Paste recipe text. The URL label is YouTube, TikTok, or RedNote URL; copied share messages are supported.
- Media uses the existing asynchronous Gemini import job endpoint and its advertised 14 MiB cap. No extraction model, prompt, schema, migration, budget, or worker configuration was changed.
- Public RedNote note and short-link retrieval uses exact-host redirect and note-identity checks. Accessible CDN videos use bounded downloads and the existing Gemini analysis pipeline. Login-gated posts explain the manual-video/text fallback. Retrieval tokens survive internal queueing and are removed from recipe attribution; terminal jobs clear private payloads.
- Installed Android Chrome websites can receive links or video files through Web Share Target. Shared content stays in temporary, account-bound browser storage through sign-in, registration, and email verification; extraction and saving still require user actions. Generic file MIME types are normalized from recognized extensions before backend byte-signature validation. The service worker does not cache ordinary pages or API responses.
- Privacy copy covers media processing and temporary browser storage. iPhone system sharing still requires a native app build; this deployment is for the website. Real-device OS share-sheet operation remains unverified.

Sharing a RedNote link does not grant access to the underlying video. Link extraction remains conditional on public access; no login bypass or third-party resolver was added.

## Local and staged verification

- Full web suite: **505 tests passed**. Shared package and API-client suites, web TypeScript checks, and the production build passed.
- Full database-enabled backend suite: **1,001 tests passed, 6 skipped**. Focused coverage includes isolated fetch-worker serialization, PostgreSQL queue processing, canonical attribution, and token/payload cleanup.
- **Eight staged browser scenarios passed**, covering desktop and phone layouts, manual video upload, copied share text, and actual service-worker/IndexedDB handoff through authentication, deletion, and Android title-field links. API responses were mocked in these browser scenarios.
- Independent review reproduced two failures before fixing them: generic shared-file MIME handling and copied YouTube/TikTok share-text normalization.
- Fresh backend and website images were built from frozen committed source. Runtime checks passed, including the website manifest, share worker and icons, production API configuration, and execution as a non-root user. These are build/runtime checks, not evidence that every live extraction result meets the quality target.

## Production API and configuration verification

Read-only checks confirmed the expected AWS account, exact revision/image, health and readiness HTTP 200, authentication requirements on protected import routes, and production CORS. Final target-drain verification found one healthy target matching the current task, zero draining targets, and no old target.

The final post-promotion HMAC comparison found no changes to task configuration apart from the API image, environment variables, secret references, all eight Gemini settings, AI budgets, or service configuration. Worker revision 2 and its image remained unchanged. Only fingerprints and nonsecret release metadata were retained; raw settings were not saved by this check.

The initial bounded post-rollout log scan had no warnings, errors, tracebacks, HTTP 5xx responses, or unavailable import workers. A later live smoke encountered a provider 503, recorded below; the initial clean scan does not cover that subsequent event.

## Final production website checks

The live site passed browser checks at 1440 × 1000 and 392 × 852: all three import tabs, the three-provider URL label, manual recipe creation, selected-file upload readiness, and the 14 MB limit were present. Neither viewport overflowed horizontally. The real service worker registered, activated, and controlled both live-origin pages. Its SHA-256 matched the released worker; `Cache-Control: no-cache, no-store, must-revalidate` and `Service-Worker-Allowed: /` were verified. The live manifest declares the expected multipart share target, and the import page, manifest, and worker returned HTTP 200.

Browser authentication and recipe API responses were mocked; these checks made zero import requests and no account writes. They verify the deployed interface and worker, not live extraction quality or the physical Android/iPhone share sheet. Evidence and screenshots are `/private/tmp/chef-rednote-live-proof/report.json`, `desktop-source.png`, and `phone-upload.png`.

## Live media smoke and its limits

Testing used an owned 286,072-byte synthetic Chinese MP4, uploaded temporarily to an owned S3 key, and disposable verified private accounts. The 36-second H.264/AAC fixture contains three numbered recipe cards. Local container inspection and complete audio/video decoding passed.

The first actual multipart upload was admitted, but Google's `countTokens` request returned HTTP 503. Its job failed; its account and private data were removed. One later smoke task failed before script startup, creating no account or import job. A subsequent controlled attempt completed the asynchronous upload-to-draft flow in 17.59 seconds overall. Both `countTokens` and `generateContent` returned HTTP 200 for each of the two analysis passes; that attempt's provider log window contained no warnings.

The completed draft passed the assertions executed before the quality threshold: exact canonical RedNote attribution without the synthetic share token, a nonempty title, and at least three nonempty Chinese ingredient names. It then failed `tutorial_not_granular`, which required a step list with between four and 100 entries. The fixture itself presents three numbered cards. This failure does not establish the returned step count or prove tutorial completeness.

**The full live quality/save smoke did not pass.** Chinese title/step-language assertions, media-review/provenance checks, detailed duration checks, the no-automatic-save database assertion, ledger assertions, and private recipe saving were after the failing threshold and were not reached. Do not report those checks as passed on this release. The upload-to-draft feature was accepted within this task's scope while the failed tutorial-detail criterion remains an explicit quality follow-up. No extractor or quality setting was changed to satisfy the smoke.

Both accounts created by running smoke scripts were deleted through the account API. Independent cleanup checks found zero remaining private fixture rows and zero in-flight leases. The synthetic S3 video was removed. Minimal billing-audit rows remain intentionally: one from the initial failed attempt and two from the completed-draft attempt. No existing account or recipe was accessed, and no email was sent.

## Compatibility and retained evidence

The existing `20260924_video_import` migration and nullable cooking durations remain intact. API 16 is the prior compatible release reference; API 15 cannot safely read the quality release's new null-duration sessions. Prefer roll-forward and recheck live state before any further release.

Sanitized operational evidence is retained under `/private/tmp/chef-rednote-release-20260924`: `production-api-verification.json`, `production-target-drain.json`, `web-runtime.json`, `media-smoke-log-diagnostic.json`, `media-smoke-retry-log-diagnostic.json`, `release-acceptance.json`, `vercel-promoted.json`, and the original smoke result files. The acceptance record distinguishes completed upload-to-draft verification from the failed full quality smoke. Final production browser evidence is recorded separately in `/private/tmp/chef-rednote-live-proof/report.json`.
