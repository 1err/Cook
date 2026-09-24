# Video import quality investigation

Date: 2026-09-24. Status: investigation and proposed approach; no product changes or deployment.

## Intended outcome and evidence

Jerry wants caption failures to be recoverable and imported tutorials to preserve the video's cooking actions, detail, and order. Ingredient extraction is generally satisfactory. Preserve that behavior and the existing editable import review.

The two supplied screenshots are Jerry's manually corrected tofu-and-eggplant claypot recipe, associated with https://www.youtube.com/watch?v=A6bByqI_TH8. They are a reference for desired detail, not evidence of the original model output. The video page could not be retrieved through browsing, so this investigation has not independently verified its audiovisual content or identified the exact steps omitted in the earlier import.

Findings below were checked against the current working tree, not a fresh production deployment inspection.

## What the current implementation does

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Captions have a public-description fallback. | `backend/app/video_import.py:194`, `:202` | No captions does not always block import. It fails when no usable text is available, or extraction still yields no usable steps. Temporary access failures are distinct from absent captions. |
| Only text reaches the recipe model. | `backend/app/core/llm.py:50`; `backend/app/extract.py:489` | The importer does not hear the video or inspect visible actions or embedded subtitles. |
| Caption snippets are joined into plain text. | `backend/app/video_import.py:235` | Segment timestamps and evidence boundaries are lost, although snippet order itself is retained. |
| Captions and description are alternatives. | `backend/app/video_import.py:247`, `:254` | A successful caption fetch does not also supply useful description details. Caption selection also prefers English before the configured Chinese tracks rather than explicitly choosing original-language evidence. |
| Recovery runs only if there are zero usable steps and meaningful ingredients. | `backend/app/extract.py:610` | A partial tutorial with one valid preparation step skips recovery. There is no completeness or sequence audit. |
| Recovery can infer a typical method from only a title and ingredients. | `backend/app/extract.py:463` | A plausible reconstructed method can be returned without a separate instruction-provenance label. `duration_source=estimated` only labels the time. |
| The link route accepts any non-placeholder step. | `backend/app/api/routes_recipes.py:99`, `:129` | A nonempty tutorial is treated as usable even if major cooking actions are absent. |
| New manual steps default to five minutes. | `packages/shared/src/recipeTutorial.ts:201`, `:226` | A transfer or garnish action can inherit an arbitrary five-minute estimate. Editing its text preserves existing timing metadata. “Adjusted” identifies a user-edited duration, not a verified instruction. |
| Failed imports show a plain error; text fallback drops source attribution from its request. | `apps/web/app/import/page.tsx:66`; `apps/mobile/src/features/import/ImportModalScreen.tsx:207` | Users must reconstruct the recovery flow and may lose the link to the original video. |

Two small local probes executed the existing helper logic without calling an AI provider:

- Draft with tofu, eggplant, and only “将豆腐切片。”: considered usable; recovery not triggered.
- Transfer instruction with no duration and no recipe total: normalized to 300 seconds with fallback provenance.

These establish logic gaps, not the exact history of Jerry's saved recipe. The full backend suite was not run; the existing backend virtual environment lacks pytest.

## Recommended approach

Use a shared evidence-to-tutorial pipeline, with captions as the fast source and video understanding as a fallback or deeper verification source.

1. **Collect evidence.** Preserve caption segment IDs, timestamps, language, and whether a track is auto-generated. Include useful title/description content alongside captions. Prefer the original language when identifiable and preserve source-language cooking terms. Do not discard alternate evidence when sources disagree.
2. **Extract cooking actions before formatting the recipe.** For each action, retain the ingredient, preparation, vessel, heat setting, duration, doneness cue, quantity, and supporting source segment when available. Explicitly record uncertainty. Represent recaps and alternate methods separately so they are not accidentally inserted into the main procedure.
3. **Build the tutorial.** Group into preparation, cooking, and finishing for readability while preserving dependencies and actual source order. Preserve transfers, pan reuse, fat rendering, additions, and finishing operations. Do not compress distinct operations into vague instructions such as “cook everything.”
4. **Audit every candidate, including nonempty ones.** Compare its actions against the evidence inventory. Check missing actions, duplicate recap instructions, sequence violations, ingredient usage, heat/duration omissions, and unsupported additions. Flag an ingredient with no explained use; do not invent a use to satisfy the check. Repair against the evidence in one bounded pass, then retain unresolved warnings.
5. **Escalate weak evidence.** If captions are absent, incomplete, or leave unexplained visual operations, request audio-and-video analysis. Use timestamps to inspect uncertain portions more closely. Quality checks cannot prove that a transcript includes every silent action; richer video inspection is also useful for otherwise plausible caption-based drafts.
6. **Return a reviewable result.** Show a ready draft, a draft needing review, or unavailable source status. Preserve any trustworthy ingredients and original URL through recovery. Offer video/audio attachment, pasted text, and retry as appropriate. An ingredient-only draft should remain clearly unfinished and should not start a cooking session.

Each generated step should reference supporting evidence and distinguish source-supported instructions from optional suggested reconstruction. Unknown quantities and cooking times should stay unknown. User corrections should be retained as a separate version and protected during re-extraction.

## Source options and tradeoffs

| Option | Benefit | Limit |
| --- | --- | --- |
| Improve caption/text processing alone | Smallest first change; addresses partial tutorials and dropped details already present in the text. | Cannot recover inaccessible speech or silent visual steps. |
| Public YouTube URL video analysis | Can use audio and visuals without depending on public caption availability. | Provider access and quality must be evaluated; YouTube URL support is preview and public-only. |
| User-uploaded media analysis | Recovery when a link cannot be accessed; supports the user's actual file. | Requires file handling, processing state, cleanup, and duration/size limits. Speech transcription alone still misses silent actions. |

Google's [video-understanding documentation](https://ai.google.dev/gemini-api/docs/video-understanding) supports direct public YouTube URL input, audio/visual processing, timestamp references, and adjustable video sampling. Its URL feature is currently preview; private and unlisted videos are excluded. Default static sampling is one frame per second, which can miss brief actions. Treat this as a candidate provider to evaluate, not guaranteed successful recovery for this particular video.

OpenAI's [speech-to-text documentation](https://developers.openai.com/api/docs/guides/speech-to-text) supports media-file transcription. It requires media bytes rather than merely a YouTube webpage URL. An audio-only fallback can restore narration, but visual inspection is needed for unspoken cooking actions.

A provider fallback should run through a background import job with visible progress, bounded retries, cancellation, and per-import usage limits. Cache reusable source evidence by source/version where appropriate; do not mix private user notes into a shared result. Measure actual latency and usage before selecting a model or promising import costs. The existing shared text-completion client needs an explicit provider/media path; changing its prompt alone is insufficient.

## Applying this to the supplied recipe

The manually corrected screenshots identify these important operations and relationships:

- Prepare tofu, eggplant, pork, pepper, garlic, mushrooms, and scallion bulbs; retain cut sizes where specified.
- Prepare the pan, add oil and salt, then reduce heat before frying the tofu.
- Fry tofu on both sides until golden; preserve the stated-in-the-reference six-minute total and three minutes per side as one duration relationship, not three separate timers.
- Transfer tofu to the claypot before continuing with the remaining pan oil.
- Render the pork fat before cooking the eggplant; retain the eggplant's medium-low heat and five-minute instruction.
- Preserve the order of seasonings/water, chopped vegetables/aromatics, starch slurry, and final transfer/garnish as represented in the corrected reference.

These are reference facts supplied by Jerry, not independently video-verified facts. In particular, the text prepares scallion bulbs without clearly stating their later use: a checker should flag this ambiguity for source review rather than silently adding a step.

Step count is not the quality target. A tutorial can have fewer or more than 16 rows and still be faithful if it preserves all required actions and dependencies. Quantities such as oyster sauce 8 g, light soy sauce 5 g, and dark soy sauce 2 g should remain attached to the right action when supported by the reference/evidence.

Fix timing separately: keep explicit cooking duration distinct from clip length, total recipe time, and optional timers. A short transfer does not need a fabricated five-minute timer. If instruction text changes, flag stale timing for review while protecting intentionally user-set values. Supporting unknown durations affects the shared schema and cooking scheduler, so it must be tested across web, mobile, and active cooking sessions.

## Delivery sequence and validation

**First: tutorial fidelity.** Preserve evidence, use a dedicated action extraction and completeness audit, prevent unlabeled inferred procedures, retain source URLs, and repair timing defaults. Avoid replacing the generally successful ingredient extraction wholesale.

**Second: recover caption-free videos.** Evaluate public-URL video analysis on the supplied example and additional videos. Add the provider path and job/review states once actual access and output quality are demonstrated. Add media upload as the fallback for inaccessible links.

Use the corrected recipe as the first reviewed fixture, then add a small set of Chinese and English videos covering human captions, auto-captions, no captions, brief silent actions, recaps, and unavailable/private links. Keep the original generated and corrected drafts separately. A fabricated or mocked transcript is useful for unit tests but is not evidence that live video retrieval works.

Measure:

- Required-action coverage and dependency/order accuracy.
- Unsupported additions and invented quantities, heat settings, or durations.
- Preservation of generally accurate ingredient extraction.
- Ability to retain partial work and source attribution after failure.
- User edits needed before saving, successful import rate, elapsed time, and provider usage.

Before release, require no omitted critical actions or violated dependencies on the reviewed tofu-and-eggplant fixture, no unsupported procedural additions, no arbitrary five-minute transfer timer, and successful review/save/cook flows on both clients. Preserve existing saved recipes and manual edits unless the user explicitly chooses to apply a revised draft.
