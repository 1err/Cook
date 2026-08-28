# Video Import Reliability Design

**Status:** Approved in chat on 2026-08-28

## Goal

Make recipe import dependable for public YouTube links, accept TikTok links from both pasted input and the native iOS Share Sheet, and always lead to the existing editable recipe preview when the available source text is sufficient.

## Success Criteria

- A public YouTube video with usable captions produces an editable recipe draft instead of the current deterministic 422 failure.
- Canonical, shortened, mobile, embed, Shorts, and Live YouTube URLs are recognized without accepting lookalike hosts.
- Canonical and shortened TikTok share URLs are recognized without accepting lookalike hosts.
- A TikTok post whose public no-key metadata contains useful caption/description text can produce an editable recipe draft.
- A TikTok post without enough public text returns a clear, recoverable explanation that spoken-video transcription is unavailable in this no-extra-credential build and preserves the link for retry or transcript entry.
- The web and mobile import screens describe the input as a YouTube or TikTok video link.
- Sharing a supported URL to Chef World on iOS opens the authenticated import modal with the URL prefilled.
- The existing review-before-save boundary remains unchanged: parsing never persists a recipe, and only the user-reviewed `POST /recipes` request saves it.

## Constraints

- Do not add a paid or key-gated video transcript provider in this iteration.
- Do not download YouTube or TikTok audiovisual media, run `yt-dlp`, or claim arbitrary TikTok speech transcription.
- Continue using the existing production `OPENAI_API_KEY` only for the recipe-structuring call already owned by `backend/app/extract.py`; no new key is introduced.
- Preserve cookie auth on web, bearer auth on mobile, the current Recipe response contract, and the existing import review UI.
- The iOS Share Sheet requires a native custom development or EAS build. Expo Go cannot contain the extension target.
- No Android share-target work is required in this iteration, although pasted TikTok/YouTube links must work on Android.

## Architecture

### 1. Provider-neutral source parsing

Create a focused backend source module that parses a submitted URL with `urllib.parse`, validates HTTPS and an allowlisted host, and returns a `VideoSource` value containing:

- `provider`: `youtube` or `tiktok`
- `canonical_url`: normalized URL used as recipe provenance
- `external_id`: the YouTube video ID or TikTok post ID when it is present in the submitted URL
- `original_url`: the trimmed URL supplied by the user

YouTube matching accepts `youtube.com` subdomains that are explicitly enumerated (`www`, `m`, `music`), `youtube-nocookie.com`, and `youtu.be`. It supports `watch?v=`, `/shorts/`, `/live/`, `/embed/`, and shortened paths with an exactly 11-character video ID.

TikTok matching accepts `www.tiktok.com`, `m.tiktok.com`, `vm.tiktok.com`, and `vt.tiktok.com`. Canonical `/@creator/video/{numeric-id}` URLs expose the post ID. TikTok short links retain their validated original URL and let TikTok's official oEmbed endpoint resolve the post; the backend does not follow arbitrary redirects itself.

Any other scheme, credential-bearing URL, nondefault port, host, or malformed platform path is rejected before network access. This removes the current substring-based host spoofing issue.

### 2. Transcript and public-text acquisition

Define one `VideoTextResult` contract with `status`, `text`, `source`, `message`, `canonical_url`, `external_id`, `title`, and `thumbnail_url`.

For YouTube:

1. Pin `youtube-transcript-api==1.2.4` and use its instance API (`YouTubeTranscriptApi().list(...)`) so current discovery and typed blocking errors are available.
2. Prefer English and Simplified/Traditional Chinese, then fall back to the first usable transcript track rather than rejecting every other source language.
3. Join nonempty caption snippet objects, reject an empty result, and preserve typed outcomes for unavailable captions, unavailable/private video, server/IP blocking, and no transcript.
4. When YouTube exposes tracks but blocks the caption file, verify and use the public watch-page title/description as a lower-fidelity fallback; never claim that the video's captions are disabled based on a server-side block.
5. Run the blocking library and public-page calls in a worker thread so `/recipes/parse/link` does not block FastAPI's event loop.
6. Use the canonical video ID for the YouTube thumbnail URL and recipe provenance.

For TikTok:

1. Request TikTok's public no-key oEmbed endpoint with the already validated TikTok URL and a bounded timeout.
2. Validate the response shape and provider, then use its plain-text title/caption and thumbnail as public source material. Never execute or persist returned embed HTML.
3. Treat metadata text as sufficient only when it contains meaningful recipe content beyond creator attribution/boilerplate. The existing extraction model remains the authority for whether ingredients and procedural steps can be extracted.
4. If public text is empty or the resulting draft has neither meaningful ingredients nor steps, return a typed 422 response explaining that this TikTok needs a transcript. Do not return a fabricated placeholder recipe.
5. Run the blocking oEmbed request in a worker thread and map timeouts/upstream failures to a retryable 503 response.

The acquisition interface intentionally leaves room for a future managed transcript provider without changing the route or clients.

### 3. Draft extraction and route behavior

`POST /recipes/parse/link` becomes provider-neutral while retaining its request and Recipe response shapes.

The route will:

1. Validate and classify the URL.
2. Await provider text acquisition without blocking the event loop.
3. Append optional user guidance.
4. Pass acquired text through the existing recipe extraction function.
5. Apply source title/thumbnail only as fallbacks; explicit user title overrides remain authoritative.
6. Set the validated canonical source URL.
7. Reject structurally empty TikTok drafts rather than exposing the development stub or a misleading successful preview.

Expected response classes:

- `400`: missing or malformed URL.
- `422`: supported public link, but no usable captions/public recipe text; user action is to paste a transcript.
- `503`: supported provider is temporarily unreachable; user action is to retry.

No database write occurs on any parse path.

### 4. Web and mobile import UI

Both clients rename the source tab and label from YouTube-only copy to “Video link” / “YouTube or TikTok URL.” Client-side validation checks only nonblank input and lets the backend own canonical provider validation so web and mobile cannot drift.

While parsing, all source-changing controls are disabled, including mode tabs, optional-details expansion, and tag buttons. Errors clear when the user edits the source or changes mode. Returned backend detail messages remain visible and the entered URL is preserved.

The editable draft preview and save payload are unchanged.

### 5. Native iOS Share Sheet

Add the SDK-54-compatible `expo-share-intent` native module and config plugin, configured for URL/text sharing only. The extension uses the existing `cooking` URL scheme and opens the main Chef World application; it does not parse or call the backend inside the constrained extension process.

At app startup, a small share-intent bridge:

1. Extracts the first supported HTTPS YouTube or TikTok URL from the received URL/text payload.
2. Waits until auth restoration completes.
3. If authenticated, navigates once to `ImportModal` with `initialUrl` and clears the native intent.
4. If unauthenticated, retains the pending intent through login in provider state, then navigates after authentication.
5. Ignores unsupported shared content without disturbing normal app launch.

`ImportModal` initializes link mode and its URL from the route parameter. An already-open user-entered draft is never overwritten by a late duplicate intent.

The share module is disabled in Jest through the documented provider option/mock, because unit tests do not load an iOS extension. Native verification requires a new custom development build; Metro/Expo Go alone is insufficient.

## Error and Privacy Behavior

- Never log full transcript text, auth credentials, oEmbed HTML, or local environment secrets.
- Log provider, external ID when available, outcome status, and text length for diagnosis.
- Preserve the original supported link in the input UI after every failure.
- Do not represent TikTok post metadata as a spoken transcript; provenance is explicit in backend logs and internal result types.
- Do not download, cache, or store platform video/audio.
- The saved recipe retains only the canonical source URL, thumbnail URL, and the recipe's existing raw extraction text behavior after the user explicitly saves the reviewed draft.

## Testing

### Backend

- Table-driven URL tests cover every accepted YouTube/TikTok form plus malformed, HTTP, credential-bearing, port-bearing, and lookalike-host rejections.
- Transcript adapter tests prove the pinned 1.2.4 instance API is called correctly, snippet objects join correctly, language/track fallback works, public descriptions recover caption-file blocks, and each library exception maps to the intended typed result.
- TikTok oEmbed tests use complete response fixtures and cover useful caption text, empty/boilerplate text, invalid provider/shape, timeout, and upstream failure.
- Route tests prove parse is draft-only, canonical provenance/thumbnail fallbacks are applied, explicit title wins, YouTube network work is offloaded, empty TikTok drafts fail, and status codes/messages are stable.

### Web

- Unit tests cover updated copy, parsing-state control locking, error clearing, and nonblank link submission.
- Playwright's import flow accepts a TikTok URL fixture in addition to the existing YouTube happy path and reaches the same review/save screen.

### Mobile

- Unit tests cover route-prefilled URLs, shared-link navigation after auth restoration, duplicate-intent idempotency, unsupported payloads, error preservation, and the normal pasted-link preview.
- Existing import review/save tests continue to pass.
- TypeScript checks and Jest run without loading native extension code.

### Native smoke check

- Generate/run a custom iOS development build.
- From Safari and TikTok, share one YouTube and one TikTok link to Chef World.
- Confirm authenticated launch opens Import with the exact link, YouTube reaches review, and TikTok either reaches review from useful public caption text or shows the explicit transcript fallback.

## Documentation and Deployment

- Update `CLAUDE.md` and `README.md` to describe provider support, the no-key TikTok limitation, Share Sheet requirements, and new custom-build test step.
- Do not add an ECS environment variable or production service dependency.
- A backend deployment is required before web/mobile clients rely on TikTok link acceptance.
- A new EAS development/preview build is required before the iOS Share Sheet can be tested or distributed.

## Out of Scope

- Paid transcript gateways, new API keys, and arbitrary TikTok audio transcription.
- Direct media download, Whisper/FFmpeg processing, OCR, or uploaded video files.
- Android share intents.
- Background import jobs, persistence before review, or changes to the Recipe schema.
