# Video import quality verification

Date: 2026-09-24. Local implementation only; no production deployment or live Gemini call.

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

To enable audiovisual import, configure backend-only `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.5-flash-lite`, matching `GEMINI_PRICE_MODEL`, a dated `GEMINI_PRICE_VERSION`, and reviewed input/output rates documented in `backend/.env.example`. Existing account/global monetary allocations and admission limits apply to both providers. No credentials, allocations, or production settings were changed here.

Each video generation conservatively reserves the reviewed model bounds before work and reconciles actual usage; the reservation at the documented minimum rates is $0.4784128 per call. It is not an expected per-import charge. A full import uses at most two generations, subject to the shared deadline and remaining budget. Inaccessible/private/unlisted YouTube content and unsupported or oversized uploads remain recoverable errors.

The supplied claypot screenshots are the user's manually corrected reference, used for regression coverage. The source video's audio and frames have not been independently checked in this run. Native device upload behavior and live Gemini access/latency/quality still require validation after provider configuration.

## Completion record

Final full backend run: `934 passed, 6 skipped in 52.99s`. All 1,827 executed tests across the backend, shared/API, web, mobile and browser runs passed. `git diff --check` passed. Temporary preview servers were stopped after browser verification; the disposable database is separate from all development and production data.
