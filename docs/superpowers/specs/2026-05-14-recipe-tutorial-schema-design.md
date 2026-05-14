# Recipe Tutorial Schema Expansion — Design

**Date:** 2026-05-14
**Status:** Approved
**Sub-project:** A (foundational) of the broader "improved video import" initiative
**Depends on:** none. **Blocks:** B (multi-source ingestion), C (multi-modal extraction), E (polished tutorial UI), F (background extraction jobs).

## 1. Goal

Expand the `Recipe` schema with a structured-tutorial shape so future imports can carry steps, timing, description, tips, and equipment. Ship the backend, the LLM prompt update, and a basic (functional, not yet polished) editor and read view on both web and mobile. Legacy recipes continue to render unchanged.

The polished, beautifully-arranged tutorial UI is **sub-project E** and is deferred.

## 2. Non-goals

- No new media sources (Instagram Reels, Xiaohongshu, direct uploads). See sub-projects B / D.
- No OCR, no frame sampling, no audio transcription. See sub-project C.
- No automatic population of step images from video frames. See sub-project C.
- No redesign of the recipe page visually. See sub-project E.
- No backfill of legacy recipes. They render gracefully with empty new fields.
- No background extraction jobs. Parse remains synchronous. See sub-project F.

## 3. Schema additions

Five new columns on the `recipes` table, all nullable / defaulted to empty.

| Column | SQL type | Default | Pydantic type | Notes |
|---|---|---|---|---|
| `steps` | `Text` (JSON array string) | `'[]'` | `list[RecipeStep]` | Ordered list of cooking steps |
| `tips` | `Text` (JSON array string) | `'[]'` | `list[str]` | Chef notes / tricks |
| `equipment` | `Text` (JSON array string) | `'[]'` | `list[str]` | Pans, tools |
| `description` | `Text` (nullable) | `NULL` | `Optional[str]` | One-paragraph intro |
| `total_time_minutes` | `Integer` (nullable) | `NULL` | `Optional[int]` | Native INT — queryable, sortable |

JSON-in-`Text` storage matches the existing `library_tags` and `meal_plan.recipe_ids` precedent in this repo. No JSONB is introduced.

### 3.1 `RecipeStep` model

```python
class RecipeStep(BaseModel):
    text: str
    duration_seconds: Optional[int] = None
    image_url: Optional[str] = None
```

- `duration_seconds` (not `_minutes`) so 30-second rests are representable without fractions.
- `image_url` is a full URL, same shape as `Recipe.thumbnail_url`. Image upload reuses the existing `POST /recipes/upload-image` endpoint and presign path — no new upload route.
- Steps are array-position only. **No stable IDs.** If sub-project C later needs stable references (e.g., to enrich a specific step with a frame-extracted image), that PR adds an `id` field and backfills on read.

### 3.2 Validation rules

Implemented in `backend/app/models.py` alongside `coerce_library_tags`:

- `total_time_minutes >= 0`; values `<= 0` or non-int → coerced to `None`.
- `RecipeStep.duration_seconds >= 0`; otherwise `None`.
- `tips`, `equipment`: trim, drop empty, deduplicate (preserve first occurrence order).
- `steps`: drop entries whose `text` is empty after trim.
- All extra keys ignored (Pydantic default), so a future field on the prompt doesn't 422 the request before we deploy support for it.

### 3.3 Alembic migration

File: `backend/alembic/versions/20260514_recipe_tutorial.py` (head becomes this revision).

```python
op.add_column("recipes", sa.Column("steps", sa.Text(), nullable=False, server_default="[]"))
op.add_column("recipes", sa.Column("tips", sa.Text(), nullable=False, server_default="[]"))
op.add_column("recipes", sa.Column("equipment", sa.Text(), nullable=False, server_default="[]"))
op.add_column("recipes", sa.Column("description", sa.Text(), nullable=True))
op.add_column("recipes", sa.Column("total_time_minutes", sa.Integer(), nullable=True))
```

No data migration. Existing rows pick up the server defaults. The ECS task definition runs `alembic upgrade head` on container start, so no manual step is required in prod.

## 4. Backend changes

### 4.1 `backend/app/models.py`

- Add `RecipeStep` Pydantic model.
- Add `coerce_steps(v)` and `coerce_string_list(v)` validators.
- Extend `RecipeCreate` with `steps`, `tips`, `equipment`, `description`, `total_time_minutes` (all default empty / None). Use `@field_validator(..., mode="before")` for the JSON-coerced fields, mirroring how `library_tags` is wired today.
- `Recipe(RecipeCreate)` inherits the new fields.

### 4.2 `backend/app/api/_types.py`

Add reusable types so routers do not redeclare validators:

```python
StepList   = Annotated[list[RecipeStep], BeforeValidator(coerce_steps)]
StringList = Annotated[list[str],        BeforeValidator(coerce_string_list)]
```

### 4.3 `backend/app/db/models.py` (SQLAlchemy)

Add the five columns to `RecipeModel` with `server_default` set inline (`text("'[]'")` for JSON-array columns; `nullable=True` / no default for `description` and `total_time_minutes`).

### 4.4 `backend/app/db/repo_recipes.py`

- `save_recipe`: `json.dumps` for `steps` / `tips` / `equipment`; scalars for `description` and `total_time_minutes`.
- All read paths (`get_recipe`, `list_recipes`, `list_public_recipes`, `copy_public_recipe_to_user`) deserialize the JSON columns into the Pydantic models. Empty string or `NULL` → `[]`.
- Copy paths perform a deep clone of the new fields. Step `image_url` values keep their existing S3 / `/uploads` URLs — they are shared, not re-uploaded, matching the current `thumbnail_url` policy.

### 4.5 `backend/app/db/repo_users.py`

Friend-library `copy_friend_recipe` follows the same deep-clone rules.

### 4.6 `backend/app/extract.py`

- `_build_extraction_prompt` updated to request the new JSON shape:

  ```json
  {
    "title": "...",
    "description": "..." | null,
    "total_time_minutes": 30 | null,
    "ingredients": [{"name": "...", "quantity": "...", "notes": null}],
    "equipment": ["wok", "rice cooker"],
    "steps": [
      {"text": "Mince garlic and ginger.", "duration_seconds": null},
      {"text": "Sear pork until browned.", "duration_seconds": 180}
    ],
    "tips": ["Press tofu before dicing to avoid breakage."]
  }
  ```

  Prompt explicitly instructs: if the transcript is thin or doesn't describe procedure, return an empty `steps` array — **do not invent steps**. Same rule for `tips` and `equipment`. Existing CJK preservation rules unchanged.

- `parse_llm_recipe_response` returns the full extended dict; callers pass it to `Recipe(...)`, which runs the validators.
- `_stub_extraction` (no-OPENAI-key fallback) returns the Mapo Tofu recipe with three or four example steps, a description, and one tip — so the dev flow exercises the full schema end-to-end.
- `extract_recipe_from_text` keeps its existing signature; the only change is that the returned `Recipe` is richer.

### 4.7 `backend/app/api/routes_recipes.py`

- `RecipeUpdate` gains optional `description`, `total_time_minutes`, `steps`, `tips`, `equipment` so `PATCH /recipes/{id}` can edit them.
- `ParseLinkBody` / `ParseTranscriptBody` unchanged.
- `POST /recipes` unchanged in shape — it already takes a full `RecipeCreate`.

### 4.8 Smoke script

`backend/scripts/smoke_tutorial_schema.sh` (mirrors `smoke_friend_library.sh`):
1. Login.
2. `POST /recipes` with description, total_time_minutes, steps (one with a duration), tips, equipment.
3. `GET /recipes/{id}` — assert all fields round-trip.
4. `PATCH /recipes/{id}` to add a step and edit a tip.
5. `GET /recipes/{id}` — assert PATCH applied.

No env-var changes. No new Python dependencies.

## 5. Web client changes (`apps/web`)

### 5.1 Import page (`apps/web/app/import/page.tsx`)

The file is 602 lines. Extract the editable preview into `apps/web/app/import/DraftRecipeEditor.tsx` (matches the mobile naming). This is a targeted refactor justified by working in this code; no unrelated cleanup beyond the extraction.

New editable sections in the draft editor, in this order:

1. Title (existing)
2. Description — single `<textarea>`, optional, 500-character soft limit, counter shown
3. Total time — `<input type="number" min="0">` with the label "minutes"
4. Ingredients (existing)
5. Steps — see 5.2
6. Tips — see 5.3
7. Equipment — see 5.3 (same component, deduplicated)
8. Tags (existing)
9. Thumbnail (existing)

### 5.2 Step editor (web)

Ordered list. Each row contains:
- Numbered label (display only).
- `<textarea>` for step text.
- Duration field: two `<input type="number">`s rendered as `mm:ss` and stored as `duration_seconds`.
- Inline image: reuses the existing presigned-upload flow already used for thumbnails. Empty state shows an "Add image" button.
- Row actions: "Move up", "Move down", "Remove". `dnd-kit` is **not** introduced — buttons are enough for "basic". A "+ Add step" button below the list.

### 5.3 String-list editor (tips, equipment)

A single small component reused for both. Add row, edit text, remove row. Empty rows are dropped on save (defense-in-depth — backend also drops them).

### 5.4 Recipe edit page (`apps/web/app/recipe/[id]/page.tsx`)

Edit mode gains the same five sections, reusing the components extracted in 5.1. PATCH submits with whichever fields changed.

### 5.5 Recipe view page (read mode)

- Description and total-time chip render at the top, above the ingredients block.
- Below the ingredients block: Equipment → Steps → Tips, each conditional on presence (no empty headers).
- Steps render as a numbered list. Duration shown as a small `mm:ss` chip beside the step number. Step image (if present) renders inline below the step text.
- Plain CSS classes in `apps/web/app/globals.css` (existing palette + Material Symbols). No Tailwind. No animations, no in-page timers, no sticky scroll. Those are sub-project E.

### 5.6 i18n

All new visible strings go through `useT()` with keys added to both `packages/shared/src/messages/en.json` and `zh.json`. New keys (full list at implementation time, but at minimum): `recipe.description`, `recipe.totalTime`, `recipe.totalTime.minutesSuffix`, `recipe.steps`, `recipe.steps.empty`, `recipe.step.addRow`, `recipe.step.remove`, `recipe.step.moveUp`, `recipe.step.moveDown`, `recipe.step.duration`, `recipe.step.uploadImage`, `recipe.tips`, `recipe.tips.addRow`, `recipe.equipment`, `recipe.equipment.addRow`.

### 5.7 `@cooking/shared`

- `RecipeStep` TS type added to `packages/shared/src/types.ts`.
- `Recipe` type gains `steps?: RecipeStep[]`, `tips?: string[]`, `equipment?: string[]`, `description?: string`, `total_time_minutes?: number | null`. All optional so legacy callers compile unchanged.
- Helper `formatStepDuration(seconds: number): string` returning `"mm:ss"` lives here so web and mobile render durations identically.

### 5.8 `@cooking/api-client`

No new methods. `recipes.update(id, patch)` already takes a `Partial<Recipe>`; the new fields ride along.

## 6. Mobile client changes (`apps/mobile`)

### 6.1 Import flow (`apps/mobile/src/features/import/`)

`DraftRecipeEditor.tsx` (113 lines today) grows the same five sections as web. Extract sub-components alongside it:

- `StepListEditor.tsx`
- `StringListEditor.tsx` (used for tips + equipment)
- `DurationField.tsx`
- `TotalTimeField.tsx`

Step images use `expo-image-picker` (already in use via `ImagePickerButton.tsx`) plus the existing `useImageUpload` hook. No new native modules.

The loopback-host rewrite via `resolveImageUrl` already handles local-dev image URLs and applies to step images automatically.

### 6.2 Recipe edit screen

Same five sections, same sub-components.

### 6.3 Recipe detail screen

Read-only renderers for description, total_time_minutes, steps, tips, equipment. Conditional on presence. Numbered step list with `mm:ss` chip and inline `Image`. No animations, no bottom-sheet timers — that's sub-project E.

### 6.4 Theme and typography

All new text / number / duration styles come from `apps/mobile/src/theme/typography.ts`. No raw hex codes in feature code (existing rule). The mobile-design-system grep check in CLAUDE.md must still return zero hits outside `theme/`.

### 6.5 Mobile i18n

Mobile is English-only today (per CLAUDE.md "Known cleanup targets"). The new strings are English-only too. **Do not** introduce a one-off mobile i18n layer just for this feature.

## 7. Error handling

| Failure | Behavior |
|---|---|
| LLM returns unparseable JSON | Fall back to the existing stub-shaped response: title + at-least-one ingredient row, with `steps=[]`, `tips=[]`, `equipment=[]`. Same silent-recovery policy as today. |
| LLM returns malformed step / tip entries | Coercion validators drop bad rows; the rest of the recipe still parses. |
| PATCH with malformed input | 422 from Pydantic. Frontend already surfaces 4xx error text in the editor. |
| Empty step on save | Client strips empty-text rows before submit; backend also drops them in `coerce_steps`. |
| Step image upload fails | Error toast (same UX as thumbnail upload today). Step row stays editable with no image attached. |
| Legacy recipe with `NULL` columns | Repo deserialization treats `NULL` / empty as `[]` / `None`. View pages render only fields that are present — no empty "Steps" header. |
| Backend deployed after web | Web tries to PATCH new fields. FastAPI ignores unknown body keys by default, so the request returns 200 but new fields are silently dropped — visible data loss. Mitigated by the deploy order in §9. |

## 8. Testing and verification

This repo has no test scripts (per CLAUDE.md). Verification is manual + scripted curl.

1. `alembic upgrade head` applies cleanly against the live local DB; existing rows survive (`SELECT count(*) FROM recipes` unchanged; `steps`/`tips`/`equipment` populated to `'[]'`).
2. `bash backend/scripts/smoke_tutorial_schema.sh` round-trips a recipe through POST → GET → PATCH → GET.
3. Local docker compose: import a YouTube link the user has on hand. Verify steps / tips / equipment appear in the editor and persist after save.
4. Open a pre-existing recipe in the library. Confirm view + edit pages render correctly with the new fields empty.
5. Web prod-build check before merging: `npm --workspace @cooking/web run build` succeeds. This is the gate that catches `@types/react` drift (per CLAUDE.md). Failure to run this has historically broken Vercel.
6. Mobile dev client smoke (simulator): import → edit → save → reopen → edit mode shows everything that was saved.

## 9. Deploy order

Per CLAUDE.md's deploy-order policy for features that add backend endpoints + web UI:

1. **Backend first** via `bash scripts/deploy-backend.sh`. The script's smoke gate (which 404s if the deploy didn't roll) is sufficient.
2. Verify with `curl -s -H "Cookie: access_token=..." https://api.chef-world.com/recipes/<known-id> | jq .steps` against a legacy recipe — expect `[]`.
3. Merge the feature branch to `main`. Vercel auto-deploys.
4. Mobile ships at its own cadence (EAS preview build for internal testing, then production once stable).

Reversed order risks silent data loss on PATCH against an old backend (see §7 last row).

## 10. CLAUDE.md updates (in the same change)

Per repo policy, the implementation PR updates CLAUDE.md:

- API surface table: note new fields in `RecipeUpdate` body and on the `Recipe` response shape.
- "Architecture notes that aren't obvious from a single file": add a "Recipe tutorial fields" subsection summarizing the columns and the "no stable step IDs yet" decision so future sessions don't relitigate it.
- "Known cleanup targets": add "consider step IDs once sub-project C needs stable refs" and "the dual `library_category` / `library_tags` cleanup is unchanged".

## 11. Open follow-ups (intentionally left for later sub-projects)

- **B (multi-source ingestion)** will reuse the same `Recipe` shape — no schema work needed there.
- **C (multi-modal extraction)** will likely want stable step IDs and a way to attach an extracted frame to a specific step. The schema is forward-compatible: adding an `id` field to `RecipeStep` with on-read backfill is a small, additive change.
- **E (polished tutorial UI)** consumes whatever this sub-project produces; no additional fields are expected on its first cut.
- **F (background extraction)** changes the parse endpoints' response shape (job ID instead of inline recipe) but does not change `Recipe` itself.
