# Video upload limit: 30 MiB

User request: explain the existing 14 MB limit and increase it to 30 MB without changing the interface or recipe-quality pipeline.

## Reason and scope

The former cap kept base64-encoded video plus prompt/schema below an older 20 MB inline request budget. Google now documents a 100 MB inline payload limit. A 30 MiB file encodes to exactly 40 MiB; even the maximum application prompt and response schema leave the serialized request below 41 MiB.

Primary sources reviewed on September 24, 2026:
- https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-new-file-limits/
- https://ai.google.dev/gemini-api/docs/file-input-methods#input-method-comparison
- https://ai.google.dev/gemini-api/docs/generate-content/video-understanding

The video guide retains older 20 MB prose below its updated 100 MB table. The token-count API accepts the same content structure and has no separately documented numeric request cap; real-provider verification is recorded after deployment.

The backend uses a shared 30 MiB media constant and a 31 MiB multipart request envelope. Capability responses, uploaded-media validation, and RedNote downloads use the same cap. The website share worker uses matching bounds. The user-facing convention remains MB, with binary MiB byte limits.

Model settings, recipe prompts/quality behavior, token limits, deadlines, concurrency, the 50 MiB per-account daily byte allowance, and the 60 MiB temporary sharing budget are unchanged. Two maximum-size pending shares plus metadata can evict the older share under the existing storage policy. The website layout is unchanged.

## Verification before release

- 509 web tests passed; focused 50-test sharing/import suite and TypeScript passed.
- 95 focused backend tests passed. New cases reproduced failures against the old limit before the fix.
- Exact 30 MiB files are accepted byte-for-byte; 30 MiB + 1 byte is rejected before queue admission.
- The 31 MiB request envelope is enforced for declared and actual/chunked sizes; unrelated image/JSON limits remain unchanged.
- RedNote media tests cover larger files and bounded rejection; serialized provider request tests cover maximum media and prompt sizes without paid calls.

Full backend, fresh-image runtime, browser boundary checks, and production evidence will be appended after completion. Historical evidence for the previous release remains in 2026-09-24-rednote-sharing-release.md.
