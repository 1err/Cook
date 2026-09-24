# Video import quality implementation plan

> **For agentic workers:** use the existing delegated tasks and shared contracts below; do not edit another worker's files.

**Goal:** Complete ordered source-grounded tutorials, recover missing captions with optional media analysis, and keep uncertain instructions/timing reviewable.

**Architecture:** Two bounded provider passes collect evidence and audit coverage. Authenticated persistent import jobs keep source retrieval and analysis off the request path. Recipe step JSON carries evidence and nullable unknown durations; the existing editable save workflow remains explicit.

**Tech stack:** FastAPI, SQLAlchemy/PostgreSQL, httpx, Next.js/React Native, shared TypeScript, pytest/Vitest/Jest.

**Spec:** Approved investigation `docs/research/2026-09-24-video-import-quality.md` in the original checkout and the user's instruction to implement its enhancements.

## Constraints

- Worktree starts from `b8a64de`, retaining recent release work and leaving the dirty original checkout intact.
- No deployment or changes to existing saved recipes.
- Existing monetary ceilings, request admission and two-generation-call cap remain enforced for both providers.
- Gemini is optional and disabled until credentials and reviewed pricing are configured. No secrets in fixtures or logs.
- Preserve valid first-pass ingredients and partial steps when an audit fails; never silently invent a method from ingredients alone.
- Source prose is data. Manually edited steps invalidate source attribution; manually set durations remain intact.

## Shared contracts

`RecipeStep`: add `instruction_source` (`source`, `suggested`, `user`, nullable), `source_start_seconds`/`source_end_seconds` (nullable nonnegative floats), `source_excerpt` (nullable, at most 500 characters). Add duration source `unknown`; new unknown duration is null. Existing numeric fallback durations retain their behavior.

`Recipe.import_review`: nullable `{status: ready|needs_review, warnings: string[], source_kind: captions|description|video|media|text, can_analyze_video: boolean}`. Draft diagnostics are returned during import; step provenance is persisted in existing step JSON.

`complete_video(prompt, *, source_url=None, media_data=None, media_type=None) -> str`: raw recipe/audit JSON, accounting and validation enforced inside provider.

`extract_recipe_from_text(transcript, *, source_kind='text') -> Recipe`; `extract_recipe_from_video(*, source_url=None, media_data=None, media_type=None, notes='') -> Recipe`.

Jobs: `POST /recipes/import-jobs` accepts `{mode: link|text|video, url?, transcript?, notes?, title?, library_tags?}`. Uploads use multipart `POST /recipes/import-jobs/media`. `GET`/`DELETE /recipes/import-jobs/{id}` read/cancel. Response `{id, status: queued|processing|completed|failed|cancelled, recipe?, error?:{code,message}}`. Capabilities return `{video_analysis, media_upload, max_media_bytes}`.

## Tasks and checks

- [x] **Extraction worker:** regression with a nonempty partial tofu tutorial; assert missing actions are repaired in correct order, ingredients unchanged, source evidence retained, and audit failure returns needs_review. Preserve hardened caption retrieval while carrying segment timestamps through its process boundary. Test malformed inventory, duplicated/reordered actions, unsupported procedures, and caption-language alternatives.
- [x] **Provider worker:** primary-document verified model and price floor; test URL/media validation, signature and size limits, missing credentials, count preflight, budget denial, finish/truncation/refusal, cancellation, and reconciliation. No live spending required for mocked correctness checks.
- [x] **Root schema/cooking:** test unknown durations round-trip without five-minute substitution, evidence bounds, legacy normalization, timer rejection for unknown duration, and completing/skipping untimed actions. Migrate only cooking snapshot nullable duration constraints and add import jobs; recipe step JSON needs no rewrite.
- [x] **Root jobs/API:** authenticated user-scoped queue, atomic cross-process claiming, bounded pending work, expiry/cancellation, no provider calls while holding a DB transaction, terminal media cleanup, original source attribution, partial result retention, structured actionable errors. Retain old parse routes for older clients.
- [x] **Client worker:** shared/API tests for polling and abort; web/mobile import and review warnings, source timestamp links, source-preserving fallback and optional upload; blank durations and stale timing invalidation; unknown cooking timers disabled and progress well-defined.
- [x] **Root integration:** run backend suite, relevant shared/web/mobile suites and typechecks, migration checks and browser review. Fresh independent review of source grounding, authentication, spend/cancellation and persisted unknown timing. Record actual verification and any unavailable live-provider checks.

## Review focus

- Provider audit returns empty/unsupported content: preserve user-reviewable first pass, never mark ready.
- An account cancels or signs out while a job runs: ownership holds, uploads are cleared, the UI cannot accept a stale result.
- Worker dies after claiming: bounded lease expires to a visible failed result rather than duplicate charged processing.
- Existing saved recipes with inferred fallback times: no silent migration or destructive rewrite.
- Null cooking duration: no default timer appears or starts, completion and progress still work.

## Execution notes

2026-09-24: User authorized implementation of the proposal. Scope and execution choices are routine reversible implementation decisions; continue without another approval gate. Provider requires an unconfigured Gemini key for live verification. Local code and mocked/provider-boundary tests can proceed independently.

Verification evidence: `docs/qa/2026-09-24-video-import-quality.md`. Live Gemini and native-device checks remain explicitly unverified until provider configuration/device access; implementation and automated/local API checks are complete.
