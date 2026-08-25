# Tutorial Timing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every recipe tutorial stable, editable step metadata—duration, provenance, attention type, and action illustration—so imports are immediately useful and the later cooking-session engine can calculate trustworthy time-weighted progress.

**Architecture:** Normalize tutorial steps once in a pure backend domain module, persist the canonical JSON shape in the existing `recipes.steps` Text column, and expose the same enum contract through `@cooking/shared`. The existing extraction call returns metadata as part of recipe parsing; a separate preview-only enrichment endpoint fills legacy/fallback metadata without saving until the user confirms. Web and mobile consume one semantic contract but use platform-native editors and renderers.

**Tech Stack:** FastAPI, Pydantic v2, async SQLAlchemy, Alembic/PostgreSQL, pytest/pytest-asyncio, Next.js 14, React 18, Expo SDK 54/React Native 0.81, TypeScript, Vitest, Jest/RNTL, CSS Modules, `react-native-svg`.

**Spec:** `docs/superpowers/specs/2026-08-25-cross-platform-guided-cooking-sessions-design.md`

## Global Constraints

- This is sub-project A only. Do not add Cook navigation, sessions, timers, progress, recommendations, synchronization, or notifications here.
- Preserve the two-step import flow: parse into an editable draft, then save only after user review.
- Never invent a new procedural step. Estimation may annotate only the supplied step IDs/text/order.
- Preserve source-stated total time. Derive `ceil(sum(step durations) / 60)` only when total time is absent.
- LLM/stated/fallback durations normalize to 15–86,400 seconds. User-edited durations normalize to 1–86,400 seconds.
- Existing `image_url` values survive parsing, editing, reordering, migration, and save. The UI reset still removes step-image authoring controls.
- Library remains the authenticated landing route. This plan adds no navigation tab.
- Backend/shared Tasks 1–5 may start immediately. Web Tasks 6–7 start only after `2026-08-25-ui-reset-import.md` Tasks 1–2 and `2026-08-25-ui-reset-foundation-core-web.md` Tasks 1 and 4 are integrated. Mobile Task 8 starts only after `2026-08-25-ui-reset-mobile.md` Tasks 1, 2, and 4 are integrated. Re-open and rebase onto those files before editing.
- Reuse the Culinary Workbench tokens and primitives from the UI reset; do not create a second token system or put feature styling into `globals.css`.
- Keep 44px/44pt targets, visible focus, Dynamic Type, VoiceOver labels, and English/Chinese strings.
- Do not modify the user's untracked `backend/.venv_fresh/` or `backend/pytest 2.ini`.
- Deploy backend before web/mobile clients because the expanded response and estimate route are server-owned.

## File and Responsibility Map

```text
backend/app/tutorial.py
  Pure enum, UUID, duration, legacy fallback, and heuristic functions.

backend/app/models.py
  Pydantic API models; canonicalizes a complete Recipe after all fields exist.

backend/app/extract.py
  Import/enrichment prompts, defensive LLM parsing, and ID-preserving merge.

backend/app/api/routes_recipes.py
  Existing parse/create/update routes plus preview-only tutorial estimation.

backend/app/db/repo_recipes.py
  Canonical JSON round-trip for owned/public/copied recipes.

backend/alembic/versions/20260825_step_meta.py
  Immutable backfill for existing JSON-in-Text recipe steps.

packages/shared/src/recipeTutorial.ts
  Cross-client enums, draft factory, metadata labels, and vector primitive data.

packages/api-client/src/index.ts
  Typed estimate-tutorial request used by mobile and future Cook clients.

apps/web/app/import/*
  Import-review editing of timing, attention, and action metadata.

apps/web/app/recipe/[id]/*
  Tutorial read view, pictograms, and focused edit mode.

apps/mobile/src/features/import/*
  Native metadata editor shared by import review and saved-recipe editing.

apps/mobile/src/features/library/*
  Native tutorial read view, pictograms, and focused edit mode.
```

The canonical API step is:

```json
{
  "id": "3b471fb2-7679-4c16-a442-4d53ec5c0bf2",
  "text": "Simmer gently until the sauce thickens.",
  "duration_seconds": 480,
  "duration_source": "estimated",
  "attention_type": "passive",
  "action_type": "simmer",
  "image_url": null
}
```

---

### Task 1: Canonical backend step metadata and fallback rules

**Files:**
- Create: `backend/app/tutorial.py`
- Create: `backend/tests/test_tutorial.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/api/_types.py`

**Interfaces:**
- Produces `DURATION_SOURCES`, `ATTENTION_TYPES`, and `ACTION_TYPES`.
- Produces `parse_step_rows(raw: object) -> list[dict[str, object]]` for request-shape compatibility while keeping the domain helper independent of Pydantic.
- Produces `normalize_step_payloads(raw, total_time_minutes, id_factory=...) -> list[dict]`.
- `RecipeCreate` consumes the complete normalized list in an `after` model validator, then derives total time only when missing.
- `RecipeStep` emits non-null `id`, `duration_source`, `attention_type`, and `action_type` whenever nested in a valid `Recipe`.

- [ ] **Step 1: Write failing enum, validation, and UUID tests**

Create `backend/tests/test_tutorial.py` with explicit fixtures:

```python
def test_recipe_step_contract_and_legacy_known_duration():
    recipe = make_recipe(steps=[{"text": "Stir", "duration_seconds": 5}])
    step = recipe.steps[0]
    assert UUID(step.id)
    assert step.duration_seconds == 15
    assert step.duration_source == "stated"
    assert step.attention_type == "hands_on"
    assert step.action_type == "other"

def test_user_duration_accepts_one_second():
    step = make_recipe(steps=[{
        "text": "Taste",
        "duration_seconds": 1,
        "duration_source": "user",
        "attention_type": "hands_on",
        "action_type": "season",
    }]).steps[0]
    assert step.duration_seconds == 1
```

Also assert invalid enum values become `fallback` / `hands_on` / `other`, durations above 86,400 clamp, empty-text rows disappear, valid UUIDs survive reordering, and duplicate/missing IDs are regenerated uniquely.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_tutorial.py -q`

Expected: FAIL because the expanded step fields and normalization module do not exist.

- [ ] **Step 3: Implement constants and row parsing**

In `backend/app/tutorial.py`, define the closed contract and keep this module free of Pydantic/database imports:

```python
DurationSource = Literal["stated", "estimated", "user", "fallback"]
AttentionType = Literal["hands_on", "passive"]
ActionType = Literal[
    "prep", "chop", "mix", "season", "sear", "simmer", "boil",
    "bake", "rest", "drain", "assemble", "plate", "other",
]

GENERATED_MIN_SECONDS = 15
USER_MIN_SECONDS = 1
MAX_STEP_SECONDS = 86_400
DEFAULT_FALLBACK_SECONDS = 300
```

`parse_step_rows` must accept legacy strings and dictionaries, trim text, drop unsupported/empty rows, and retain unknown dictionary keys until canonical normalization decides what to keep. `models.py` converts an already-instantiated `RecipeStep` with `model_dump(exclude_unset=True)` before calling the pure helper.

- [ ] **Step 4: Implement deterministic legacy fallback**

Normalize in two passes so every missing duration uses the same recipe context:

```python
normalized = normalize_step_payloads(
    raw_steps,
    total_time_minutes=10,
    id_factory=fixed_uuid_factory,
)
```

Rules, in order:

1. Preserve a valid legacy duration with no source and label it `stated`.
2. If total time exists and has positive remaining seconds, distribute the remainder across missing steps; use integer `divmod` and a 60-second minimum per missing step.
3. Otherwise use the median of valid known durations, rounded to a whole second.
4. With no known duration, use 300 seconds.
5. Generated/stated/fallback values clamp to 15–86,400; `user` values clamp to 1–86,400.
6. Missing/invalid metadata becomes `fallback`, `hands_on`, and `other` without rejecting import.

Add table-driven tests for:

```python
([240, None, None], 10, [240, 180, 180])
([120, 300, None], None, [120, 300, 210])
([None], None, [300])
```

- [ ] **Step 5: Expand Pydantic models and derive missing total time**

Add fields to `RecipeStep`. Use `model_dump(exclude_unset=True)` when normalizing already-instantiated steps so legacy field absence is still distinguishable from an explicit value. Replace the current step-only field validator with an `@model_validator(mode="after")` on `RecipeCreate`:

```python
self.steps = coerce_steps(self.steps, self.total_time_minutes)
if self.total_time_minutes is None and self.steps:
    seconds = sum(step.duration_seconds or 0 for step in self.steps)
    self.total_time_minutes = math.ceil(seconds / 60)
return self
```

Keep a lightweight `BeforeValidator(parse_step_rows)` in `StepList` so PATCH accepts legacy strings, but defer cross-step fallback until the route reconstructs the complete Recipe.

- [ ] **Step 6: Run focused backend tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_tutorial.py -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/tutorial.py backend/app/models.py backend/app/api/_types.py backend/tests/test_tutorial.py
git commit -m "feat(tutorial): normalize recipe step timing metadata"
```

### Task 2: Stable-ID migration and repository round-trip

**Files:**
- Create: `backend/alembic/versions/20260825_step_meta.py`
- Create: `backend/tests/test_tutorial_step_migration.py`
- Create: `backend/tests/test_recipe_tutorial_repository.py`
- Modify: `backend/app/db/repo_recipes.py`

**Interfaces:**
- Migration revises `20260514_recipe_tut`; it adds no SQL column.
- Existing `recipes.steps` JSON arrays gain canonical metadata in place.
- Repository read/save always passes `total_time_minutes` into canonical normalization.
- Public/friend copies preserve the source step IDs and all metadata.

- [ ] **Step 1: Write the failing migration-helper test**

Load the migration module and exercise a pure helper rather than requiring Postgres in the unit test:

```python
raw = json.dumps([
    {"text": "Chop onion", "duration_seconds": 120},
    {"text": "Bake until golden", "image_url": "/uploads/bake.jpg"},
])
upgraded = json.loads(migration._upgrade_steps_json(raw, 12, id_factory=fixed_ids))
assert [step["duration_seconds"] for step in upgraded] == [120, 600]
assert upgraded[0]["duration_source"] == "stated"
assert upgraded[1]["duration_source"] == "fallback"
assert upgraded[1]["image_url"] == "/uploads/bake.jpg"
```

Assert a second pass preserves IDs and values. Assert malformed/non-array JSON becomes `[]` rather than aborting the whole deployment.

- [ ] **Step 2: Run and verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_tutorial_step_migration.py -q`

Expected: FAIL because the revision does not exist.

- [ ] **Step 3: Implement the data migration**

Use `op.get_bind()` plus parameterized SQL:

```python
rows = bind.execute(
    sa.text("SELECT id, steps, total_time_minutes FROM recipes")
).mappings()
for row in rows:
    upgraded = _upgrade_steps_json(row["steps"], row["total_time_minutes"])
    bind.execute(
        sa.text("UPDATE recipes SET steps = :steps WHERE id = :id"),
        {"id": row["id"], "steps": upgraded},
    )
```

Copy the small pure normalization logic into the revision instead of importing live application code; migrations must remain runnable after application modules evolve. Document that downgrade removes the four added metadata keys but keeps text, resolved duration, and image URL.

- [ ] **Step 4: Write failing repository persistence tests**

Test `_row_to_recipe` with a `SimpleNamespace` legacy row and `save_recipe` with a recording async session. Assert:

- read returns stable canonical metadata;
- save JSON contains all seven fields;
- saving the returned recipe a second time keeps the same IDs;
- `image_url` survives;
- `copy_public_recipe_to_user` returns the same canonical step metadata as its source.

- [ ] **Step 5: Update repository normalization**

Change both read and write paths to include total time:

```python
steps=coerce_steps(steps_raw, row.total_time_minutes)
# ...
steps_list = coerce_steps(recipe.steps, recipe.total_time_minutes)
```

Do not create a new relational step table in this sub-project; cooking-session snapshots are handled by sub-project B.

- [ ] **Step 6: Run migration and repository tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_tutorial_step_migration.py tests/test_recipe_tutorial_repository.py -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/20260825_step_meta.py backend/app/db/repo_recipes.py backend/tests/test_tutorial_step_migration.py backend/tests/test_recipe_tutorial_repository.py
git commit -m "feat(tutorial): backfill stable recipe step metadata"
```

### Task 3: Import prompt, parser, and deterministic stub

**Files:**
- Create: `backend/tests/test_extract_tutorial.py`
- Modify: `backend/app/extract.py`

**Interfaces:**
- Existing `extract_recipe_from_text(transcript) -> Recipe` signature stays unchanged.
- `_build_extraction_prompt` asks the existing model call for metadata; no second LLM call is added to normal imports.
- `parse_llm_recipe_response` preserves instructions and defensively normalizes only metadata.
- Stub extraction returns the same canonical shape for local development without `OPENAI_API_KEY`.

- [ ] **Step 1: Write failing prompt-contract tests**

Assert the prompt names all required fields and exact enums, contains “do not add, split, merge, or invent procedural steps,” distinguishes stated from estimated duration, and requires positive whole seconds.

```python
prompt = _build_extraction_prompt("小火煮到浓稠")
assert "duration_source" in prompt
assert '"hands_on" or "passive"' in prompt
assert "simmer" in prompt
assert "DO NOT invent" in prompt
```

- [ ] **Step 2: Write failing parser fixtures**

Cover:

- English and CJK text remains unchanged;
- stated duration/source is preserved;
- estimated duration/source is preserved;
- missing/invalid duration source is relabeled `fallback`;
- invalid attention/action values become `hands_on`/`other`;
- 2 seconds from generated output becomes 15;
- missing total derives from normalized durations;
- `steps: []` stays empty;
- malformed JSON returns a safe empty draft.

- [ ] **Step 3: Run and verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_extract_tutorial.py -q`

Expected: FAIL against the current `{text, duration_seconds}` prompt/parser.

- [ ] **Step 4: Expand the extraction prompt**

Request this step shape:

```json
{
  "text": "...",
  "duration_seconds": 480,
  "duration_source": "stated",
  "attention_type": "passive",
  "action_type": "simmer"
}
```

Prompt rules:

- `stated` only when duration is explicit in source;
- otherwise estimate and use `estimated`;
- hands-on means the user is actively working; passive means they may safely leave the step until attention is needed;
- action type must be one of the 13 supported values;
- metadata may be inferred, but procedure may not be invented.

- [ ] **Step 5: Parse metadata defensively and update the stub**

Copy only supported keys. Explicitly insert fallback markers when the LLM omits or corrupts metadata so a numeric duration without provenance is not mislabeled as source-stated. Let `Recipe(...)` perform final clamping, ID generation, and missing-total derivation.

Update Mapo Tofu stub steps with realistic metadata, for example chop/prep hands-on and simmer passive. Keep the generic no-procedure stub at `steps: []`.

- [ ] **Step 6: Run focused and model tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_extract_tutorial.py tests/test_tutorial.py -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/extract.py backend/tests/test_extract_tutorial.py
git commit -m "feat(import): estimate tutorial step metadata"
```

### Task 4: Preview-only “Estimate missing tutorial details” endpoint

**Files:**
- Modify: `backend/app/extract.py`
- Modify: `backend/app/api/routes_recipes.py`
- Create: `backend/tests/test_tutorial_estimation.py`
- Create: `backend/tests/test_recipe_tutorial_routes.py`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Produces `estimate_tutorial_step_metadata(steps) -> list[RecipeStep]`.
- Adds `POST /recipes/{recipe_id}/tutorial/estimate`.
- Request: `{ "steps": RecipeStep[] }`; response: `{ "steps": RecipeStep[] }`.
- Endpoint verifies recipe ownership but does not call `save_recipe`; PATCH remains the only save.
- API client adds `recipes.estimateTutorial(id, steps)`.

- [ ] **Step 1: Write failing ID-preserving estimator tests**

Mock the OpenAI client response with metadata keyed by step ID. Assert the service:

- returns the caller's original order, IDs, text, and image URLs;
- ignores returned unknown IDs;
- never adds, deletes, splits, or merges steps;
- preserves `stated`, `estimated`, and `user` durations;
- upgrades only `fallback` duration provenance to `estimated` when valid LLM data exists;
- defaults malformed output locally rather than failing the editor.

```python
assert [(s.id, s.text) for s in result] == [(s.id, s.text) for s in original]
assert result[0].duration_source == "user"
assert result[1].duration_source == "estimated"
```

- [ ] **Step 2: Implement metadata-only prompting and merge**

Send numbered records containing `id`, `text`, and current metadata. Ask the model to return only `id`, `duration_seconds`, `attention_type`, and `action_type`. Merge by ID; never accept text or order from the response.

When no OpenAI client exists, use deterministic keyword classification from `backend/app/tutorial.py` (for example bake/simmer/boil/rest → passive and matching action types) while keeping `duration_source="fallback"` so the UI remains transparent that no AI estimate occurred.

- [ ] **Step 3: Write failing route tests**

Call the route function directly with monkeypatched repository/service functions:

```python
result = await routes_recipes.recipe_estimate_tutorial(
    recipe_id=recipe.id,
    body=EstimateTutorialBody(steps=recipe.steps),
    session=session,
    current_user=user,
)
assert result.steps == estimated
assert save_calls == []
```

Also assert a missing/non-owned recipe returns 404 and the estimator is not called.

- [ ] **Step 4: Add the preview-only route**

Use response models:

```python
class EstimateTutorialBody(BaseModel):
    steps: StepList

class EstimateTutorialResponse(BaseModel):
    steps: list[RecipeStep]
```

Fetch the owned recipe first. Re-canonicalize the submitted draft using the owned recipe's total time, estimate metadata, and return it. Do not mutate or flush the database.

- [ ] **Step 5: Revalidate PATCH updates**

Replace validation-skipping `model_copy(update=updates)` in `recipe_update` with:

```python
updated = Recipe.model_validate({**r.model_dump(), **updates})
```

This ensures new/reordered/edited step rows pass through canonical normalization and duration edits marked `user` remain valid.

- [ ] **Step 6: Add the typed API-client method**

```ts
estimateTutorial: (id: string, steps: RecipeStep[]) =>
  json<{ steps: RecipeStep[] }>(
    `/recipes/${encodeURIComponent(id)}/tutorial/estimate`,
    { method: "POST", body: JSON.stringify({ steps }) },
  ),
```

- [ ] **Step 7: Run focused backend tests and TypeScript checks**

Run: `cd backend && .venv/bin/python -m pytest tests/test_tutorial_estimation.py tests/test_recipe_tutorial_routes.py -q`

Run: `npx tsc -p packages/api-client/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/tutorial.py backend/app/extract.py backend/app/api/routes_recipes.py backend/tests/test_tutorial_estimation.py backend/tests/test_recipe_tutorial_routes.py packages/api-client/src/index.ts
git commit -m "feat(tutorial): preview missing step estimates"
```

### Task 5: Shared TypeScript contract, labels, and pictogram data

**Files:**
- Create: `packages/shared/src/recipeTutorial.ts`
- Create: `apps/web/app/lib/recipeTutorial.test.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Exports `RecipeDurationSource`, `RecipeAttentionType`, `RecipeActionType`.
- Exports `RECIPE_ACTION_TYPES`, localized action/source/attention message-key maps, `createRecipeStep()`, `formatRecipeStepMetadata(step, t)`, and `RECIPE_ACTION_ILLUSTRATIONS`.
- Each illustration is renderer-neutral vector primitive data; web renders it in SVG and mobile renders it with `react-native-svg`.

- [ ] **Step 1: Write failing shared-contract tests through Vitest**

Create the test inside the web workspace so no new shared-package runner is needed:

```ts
expect(RECIPE_ACTION_TYPES).toEqual([
  "prep", "chop", "mix", "season", "sear", "simmer", "boil",
  "bake", "rest", "drain", "assemble", "plate", "other",
]);
expect(Object.keys(RECIPE_ACTION_ILLUSTRATIONS).sort()).toEqual(
  [...RECIPE_ACTION_TYPES].sort(),
);
expect(formatRecipeStepMetadata(step, t)).toBe(
  "About 8 min · AI estimated · Passive",
);
```

Assert `createRecipeStep()` returns a valid UUID, fresh IDs per call, `duration_seconds: 300`, `duration_source: "fallback"`, `attention_type: "hands_on"`, and `action_type: "other"`.

- [ ] **Step 2: Run and verify failure**

Run: `npm --workspace @cooking/web test -- recipeTutorial.test.ts`

Expected: FAIL because the shared tutorial module does not exist.

- [ ] **Step 3: Expand the shared recipe contract**

Make API `RecipeStep.id` required. New unsaved rows must come from `createRecipeStep`, which uses `crypto.getRandomValues` when available and a UUID-v4-compatible fallback otherwise.

```ts
export interface RecipeStep {
  id: string;
  text: string;
  duration_seconds: number;
  duration_source: RecipeDurationSource;
  attention_type: RecipeAttentionType;
  action_type: RecipeActionType;
  image_url?: string | null;
}
```

Temporary backward-compatible parsing belongs at API/import boundaries, not in this canonical interface.

- [ ] **Step 4: Add metadata localization**

Add English and Chinese keys for:

- About seconds/minutes/hours;
- From recipe / AI estimated / Adjusted / Rough estimate;
- Hands-on / Passive;
- all 13 action names;
- Duration / Attention / Illustration;
- Estimate missing tutorial details and its loading/error states;
- Edit tutorial, Save tutorial, Cancel, and no-steps guidance.

`formatRecipeStepMetadata` joins localized segments with ` · ` and omits no segment for canonical steps. Use seconds below 60, rounded-up minutes below 60 minutes, and a localized hour/minute label above that.

- [ ] **Step 5: Define the custom vector primitive set**

Use a 48×48 view box and a small schema:

```ts
type RecipeVectorPrimitive =
  | { kind: "path"; d: string; fill?: "accent" | "ink" | "surface" }
  | { kind: "circle"; cx: number; cy: number; r: number; fill?: "accent" | "ink" | "surface" }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number };
```

Create simple, rounded pictograms for knife/chop, bowl/mix, shaker/season, pan/sear, pot/simmer/boil, oven/bake, covered bowl/rest, colander/drain, layers/assemble, plate/plate, mise-en-place/prep, and a neutral recipe-card/other. Do not use emoji or embed localized text in artwork.

- [ ] **Step 6: Run shared tests and consumer typechecks**

Run: `npm --workspace @cooking/web test -- recipeTutorial.test.ts`

Run: `npx tsc -p packages/shared/tsconfig.json --noEmit`

Run: `npx tsc -p packages/api-client/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/recipeTutorial.ts packages/shared/src/types.ts packages/shared/src/index.ts packages/shared/src/messages/en.json packages/shared/src/messages/zh.json apps/web/app/lib/recipeTutorial.test.ts
git commit -m "feat(shared): define tutorial metadata and pictograms"
```

### Task 6: Web import-review metadata editing

**Dependency checkpoint:** Confirm the UI-reset import Tasks 1–2 are present. Re-open `DraftRecipeEditor.tsx`, `StepListEditor.tsx`, and `ImportFlow.module.css`; preserve their Source → Review hierarchy and lack of step-image authoring.

**Files:**
- Create: `apps/web/app/import/StepListEditor.test.tsx`
- Modify: `apps/web/app/import/StepListEditor.tsx`
- Modify: `apps/web/app/import/DraftRecipeEditor.tsx`
- Modify: `apps/web/app/import/DraftRecipeEditor.test.tsx`
- Modify: `apps/web/app/import/DurationField.tsx`
- Modify: `apps/web/app/import/ImportFlow.module.css`

**Interfaces:**
- Existing `StepListEditor({ steps, onChange })` signature remains.
- Duration edits emit the same step with `duration_source: "user"`.
- Attention/action edits preserve duration provenance, ID, text, and hidden `image_url`.
- Add creates a canonical new step; reorder preserves IDs.

- [ ] **Step 1: Write failing editor behavior tests**

```tsx
render(<StepListEditor steps={[estimatedStep]} onChange={onChange} />);
expect(screen.getByText("AI estimated")).toBeVisible();
await user.clear(screen.getByLabelText("Step 1 minutes"));
await user.type(screen.getByLabelText("Step 1 minutes"), "3");
expect(lastSteps()[0]).toMatchObject({
  id: estimatedStep.id,
  duration_seconds: 180,
  duration_source: "user",
});
```

Also test Hands-on/Passive selection, all action options, add/remove/reorder, ID stability, 1-second user duration, and preservation of a pre-existing `image_url` even though no image button appears.

- [ ] **Step 2: Run and verify failure**

Run: `npm --workspace @cooking/web test -- StepListEditor.test.tsx DraftRecipeEditor.test.tsx`

Expected: FAIL because metadata controls are absent.

- [ ] **Step 3: Make duration editing provenance-aware**

Extend `DurationField` with per-input labels and clamp UI input to the user range. In `StepListEditor`:

```ts
const setDuration = (index: number, duration_seconds: number | null) =>
  updateAt(index, {
    ...steps[index],
    duration_seconds: Math.max(1, Math.min(86_400, duration_seconds ?? 1)),
    duration_source: "user",
  });
```

Do not silently turn a cleared field into zero; show a local validation state until a positive value is entered, and disable Save through `DraftRecipeEditor` while a row is invalid.

- [ ] **Step 4: Add attention and illustration controls**

Use an accessible two-option control for attention and a native `<select>` for action illustration. Place the transparent metadata label beside the step controls. Keep move/remove controls 44px and label them with step number.

- [ ] **Step 5: Add canonical rows and preserve hidden data**

Use `createRecipeStep()` for Add. Updates must spread the existing step before changing one field; no edit may discard `id` or `image_url`. Keep UI-reset behavior that hides step image authoring.

- [ ] **Step 6: Run focused tests, typecheck, and build**

Run: `npm --workspace @cooking/web test -- StepListEditor.test.tsx DraftRecipeEditor.test.tsx`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run: `npm --workspace @cooking/web run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/import/StepListEditor.tsx apps/web/app/import/StepListEditor.test.tsx apps/web/app/import/DraftRecipeEditor.tsx apps/web/app/import/DraftRecipeEditor.test.tsx apps/web/app/import/DurationField.tsx apps/web/app/import/ImportFlow.module.css
git commit -m "feat(web): edit tutorial timing during import"
```

### Task 7: Web tutorial read view, pictograms, and focused edit mode

**Dependency checkpoint:** Confirm the UI-reset web foundation Tasks 1 and 4 are present. Add to the final `RecipeDetail.module.css`; do not restore old `globals.css` recipe rules.

**Files:**
- Create: `apps/web/app/components/RecipeStepIllustration.tsx`
- Create: `apps/web/app/components/RecipeStepIllustration.module.css`
- Create: `apps/web/app/components/RecipeStepIllustration.test.tsx`
- Create: `apps/web/app/recipe/[id]/RecipeTutorial.tsx`
- Create: `apps/web/app/recipe/[id]/RecipeTutorial.test.tsx`
- Create: `apps/web/app/recipe/[id]/tutorial/edit/page.tsx`
- Create: `apps/web/app/recipe/[id]/tutorial/edit/TutorialEdit.module.css`
- Create: `apps/web/app/recipe/[id]/tutorial/edit/page.test.tsx`
- Modify: `apps/web/app/recipe/[id]/page.tsx`
- Modify: `apps/web/app/recipe/[id]/RecipeDetail.module.css`

**Interfaces:**
- `RecipeStepIllustration({ actionType, title, size? })` renders shared vector data with `role="img"` and localized label.
- `RecipeTutorial({ recipe })` renders real step image when present, otherwise illustration.
- `/recipe/{id}/tutorial/edit` fetches owned recipe, previews estimation, PATCHes only `steps`, and returns to `/recipe/{id}`.

- [ ] **Step 1: Write failing illustration and read-view tests**

Assert every action renders an SVG, `aria-label` includes the action, no emoji appears, a real `image_url` takes precedence, and the label reads `About 8 min · AI estimated · Passive`.

```tsx
expect(screen.getByRole("img", { name: /Simmer illustration/i })).toBeVisible();
expect(screen.getByText("About 8 min · AI estimated · Passive")).toBeVisible();
expect(screen.getByRole("link", { name: "Edit tutorial" })).toHaveAttribute(
  "href",
  `/recipe/${recipe.id}/tutorial/edit`,
);
```

- [ ] **Step 2: Implement the SVG renderer and tutorial section**

Map renderer-neutral primitives to `<path>`, `<circle>`, and `<line>`. Use `currentColor`/CSS variables from the UI reset. Keep illustrations decorative only when the real step text already labels the group; otherwise provide the explicit accessible title. Wrap real step images in a tiny component that switches to the action illustration after `onError`, so a broken URL does not leave an empty frame.

Use `step.id` as the React key. The empty tutorial state must offer Edit tutorial instead of silently hiding the section.

- [ ] **Step 3: Write failing focused-editor lifecycle tests**

Mock `apiFetch` and router. Assert:

- initial GET loads a copy into local draft state;
- Estimate POST updates the local form but sends no PATCH;
- Cancel returns to detail with no PATCH;
- Save PATCHes `{ steps }` only and returns to detail;
- estimate failure keeps edits and shows a local retryable error;
- Save failure keeps the editor and draft intact.

- [ ] **Step 4: Implement focused tutorial editing**

Wrap in `RequireAuth`. Reuse `StepListEditor`; do not duplicate its metadata logic. Disable Estimate when no step has fallback metadata or while a request is running.

```ts
const response = await apiFetch(`/recipes/${id}/tutorial/estimate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ steps: draftSteps }),
});
if (!response.ok) throw new Error(await response.text());
const estimated = (await response.json()) as { steps: RecipeStep[] };
setDraftSteps(estimated.steps);
```

Do not mutate the original fetched recipe. Cancel simply routes back; only Save issues PATCH.

- [ ] **Step 5: Integrate the read view into recipe detail**

Replace the inline step `<ol>` with `RecipeTutorial`. Keep the existing full-recipe Edit action, and add a secondary Edit tutorial action at the tutorial heading/empty state. Preserve planner and source-video actions.

- [ ] **Step 6: Run web tests, accessibility checks, and build**

Run: `npm --workspace @cooking/web test -- RecipeStepIllustration.test.tsx RecipeTutorial.test.tsx 'tutorial/edit/page.test.tsx'`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run: `npm --workspace @cooking/web run build`

Expected: PASS with no invalid nested interactive controls and no missing translation keys.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/RecipeStepIllustration.tsx apps/web/app/components/RecipeStepIllustration.module.css apps/web/app/components/RecipeStepIllustration.test.tsx 'apps/web/app/recipe/[id]/RecipeTutorial.tsx' 'apps/web/app/recipe/[id]/RecipeTutorial.test.tsx' 'apps/web/app/recipe/[id]/tutorial/edit/page.tsx' 'apps/web/app/recipe/[id]/tutorial/edit/TutorialEdit.module.css' 'apps/web/app/recipe/[id]/tutorial/edit/page.test.tsx' 'apps/web/app/recipe/[id]/page.tsx' 'apps/web/app/recipe/[id]/RecipeDetail.module.css'
git commit -m "feat(web): add editable timed recipe tutorials"
```

### Task 8: Native import/detail tutorial parity

**Dependency checkpoint:** Confirm mobile UI-reset Tasks 1, 2, and 4 are present. Preserve its native modal, current theme primitives, safe areas, and vertical phone workflow.

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `package-lock.json`
- Create: `apps/mobile/src/components/RecipeStepIllustration.tsx`
- Create: `apps/mobile/src/components/RecipeStepIllustration.test.tsx`
- Create: `apps/mobile/src/features/import/StepListEditor.test.tsx`
- Modify: `apps/mobile/src/features/import/DurationField.tsx`
- Modify: `apps/mobile/src/features/import/StepListEditor.tsx`
- Modify: `apps/mobile/src/features/import/DraftRecipeEditor.tsx`
- Modify: `apps/mobile/src/features/import/ImportModalScreen.test.tsx`
- Modify: `apps/mobile/src/features/library/RecipeDetailScreen.tsx`
- Modify: `apps/mobile/src/features/library/RecipeEditScreen.tsx`
- Create: `apps/mobile/src/features/library/RecipeEditScreen.test.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`

**Interfaces:**
- Adds direct Expo-compatible `react-native-svg` dependency.
- Native editor matches the web metadata contract and preserves IDs/images.
- `RecipeEdit` route accepts `{ recipeId, focus?: "recipe" | "tutorial" }`.
- Tutorial focus saves only steps and Cancel/Back leaves the stored recipe untouched.

- [ ] **Step 1: Install the Expo-compatible SVG renderer**

Run: `cd apps/mobile && npx expo install react-native-svg`

Expected: `apps/mobile/package.json` and the root lockfile gain the SDK-compatible version. Do not hand-pick a version that conflicts with Expo 54.

- [ ] **Step 2: Write failing native editor tests**

Using RNTL, assert:

- metadata labels render;
- changing duration emits `duration_source: "user"`;
- the Hands-on/Passive control exposes selected state;
- pressing Illustration opens an accessible modal/action list and choosing Simmer emits `action_type: "simmer"`;
- Add creates a unique ID;
- reorder preserves IDs and images;
- all interactive targets are at least 44pt.

- [ ] **Step 3: Implement native metadata controls**

Reuse `SegmentedControl` for attention. Use a labeled 44pt Pressable plus a native `Modal` list for the 13 illustration options; do not squeeze them into one horizontal row. Mark duration source `user` on valid change and show local validation without dropping the draft.

Keep `DraftRecipeEditor` capable of full import review and add `focus="tutorial"` to render only tutorial heading, estimate action, step editor, Save, and Cancel.

- [ ] **Step 4: Write failing native illustration/detail tests**

Assert shared primitive data renders through `Svg`, `Path`, `Circle`, and `Line`; real Expo `Image` wins when `image_url` exists; labels are localized; and empty steps display an Edit tutorial action.

- [ ] **Step 5: Implement native pictograms and detail section**

Render the same 48×48 shared vector definitions with `react-native-svg`, platform theme colors, and an accessibility label. Replace the timer emoji currently used on detail with the transparent metadata text. Use `step.id` keys. Track Expo Image load failure per step and replace a failed real image with its action illustration.

- [ ] **Step 6: Implement focused saved-recipe editing**

Expand the route type:

```ts
RecipeEdit: { recipeId?: string; focus?: "recipe" | "tutorial" } | undefined;
```

From the tutorial section, navigate with `focus: "tutorial"`. In `RecipeEditScreen`:

- GET the recipe as today;
- keep Estimate results local through `apiClient.recipes.estimateTutorial`;
- PATCH `{ steps: draft.steps }` only in tutorial focus;
- PATCH the current full payload in recipe focus;
- go back only after successful save;
- never call PATCH on cancel.

- [ ] **Step 7: Run native focused tests and typecheck**

Run: `npm --workspace @cooking/mobile test -- StepListEditor.test.tsx RecipeStepIllustration.test.tsx RecipeEditScreen.test.tsx ImportModalScreen.test.tsx`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/package.json package-lock.json apps/mobile/src/components/RecipeStepIllustration.tsx apps/mobile/src/components/RecipeStepIllustration.test.tsx apps/mobile/src/features/import/DurationField.tsx apps/mobile/src/features/import/StepListEditor.tsx apps/mobile/src/features/import/StepListEditor.test.tsx apps/mobile/src/features/import/DraftRecipeEditor.tsx apps/mobile/src/features/import/ImportModalScreen.test.tsx apps/mobile/src/features/library/RecipeDetailScreen.tsx apps/mobile/src/features/library/RecipeEditScreen.tsx apps/mobile/src/features/library/RecipeEditScreen.test.tsx apps/mobile/src/navigation/types.ts
git commit -m "feat(mobile): add editable timed recipe tutorials"
```

### Task 9: Contract documentation and end-to-end verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `backend/README.md`
- Modify: `apps/web/e2e/import.spec.ts`
- Create: `apps/web/e2e/tutorial.spec.ts`

**Interfaces:**
- Documents the new recipe step fields, fallback semantics, API endpoint, Alembic head, and test commands.
- Browser tests verify import review and focused edit without entering any Cook/session flow.

- [ ] **Step 1: Extend browser fixtures and write failing flows**

In import E2E, return parsed steps containing estimated/passive/simmer metadata. Assert the review shows and edits them, POST includes IDs and metadata, and save opens recipe detail.

In tutorial E2E, mock GET/estimate/PATCH and assert:

1. Detail shows a pictogram and transparent label.
2. Edit tutorial opens the focused route.
3. Estimate previews without PATCH.
4. Cancel performs no PATCH.
5. Re-open, edit duration, Save sends `duration_source: "user"` and returns to detail.

- [ ] **Step 2: Run focused browser tests**

Run: `npm --workspace @cooking/web run test:e2e -- import.spec.ts tutorial.spec.ts`

Expected: PASS after Tasks 6–8.

- [ ] **Step 3: Update authoritative documentation**

Update `CLAUDE.md`:

- product summary and import behavior;
- web/mobile recipe detail and tutorial edit surfaces;
- API table with `POST /recipes/{id}/tutorial/estimate` and its preview-only behavior;
- `RecipeStep` contract, normalization/fallback, and no-silent-rewrite rule;
- Alembic head `20260825_step_meta`;
- correct the stale “no tests” statement to list pytest, Vitest, Jest, and Playwright commands.

Update `backend/README.md` with migration and focused pytest commands if its current examples do not cover the new tests.

- [ ] **Step 4: Run the complete backend suite**

Run: `cd backend && .venv/bin/python -m pytest -q`

Expected: PASS.

- [ ] **Step 5: Apply the migration against the local Docker database**

Run: `docker compose up -d db`

Run: `docker compose run --rm backend alembic upgrade head`

Run: `docker compose run --rm backend alembic current`

Expected: current revision is `20260825_step_meta (head)`. Inspect at least one migrated recipe row and confirm repeat reads return the same step IDs.

- [ ] **Step 6: Run cross-platform verification**

Run: `npm run test:web`

Run: `npm run test:mobile`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Run: `npm run web:build`

Expected: all commands exit zero.

- [ ] **Step 7: Manual accessibility/localization verification**

On web phone/desktop and native phone:

- import a transcript with one explicit duration and one missing duration;
- verify stated vs AI-estimated/fallback labels;
- edit duration, attention, and action; reorder; save; reopen;
- verify IDs/metadata/images persist;
- verify real images override pictograms and broken/no images use pictograms;
- verify keyboard/VoiceOver can identify every control and action illustration;
- verify English and Chinese labels do not clip at large text;
- verify Cancel after Estimate leaves the stored recipe unchanged.

- [ ] **Step 8: Commit verification and documentation**

```bash
git add CLAUDE.md backend/README.md apps/web/e2e/import.spec.ts apps/web/e2e/tutorial.spec.ts
git commit -m "test(tutorial): verify timing foundation end to end"
```

## Final Acceptance Gate

- Every persisted recipe step has a stable UUID and canonical metadata.
- Import returns stated or estimated duration metadata in the original procedural order.
- Invalid/missing metadata degrades to transparent fallback values instead of rejecting the draft.
- Users can edit text, duration, attention, and action during import and from recipe detail on web/mobile.
- User duration edits persist with `duration_source="user"`.
- Estimate is preview-only until Save; Cancel does not mutate the recipe.
- Detail views show real step images when present and custom cross-platform pictograms otherwise.
- Total time is preserved when source-stated and derived only when absent.
- No Cook/session/timer/progress/navigation behavior is introduced by this plan.
- Backend pytest, web Vitest/Playwright/build, mobile Jest, and both TypeScript checks pass.
