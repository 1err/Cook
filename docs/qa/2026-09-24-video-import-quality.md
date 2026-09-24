# Video import quality verification

Date: 2026-09-24. Local implementation with free-tier Gemini verification; no production deployment.

## Changes

- Caption segments retain their times and language metadata; available description quantities accompany source evidence.
- Extraction inventories actions, then audits every candidate for missing, duplicate, unsupported, or reordered operations. Valid first-pass ingredients survive repair and audit failure.
- Optional Gemini audiovisual analysis handles canonical public YouTube links and uploaded media. Web accepts supported video/audio files; mobile uses its existing video-library picker. The limit is 14 MiB.
- Account-owned durable jobs support polling/cancellation, one active import per account, a 32-job global queue and one-hour expiry. Temporary slot contention waits without consuming another operation allowance. Potentially charged work is never automatically retried.
- Partial drafts retain ingredients and their original link. Reanalysis requires an explicit apply/keep choice. Step edits clear obsolete source claims while retaining user-set durations.
- New unknown times stay null. Untimed cooking steps can be completed or skipped without starting a fabricated timer. Existing saved recipes are not rewritten.

## Verification

- Backend: 934 tests passed against a disposable PostgreSQL 16 database, including actual admission/worker/cancellation lifecycle tests. Six Linux-only scraper containment tests were skipped on macOS.
- Shared/API client: 78 tests passed.
- Web: 463 tests passed across 65 files.
- Mobile: 337 tests passed across 45 suites.
- Web and mobile TypeScript checks passed.
- Next.js production build passed.
- Playwright: 15 import/cooking tests passed across phone, tablet and desktop projects using installed Chrome, including the existing desktop screenshot comparison. Provider responses in these browser regressions are mocked.
- In-app browser with the real local API and synthetic account: saved a manual recipe with an unspecified passive-step time; loaded it in cooking; verified no timer action; completed it to 100%. Verified job creation returned 202, polling surfaced a provider-unavailable result, and entered text plus the original video link remained available for retry.
- Applied migration `20260924_video_import` from a fresh disposable database through Alembic. Saving and cooking the untimed recipe exercised the nullable snapshot constraint.
- Independent review reproduced and corrected source-quote, dropped-action, caption-timestamp, unsupported number/ingredient, unstated timer, audit-timeout and queue-contention failures. Positive Chinese/English source and unit-conversion cases passed. Checks remain conservative heuristics plus model review, not proof that all video actions were observed.

## Activation and limits

Apply `20260924_video_import` before releasing the new backend/clients. Import workers run inside the API lifespan; the existing store worker remains separate.

To enable audiovisual import, configure backend-only `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.5-flash-lite`, matching `GEMINI_PRICE_MODEL`, a dated `GEMINI_PRICE_VERSION`, and reviewed input/output rates documented in `backend/.env.example`. Existing account/global monetary allocations and admission limits apply to both providers. With explicit user authorization, a new key and reviewed settings were saved only in the original checkout's ignored `backend/.env`, with owner-only file permissions. Google AI Studio showed Free tier and billing was not enabled. Production credentials and allocations were not changed.

Each video generation conservatively reserves the reviewed model bounds before work and reconciles actual usage; the reservation at the documented minimum rates is $0.4784128 per call. It is not an expected per-import charge. A full import uses at most two generations, subject to the shared deadline and remaining budget. Inaccessible/private/unlisted YouTube content and unsupported or oversized uploads remain recoverable errors.

The supplied claypot screenshots are the user's manually corrected reference, used for regression coverage. The live Gemini results below are model analysis of that source; they are not independent human verification of every audio/visual action. Native device upload behavior and production import behavior still require validation.

## Completion record

Final full backend run: `934 passed, 6 skipped in 52.99s`. All 1,827 executed tests across the backend, shared/API, web, mobile and browser runs passed. `git diff --check` passed. Temporary preview servers were stopped after browser verification; the disposable database is separate from all development and production data.

## Live provider findings and corrections

The approved test used the exact public video `A6bByqI_TH8`, Gemini only (OpenAI disabled), the real route and AI admission/ledger, a synthetic account, and a separate local `cooking_gemini_smoke_test` database. It did not save a recipe to production. Each deliberate test keeps the same monetary ledger, a USD 1 modeled cap, a maximum of two generations, no automatic retry, and an 85-second operation deadline.

- Initial run: both generations returned HTTP 200/STOP in 36.153 seconds. The result had 15 ingredients and five overly bundled steps; it correctly remained `needs_review` because grounding and the audit were not accepted. Recorded input/output tokens were 43,400 / 11,153, with USD 0.0409025 modeled at standard rates. That is a local budget estimate, not a Google invoice or free-tier charge.
- A separate diagnostic run demonstrated a real output-limit failure: the first generation ended `MAX_TOKENS` at 5,996 output tokens and contained incomplete JSON. The adapter rejected it, reconciled actual usage, made no retry, and released the in-flight lease.
- Follow-up changes use an 8,000-token output ceiling (within unchanged monetary reservation bounds), explicit structured response contracts for extraction/audit, a complete nested audit example, and instructions to keep distinct cooking operations in separate tutorial rows. Invalid or truncated output still fails safely; the grounding checks are not relaxed.
- Validation after those changes: both generations returned HTTP 200/STOP; the nested audit was valid. The draft contained 16 ingredients and 13 tutorial steps in 31.305 seconds, with seven source-linked steps. It retained the frying, transfer, remaining-oil/pork-fat, eggplant, seasoning, thickening and serving sequence; transfer/garnish steps had no invented timer. It remained `needs_review`: some action wording was uncertain, one audit excerpt changed, several vegetable preparations were still grouped, and the method did not explain when the prepared garlic/scallion bulbs were added. This is improved extraction, not proof of complete video fidelity.
- The validation import recorded 44,533 input and 12,366 output tokens (USD 0.0442749 modeled). Across all three deliberate test operations, five generations were reconciled, with no unresolved reservation or in-flight lease. The same synthetic account/database and cumulative USD 1 cap were retained; daily operation allowance was explicitly raised only for each additional diagnostic/validation run, never reset. Google billing remained disabled.
- Regression run after schema/prompt changes: `940 passed, 6 skipped in 56.70s` against disposable PostgreSQL with browser-capable execution. An additional composed provider test verifies first-pass success followed by truncated audit retains the draft, reconciles both calls and never requests a third generation.
- A deterministic review check now names ingredients mentioned only in preparation while other cooking/use steps exist. It abstains for preparation-only recipes, unrecognized preparation aliases and plausible shortened Chinese names; it never invents a use or establishes provenance. Offline replay of the exact two live responses retained all 13 step texts and added the expected garlic/scallion-bulb warnings, without incorrectly warning about eggplant, tofu or pork.
- Final backend regression run including the composed truncation test and ingredient-use warnings: `950 passed, 6 skipped in 52.96s`. Independent review found no blocking issues. Changed files were checked for the actual local credential; none contained it. The local key file remains ignored by Git and mode `0600`.

See the [readable generated draft](2026-09-24-video-import-live-example.md) and [sanitized provider/ledger evidence](video-import/2026-09-24-gemini-validation.json). Live validation includes neither deployment nor native-device upload testing.
