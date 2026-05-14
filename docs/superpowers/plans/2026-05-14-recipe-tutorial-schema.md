# Recipe Tutorial Schema Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. If executing in isolation, create a worktree via superpowers:using-git-worktrees first.

**Goal:** Add `description`, `total_time_minutes`, `tips`, `equipment`, and a structured `steps` array (text + optional duration + optional image) to `Recipe`, with a basic editor and read view on both web and mobile. Legacy recipes render unchanged.

**Architecture:** Five new nullable columns on `recipes` (Text JSON arrays for the three lists, native scalars for description / total time). All new fields flow through Pydantic validators that mirror the existing `coerce_library_tags` pattern. Web & mobile share a small set of editor sub-components per platform; reads use the same Pydantic shape. No new infra, no new env vars, no JSONB, no async jobs.

**Tech Stack:** FastAPI + async SQLAlchemy + Alembic; Pydantic v2; Next.js 14 App Router (web); Expo SDK 54 / React Native 0.81 (mobile); `@cooking/shared` workspace package.

**Repo testing reality:** This repo has **no unit-test infrastructure** (no pytest/jest/vitest). Per CLAUDE.md, verification is done via (a) Alembic migration apply, (b) targeted Python REPL one-liners that exercise pure functions, (c) shell smoke scripts that hit live endpoints, (d) `tsc --noEmit` + `npm --workspace @cooking/web run build`, and (e) manual click-through. Every task below ends with a concrete verify command instead of `pytest`.

**Spec:** `docs/superpowers/specs/2026-05-14-recipe-tutorial-schema-design.md`

---

## Phase 1 — Backend types & DB schema

### Task 1: Add `RecipeStep` model + validators in `app/models.py`

**Files:**
- Modify: `backend/app/models.py`

- [ ] **Step 1: Add `RecipeStep` Pydantic model below `IngredientItem`**

In `backend/app/models.py`, after the `IngredientItem` class definition, add:

```python
class RecipeStep(BaseModel):
    text: str
    duration_seconds: Optional[int] = None
    image_url: Optional[str] = None

    @field_validator("text", mode="before")
    @classmethod
    def _trim_text(cls, v: object) -> str:
        if v is None:
            return ""
        if not isinstance(v, str):
            raise ValueError("step text must be a string")
        return v.strip()

    @field_validator("duration_seconds", mode="before")
    @classmethod
    def _nonneg_duration(cls, v: object) -> Optional[int]:
        if v is None or v == "":
            return None
        try:
            n = int(v)
        except (TypeError, ValueError):
            return None
        return n if n >= 0 else None

    @field_validator("image_url", mode="before")
    @classmethod
    def _trim_image_url(cls, v: object) -> Optional[str]:
        if v is None:
            return None
        if not isinstance(v, str):
            return None
        s = v.strip()
        return s or None
```

- [ ] **Step 2: Add `coerce_steps` helper below `coerce_library_tags`**

```python
def coerce_steps(v: object) -> list["RecipeStep"]:
    if v is None:
        return []
    if not isinstance(v, list):
        raise ValueError("steps must be a list")
    out: list[RecipeStep] = []
    for item in v:
        if isinstance(item, RecipeStep):
            step = item
        elif isinstance(item, dict):
            step = RecipeStep(**item)
        elif isinstance(item, str):
            step = RecipeStep(text=item)
        else:
            continue
        if step.text:
            out.append(step)
    return out
```

- [ ] **Step 3: Add `coerce_string_list` helper for tips + equipment**

```python
def coerce_string_list(v: object) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        s = v.strip()
        return [s] if s else []
    if not isinstance(v, list):
        raise ValueError("expected a list of strings")
    seen: set[str] = set()
    out: list[str] = []
    for item in v:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out
```

- [ ] **Step 4: Add `coerce_total_time_minutes` helper**

```python
def coerce_total_time_minutes(v: object) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None
```

- [ ] **Step 5: Verify helpers behave with a one-liner**

Run from `backend/` with the venv active:

```bash
python -c "
from app.models import coerce_steps, coerce_string_list, coerce_total_time_minutes
assert coerce_steps(None) == []
assert coerce_steps([{'text': '  mince garlic  ', 'duration_seconds': '5'}])[0].text == 'mince garlic'
assert coerce_steps([{'text': ''}]) == []  # empty steps dropped
assert coerce_string_list(['a', '  b  ', 'a']) == ['a', 'b']  # trim+dedupe
assert coerce_total_time_minutes('30') == 30
assert coerce_total_time_minutes(-5) is None
print('ok')
"
```

Expected output: `ok`

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py
git commit -m "feat(backend): add RecipeStep model and tutorial-field coercers"
```

---

### Task 2: Extend `RecipeCreate` with the new fields

**Files:**
- Modify: `backend/app/models.py` (the `RecipeCreate` class)

- [ ] **Step 1: Add the five new fields to `RecipeCreate`**

In `backend/app/models.py`, inside the existing `RecipeCreate` class (after `is_public_catalog` / `catalog_source_recipe_id`, keeping it tidy), add:

```python
    description: Optional[str] = None
    total_time_minutes: Optional[int] = None
    steps: list[RecipeStep] = Field(default_factory=list)
    tips: list[str] = Field(default_factory=list)
    equipment: list[str] = Field(default_factory=list)

    @field_validator("description", mode="before")
    @classmethod
    def _normalize_description(cls, v: object) -> Optional[str]:
        if v is None:
            return None
        if not isinstance(v, str):
            return None
        s = v.strip()
        return s or None

    @field_validator("total_time_minutes", mode="before")
    @classmethod
    def _normalize_total_time(cls, v: object) -> Optional[int]:
        return coerce_total_time_minutes(v)

    @field_validator("steps", mode="before")
    @classmethod
    def _normalize_steps(cls, v: object) -> list["RecipeStep"]:
        return coerce_steps(v)

    @field_validator("tips", mode="before")
    @classmethod
    def _normalize_tips(cls, v: object) -> list[str]:
        return coerce_string_list(v)

    @field_validator("equipment", mode="before")
    @classmethod
    def _normalize_equipment(cls, v: object) -> list[str]:
        return coerce_string_list(v)
```

Note: `Recipe(RecipeCreate)` inherits these automatically — no edit there.

- [ ] **Step 2: Verify `Recipe` round-trips**

```bash
cd backend && python -c "
from app.models import Recipe
r = Recipe(
    id='r1',
    title='Mapo Tofu',
    ingredients=[{'name': 'tofu', 'quantity': '1 block'}],
    description='  spicy classic  ',
    total_time_minutes='25',
    steps=[{'text': 'dice tofu', 'duration_seconds': 60}, {'text': ''}],
    tips=['drain tofu well', 'drain tofu well'],
    equipment=['wok'],
)
assert r.description == 'spicy classic'
assert r.total_time_minutes == 25
assert len(r.steps) == 1 and r.steps[0].text == 'dice tofu'
assert r.tips == ['drain tofu well']
print('ok')
"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py
git commit -m "feat(backend): extend RecipeCreate with tutorial fields"
```

---

### Task 3: Add reusable Annotated types to `app/api/_types.py`

**Files:**
- Modify: `backend/app/api/_types.py`

- [ ] **Step 1: Read current contents**

```bash
cat backend/app/api/_types.py
```

(Currently exports `LibraryTags`.)

- [ ] **Step 2: Add `StepList` and `StringList`**

Append to `backend/app/api/_types.py`:

```python
from app.models import RecipeStep, coerce_steps, coerce_string_list

StepList = Annotated[list[RecipeStep], BeforeValidator(coerce_steps)]
StringList = Annotated[list[str], BeforeValidator(coerce_string_list)]
```

(If `Annotated` and `BeforeValidator` are already imported for `LibraryTags`, reuse them. Otherwise add `from typing import Annotated` and `from pydantic import BeforeValidator`.)

- [ ] **Step 3: Verify the module imports**

```bash
cd backend && python -c "from app.api._types import StepList, StringList, LibraryTags; print('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/_types.py
git commit -m "feat(backend): expose StepList and StringList Annotated types"
```

---

### Task 4: Create the Alembic migration

**Files:**
- Create: `backend/alembic/versions/20260514_recipe_tutorial.py`

- [ ] **Step 1: Write the migration file**

```python
"""Add recipe tutorial fields (description, total_time_minutes, steps, tips, equipment).

Revision ID: 20260514_recipe_tut
Revises: 20260510_user_lib
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260514_recipe_tut"
down_revision: Union[str, None] = "20260510_user_lib"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "recipes",
        sa.Column("steps", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "recipes",
        sa.Column("tips", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "recipes",
        sa.Column("equipment", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "recipes",
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.add_column(
        "recipes",
        sa.Column("total_time_minutes", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("recipes", "total_time_minutes")
    op.drop_column("recipes", "description")
    op.drop_column("recipes", "equipment")
    op.drop_column("recipes", "tips")
    op.drop_column("recipes", "steps")
```

- [ ] **Step 2: Apply the migration locally**

Make sure docker compose is up (`docker compose ps` shows `postgres` healthy and `backend` running). The backend container auto-applies migrations on startup, but if you've added the file after the container started, restart it:

```bash
docker compose restart backend
docker compose logs --tail=40 backend | grep -i alembic
```

Expected: a line like `INFO  [alembic.runtime.migration] Running upgrade 20260510_user_lib -> 20260514_recipe_tut, ...`.

- [ ] **Step 3: Verify the columns exist**

```bash
docker compose exec postgres psql -U cooking -d cooking -c "\d recipes" | grep -E "steps|tips|equipment|description|total_time_minutes"
```

Expected: all five columns appear with the correct types (`text` / `integer`) and the JSON-array columns show `default '[]'::text`.

- [ ] **Step 4: Verify legacy rows survived**

```bash
docker compose exec postgres psql -U cooking -d cooking -c "SELECT id, steps, tips, equipment, total_time_minutes FROM recipes LIMIT 3"
```

Expected: existing rows show `steps='[]'`, `tips='[]'`, `equipment='[]'`, `total_time_minutes=NULL`.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/20260514_recipe_tutorial.py
git commit -m "feat(db): migration for recipe tutorial fields"
```

---

### Task 5: Add the new columns to the SQLAlchemy `RecipeModel`

**Files:**
- Modify: `backend/app/db/models.py`

- [ ] **Step 1: Add the five mapped columns**

In `backend/app/db/models.py`, inside `class RecipeModel(Base):`, after the existing `catalog_source_recipe_id` line, append:

```python
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_time_minutes: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    steps: Mapped[str] = mapped_column(Text, nullable=False, server_default="[]")           # JSON array
    tips: Mapped[str] = mapped_column(Text, nullable=False, server_default="[]")            # JSON array
    equipment: Mapped[str] = mapped_column(Text, nullable=False, server_default="[]")       # JSON array
```

(`Text` is already imported. `sa.Integer()` matches how `Boolean` is referenced elsewhere in this file.)

- [ ] **Step 2: Restart backend & verify it boots**

```bash
docker compose restart backend
docker compose logs --tail=30 backend
```

Expected: no `OperationalError` / no `ColumnExpressionMismatch`. The backend should reach `Uvicorn running on http://0.0.0.0:8000`.

- [ ] **Step 3: Sanity-check via API**

```bash
curl -s http://localhost:8000/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/db/models.py
git commit -m "feat(db): map tutorial fields on RecipeModel"
```

---

## Phase 2 — Backend repos, routes, extraction

### Task 6: Update `repo_recipes._row_to_recipe` to deserialize new fields

**Files:**
- Modify: `backend/app/db/repo_recipes.py`

- [ ] **Step 1: Add deserialization to `_row_to_recipe`**

At the top of the file, extend the import:

```python
from app.models import (
    Recipe,
    IngredientItem,
    RecipeStep,
    coerce_library_tags,
    coerce_steps,
    coerce_string_list,
)
```

Inside `_row_to_recipe`, just before the `return Recipe(` call, add:

```python
    steps_raw = json.loads(row.steps or "[]") if getattr(row, "steps", None) else []
    tips_raw = json.loads(row.tips or "[]") if getattr(row, "tips", None) else []
    equipment_raw = json.loads(row.equipment or "[]") if getattr(row, "equipment", None) else []
```

Then add to the `Recipe(...)` constructor call (keep existing kwargs unchanged):

```python
        description=row.description,
        total_time_minutes=row.total_time_minutes,
        steps=coerce_steps(steps_raw),
        tips=coerce_string_list(tips_raw),
        equipment=coerce_string_list(equipment_raw),
```

- [ ] **Step 2: Update `save_recipe` to serialize new fields**

Inside `save_recipe`, after the existing `tags = coerce_library_tags(...)` line, add:

```python
    steps_list = coerce_steps(getattr(recipe, "steps", None))
    tips_list = coerce_string_list(getattr(recipe, "tips", None))
    equipment_list = coerce_string_list(getattr(recipe, "equipment", None))
```

Then extend the `RecipeModel(...)` kwargs:

```python
        description=getattr(recipe, "description", None),
        total_time_minutes=getattr(recipe, "total_time_minutes", None),
        steps=json.dumps([s.model_dump() for s in steps_list]),
        tips=json.dumps(tips_list),
        equipment=json.dumps(equipment_list),
```

- [ ] **Step 3: Verify round-trip via curl**

(Backend should still be running.) Register or log in to grab a cookie:

```bash
curl -s -c /tmp/c.txt -b /tmp/c.txt -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<your-test-email>","password":"<your-pw>"}' | jq .
```

Create a recipe with the new fields:

```bash
curl -s -c /tmp/c.txt -b /tmp/c.txt -X POST http://localhost:8000/recipes \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-tutorial-1",
    "title": "Test Tutorial",
    "ingredients": [{"name":"tofu","quantity":"1 block"}],
    "description": "Test description",
    "total_time_minutes": 25,
    "steps": [{"text":"step 1","duration_seconds":60}, {"text":"step 2"}],
    "tips": ["tip a"],
    "equipment": ["wok"]
  }' | jq .
```

Then read it back:

```bash
curl -s -b /tmp/c.txt http://localhost:8000/recipes/test-tutorial-1 | jq .
```

Expected: response includes the full `description`, `total_time_minutes`, `steps`, `tips`, `equipment`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/db/repo_recipes.py
git commit -m "feat(backend): persist and load tutorial fields on recipes"
```

---

### Task 7: Update `repo_recipes` catalog-copy path

**Files:**
- Modify: `backend/app/db/repo_recipes.py` (the `copy_public_recipe_to_user` function)

- [ ] **Step 1: Extend the clone construction**

In `copy_public_recipe_to_user`, the `clone = RecipeModel(...)` block copies the source's raw JSON-string columns. Extend it:

```python
    clone = RecipeModel(
        id=str(uuid.uuid4()),
        user_id=user_id,
        title=source.title,
        source_url=source.source_url,
        thumbnail_url=source.thumbnail_url,
        ingredients=source.ingredients,
        raw_extraction_text=source.raw_extraction_text,
        library_tags=source.library_tags,
        library_category=source.library_category,
        is_public_catalog=False,
        catalog_source_recipe_id=source.id,
        description=source.description,
        total_time_minutes=source.total_time_minutes,
        steps=source.steps,
        tips=source.tips,
        equipment=source.equipment,
    )
```

Step `image_url` URLs stay as-is per spec §4.4 (same policy as `thumbnail_url`).

- [ ] **Step 2: Verify by hand**

Mark a recipe public (must be a recipe you own and be the editor email), then copy as another user. The cloned recipe should carry over all tutorial fields. If you don't have a second account handy, skip the live test and rely on the smoke script in Task 11 to confirm.

- [ ] **Step 3: Commit**

```bash
git add backend/app/db/repo_recipes.py
git commit -m "feat(backend): copy tutorial fields when copying from public catalog"
```

---

### Task 8: Update `repo_users.copy_friend_recipe` clone path

**Files:**
- Modify: `backend/app/db/repo_users.py`

- [ ] **Step 1: Locate the clone construction**

```bash
grep -n "RecipeModel(" backend/app/db/repo_users.py
```

- [ ] **Step 2: Extend it the same way as Task 7**

Add `description`, `total_time_minutes`, `steps`, `tips`, `equipment` to the `RecipeModel(...)` kwargs in `copy_friend_recipe`, copying source values verbatim.

- [ ] **Step 3: Verify the module still imports**

```bash
cd backend && python -c "from app.db import repo_users; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/db/repo_users.py
git commit -m "feat(backend): copy tutorial fields when copying a friend recipe"
```

---

### Task 9: Extend `RecipeUpdate` in `routes_recipes.py`

**Files:**
- Modify: `backend/app/api/routes_recipes.py`

- [ ] **Step 1: Add the new optional fields to `RecipeUpdate`**

Replace the existing `RecipeUpdate` class:

```python
class RecipeUpdate(BaseModel):
    title: Optional[str] = None
    thumbnail_url: Optional[str] = None
    ingredients: Optional[list[IngredientItem]] = None
    library_tags: Optional[LibraryTags] = None
    description: Optional[str] = None
    total_time_minutes: Optional[int] = None
    steps: Optional[StepList] = None
    tips: Optional[StringList] = None
    equipment: Optional[StringList] = None
```

And update the imports at the top of the file:

```python
from app.api._types import LibraryTags, StepList, StringList
```

- [ ] **Step 2: Restart backend & verify it boots**

```bash
docker compose restart backend && docker compose logs --tail=20 backend
```

Expected: no Pydantic schema errors. `/health` still returns ok.

- [ ] **Step 3: Smoke PATCH**

```bash
curl -s -b /tmp/c.txt -X PATCH http://localhost:8000/recipes/test-tutorial-1 \
  -H "Content-Type: application/json" \
  -d '{"tips":["new tip","new tip","  duplicate  "],"description":"  edited  "}' | jq .
```

Expected: response shows `tips: ["new tip","duplicate"]` and `description: "edited"`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/routes_recipes.py
git commit -m "feat(api): allow PATCH /recipes/{id} to edit tutorial fields"
```

---

### Task 10: Update extraction prompt + parser + stub in `extract.py`

**Files:**
- Modify: `backend/app/extract.py`

- [ ] **Step 1: Rewrite `_build_extraction_prompt`**

Replace the existing function body:

```python
def _build_extraction_prompt(transcript: str) -> str:
    body = transcript.strip() or "(No transcript provided.)"
    return f"""You are extracting a cooking recipe from video content. Below is the speech transcript.

Extract the following JSON:
- title: short dish name. Preserve the source language (CJK stays CJK; English parens optional, e.g. "麻婆豆腐 (Mapo Tofu)").
- description: one short paragraph (<= 2 sentences) describing the dish. null if the transcript doesn't say.
- total_time_minutes: integer total minutes, or null if unclear.
- ingredients: list of {{name, quantity, notes}}.
- equipment: list of distinct tools/pans named in the transcript. [] if none mentioned.
- steps: ordered list of {{text, duration_seconds}}. duration_seconds is integer or null. Each step is one short instruction. If the transcript is thin or doesn't describe procedure, return []. DO NOT invent steps.
- tips: list of chef tips/tricks explicitly mentioned (e.g., "press tofu first"). [] if none.

Language rules:
- If the source names ingredients/steps/tips in Chinese, keep them in Chinese. English in parens is optional.
- Quantities and durations may stay in the source language.

Do not invent details that are not suggested by the text.

--- TRANSCRIPT ---
{body}
--- END ---

Respond with a JSON object only, no markdown:
{{ "title": "...", "description": null, "total_time_minutes": null,
   "ingredients": [{{ "name": "...", "quantity": "...", "notes": null }}],
   "equipment": [],
   "steps": [{{ "text": "...", "duration_seconds": null }}],
   "tips": []
}}"""
```

- [ ] **Step 2: Extend `parse_llm_recipe_response` to return all fields**

Replace the function so it returns a dict instead of a tuple. Callers update in step 3.

```python
def parse_llm_recipe_response(raw: str) -> dict:
    """Parse LLM JSON response into a recipe-shaped dict.

    Returns: {title, description, total_time_minutes, ingredients, equipment, steps, tips}.
    All fields default to safe empty values; the caller passes this dict to Recipe(...).
    """
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {
            "title": "Imported Recipe",
            "description": None,
            "total_time_minutes": None,
            "ingredients": [],
            "equipment": [],
            "steps": [],
            "tips": [],
        }

    title = data.get("title") or "Untitled Recipe"

    ingredients_raw = data.get("ingredients") or []
    ingredients: list[dict] = []
    for i in ingredients_raw:
        if isinstance(i, dict):
            quantity, metric_quantity = _split_dual_quantity(i.get("quantity") or "")
            ingredients.append({
                "name": i.get("name") or "",
                "quantity": quantity,
                "metric_quantity": metric_quantity,
                "notes": i.get("notes"),
            })
        else:
            ingredients.append({"name": str(i), "quantity": "", "notes": None})

    steps_raw = data.get("steps") or []
    steps: list[dict] = []
    for s in steps_raw:
        if isinstance(s, dict):
            steps.append({
                "text": s.get("text") or "",
                "duration_seconds": s.get("duration_seconds"),
            })
        elif isinstance(s, str):
            steps.append({"text": s, "duration_seconds": None})

    return {
        "title": title,
        "description": data.get("description"),
        "total_time_minutes": data.get("total_time_minutes"),
        "ingredients": ingredients,
        "equipment": data.get("equipment") or [],
        "steps": steps,
        "tips": data.get("tips") or [],
    }
```

- [ ] **Step 3: Update `extract_recipe_from_text` to use the new shape**

Replace the function body:

```python
async def extract_recipe_from_text(transcript: str) -> Recipe:
    client = get_openai_client()
    if client is None:
        data = _stub_extraction(transcript or "(no input)")
    else:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": _build_extraction_prompt(transcript)}],
        )
        raw = response.choices[0].message.content or "{}"
        data = parse_llm_recipe_response(raw)

    return Recipe(
        id=str(uuid.uuid4()),
        title=data["title"],
        source_url=None,
        thumbnail_url=None,
        ingredients=[IngredientItem(**x) for x in data["ingredients"]],
        raw_extraction_text=transcript or None,
        description=data.get("description"),
        total_time_minutes=data.get("total_time_minutes"),
        steps=data.get("steps") or [],
        tips=data.get("tips") or [],
        equipment=data.get("equipment") or [],
    )
```

- [ ] **Step 4: Rewrite `_stub_extraction` to return the full dict**

```python
def _stub_extraction(input_text: str) -> dict:
    """When OPENAI_API_KEY is not set, return a demo recipe so the flow is testable."""
    text = (input_text or "").lower()
    if "tofu" in text or "mapo" in text:
        return {
            "title": "Mapo Tofu",
            "description": "A spicy Sichuan classic of soft tofu in a fiery doubanjiang sauce.",
            "total_time_minutes": 25,
            "ingredients": [
                {"name": "Soft tofu", "quantity": "1 block", "notes": "diced"},
                {"name": "Ground pork", "quantity": "100g", "notes": None},
                {"name": "Doubanjiang", "quantity": "1 tbsp", "notes": None},
                {"name": "Garlic", "quantity": "2 cloves", "notes": "minced"},
                {"name": "Green onion", "quantity": "2", "notes": "chopped"},
            ],
            "equipment": ["wok", "spatula"],
            "steps": [
                {"text": "Dice the tofu into 2 cm cubes and let it sit in lightly salted hot water.", "duration_seconds": 180},
                {"text": "Sear ground pork in the wok until browned and crispy at the edges.", "duration_seconds": 240},
                {"text": "Add doubanjiang and garlic; stir-fry until fragrant.", "duration_seconds": 60},
                {"text": "Drain the tofu, slide it into the wok, and simmer gently with stock.", "duration_seconds": 180},
                {"text": "Thicken with a cornstarch slurry, finish with green onion and Sichuan pepper.", "duration_seconds": 60},
            ],
            "tips": ["Drain the tofu well before adding it — it absorbs sauce better."],
        }
    return {
        "title": "Imported Recipe",
        "description": None,
        "total_time_minutes": None,
        "ingredients": [
            {"name": "Example ingredient", "quantity": "to taste", "notes": "Replace with real extraction"},
        ],
        "equipment": [],
        "steps": [],
        "tips": [],
    }
```

- [ ] **Step 5: Verify the import flow still works**

Backend should still be running. Trigger transcript parse:

```bash
curl -s -b /tmp/c.txt -X POST http://localhost:8000/recipes/parse/transcript \
  -H "Content-Type: application/json" \
  -d '{"transcript":"This is a mapo tofu video"}' | jq .
```

Expected (with `OPENAI_API_KEY` unset locally — falls back to stub): a Mapo Tofu recipe with five steps, one tip, description, total_time_minutes=25.

- [ ] **Step 6: Commit**

```bash
git add backend/app/extract.py
git commit -m "feat(extract): produce tutorial-rich recipes from transcripts"
```

---

### Task 11: Write `smoke_tutorial_schema.sh`

**Files:**
- Create: `backend/scripts/smoke_tutorial_schema.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# End-to-end smoke for the recipe tutorial schema.
# Usage: bash backend/scripts/smoke_tutorial_schema.sh <email> <password>
# Requires: jq, curl, local backend on :8000.
set -euo pipefail

EMAIL="${1:?email required}"
PASSWORD="${2:?password required}"
BASE="${BASE:-http://localhost:8000}"
CK=$(mktemp)
trap 'rm -f "$CK"' EXIT

echo "→ login as $EMAIL"
curl -s -c "$CK" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -e .access_token > /dev/null

RECIPE_ID="smoke-tutorial-$(date +%s)"

echo "→ POST /recipes with full tutorial body"
curl -s -b "$CK" -X POST "$BASE/recipes" \
  -H "Content-Type: application/json" \
  -d @- <<JSON | jq -e '.steps | length == 2' > /dev/null
{
  "id": "$RECIPE_ID",
  "title": "Smoke Tutorial",
  "ingredients": [{"name":"tofu","quantity":"1 block"}],
  "description": "smoke description",
  "total_time_minutes": 30,
  "steps": [
    {"text":"first step","duration_seconds":60},
    {"text":"second step"}
  ],
  "tips": ["a tip","a tip"],
  "equipment": ["wok"]
}
JSON

echo "→ GET /recipes/$RECIPE_ID and validate round-trip"
curl -s -b "$CK" "$BASE/recipes/$RECIPE_ID" \
  | jq -e '
      .description == "smoke description"
      and .total_time_minutes == 30
      and (.steps | length) == 2
      and (.steps[0].duration_seconds // 0) == 60
      and (.tips | length) == 1
      and .equipment == ["wok"]
    ' > /dev/null

echo "→ PATCH /recipes/$RECIPE_ID to add a step and a tip"
curl -s -b "$CK" -X PATCH "$BASE/recipes/$RECIPE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "steps":[
      {"text":"first step","duration_seconds":60},
      {"text":"second step"},
      {"text":"third step","duration_seconds":30}
    ],
    "tips":["a tip","another tip"]
  }' | jq -e '(.steps | length) == 3 and (.tips | length) == 2' > /dev/null

echo "→ GET again, confirm PATCH applied"
curl -s -b "$CK" "$BASE/recipes/$RECIPE_ID" \
  | jq -e '(.steps | length) == 3 and (.tips | length) == 2' > /dev/null

echo "→ DELETE /recipes/$RECIPE_ID"
curl -s -b "$CK" -o /dev/null -w "%{http_code}\n" -X DELETE "$BASE/recipes/$RECIPE_ID" \
  | grep -q "^204$"

echo "✓ tutorial schema smoke passed"
```

- [ ] **Step 2: Make it executable & run it**

```bash
chmod +x backend/scripts/smoke_tutorial_schema.sh
bash backend/scripts/smoke_tutorial_schema.sh <your-test-email> <your-test-password>
```

Expected last line: `✓ tutorial schema smoke passed`.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/smoke_tutorial_schema.sh
git commit -m "feat(scripts): end-to-end smoke for tutorial schema"
```

---

## Phase 3 — Shared package (`packages/shared`)

### Task 12: Add `RecipeStep` type and extend `Recipe` in `@cooking/shared`

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Read current Recipe / RecipeStep usage**

```bash
grep -n "Recipe\|RecipeStep" packages/shared/src/types.ts
```

- [ ] **Step 2: Add `RecipeStep` and extend `Recipe`**

In `packages/shared/src/types.ts`, add the `RecipeStep` type and extend the `Recipe` interface (keep existing fields). Order so `RecipeStep` is defined before `Recipe`:

```ts
export interface RecipeStep {
  text: string;
  duration_seconds?: number | null;
  image_url?: string | null;
}

// ...existing Recipe fields...
// Add these to the Recipe interface:
//   description?: string | null;
//   total_time_minutes?: number | null;
//   steps?: RecipeStep[];
//   tips?: string[];
//   equipment?: string[];
```

If the file uses `type Recipe = { ... }` rather than `interface`, add the same fields there.

- [ ] **Step 3: Verify the workspace still type-checks**

```bash
npm --workspace @cooking/web run build
```

This is the fast gate. If it fails because callers don't know about new fields, that's expected only if existing code reads `.steps` etc. without `?` — should not happen since all callers today predate these fields. If a real error surfaces, address before continuing.

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add RecipeStep and tutorial fields to Recipe type"
```

---

### Task 13: Add `formatStepDuration` helper in shared package

**Files:**
- Create: `packages/shared/src/formatStepDuration.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the helper**

`packages/shared/src/formatStepDuration.ts`:

```ts
/** Format an integer second count as "mm:ss". Returns "" for null/undefined/<=0. */
export function formatStepDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 2: Re-export from the package index**

In `packages/shared/src/index.ts`, add:

```ts
export { formatStepDuration } from "./formatStepDuration";
```

- [ ] **Step 3: Verify**

```bash
npm --workspace @cooking/web run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/formatStepDuration.ts packages/shared/src/index.ts
git commit -m "feat(shared): formatStepDuration helper for mm:ss rendering"
```

---

### Task 14: Add i18n message keys (en + zh)

**Files:**
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

- [ ] **Step 1: Add new keys to `en.json`**

Add (placed wherever the existing `recipe.*` keys live; merge into the same nested key if the file uses nested objects):

```json
"recipe.description": "Description",
"recipe.description.placeholder": "Optional short description",
"recipe.totalTime": "Total time",
"recipe.totalTime.minutesSuffix": "min",
"recipe.totalTime.placeholder": "e.g. 30",
"recipe.steps": "Steps",
"recipe.steps.empty": "No steps yet.",
"recipe.step.addRow": "Add step",
"recipe.step.remove": "Remove",
"recipe.step.moveUp": "Move up",
"recipe.step.moveDown": "Move down",
"recipe.step.duration": "Duration",
"recipe.step.durationMmSs": "mm : ss",
"recipe.step.textPlaceholder": "Describe this step",
"recipe.step.uploadImage": "Add image",
"recipe.step.removeImage": "Remove image",
"recipe.tips": "Tips",
"recipe.tips.addRow": "Add tip",
"recipe.tips.placeholder": "Add a chef's note",
"recipe.equipment": "Equipment",
"recipe.equipment.addRow": "Add equipment",
"recipe.equipment.placeholder": "Add a pan or tool"
```

(If the JSON file uses nested objects rather than dotted keys, nest accordingly. Match existing style.)

- [ ] **Step 2: Add equivalent keys to `zh.json`**

```json
"recipe.description": "简介",
"recipe.description.placeholder": "可选的简短介绍",
"recipe.totalTime": "总用时",
"recipe.totalTime.minutesSuffix": "分钟",
"recipe.totalTime.placeholder": "例如 30",
"recipe.steps": "步骤",
"recipe.steps.empty": "还没有步骤。",
"recipe.step.addRow": "添加步骤",
"recipe.step.remove": "删除",
"recipe.step.moveUp": "上移",
"recipe.step.moveDown": "下移",
"recipe.step.duration": "时长",
"recipe.step.durationMmSs": "分 : 秒",
"recipe.step.textPlaceholder": "描述这一步",
"recipe.step.uploadImage": "添加图片",
"recipe.step.removeImage": "删除图片",
"recipe.tips": "小贴士",
"recipe.tips.addRow": "添加贴士",
"recipe.tips.placeholder": "添加一条厨房小贴士",
"recipe.equipment": "工具",
"recipe.equipment.addRow": "添加工具",
"recipe.equipment.placeholder": "添加一个锅具或工具"
```

- [ ] **Step 3: Verify both files parse**

```bash
node -e "console.log(Object.keys(require('./packages/shared/src/messages/en.json')).length, Object.keys(require('./packages/shared/src/messages/zh.json')).length)"
```

Expected: two numbers, equal (or close — same key count in both).

```bash
npm --workspace @cooking/web run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(i18n): copy for recipe tutorial fields (en + zh)"
```

---

## Phase 4 — Web client (`apps/web`)

### Task 15: Extract the editable preview from `import/page.tsx` into `DraftRecipeEditor.tsx`

**Files:**
- Modify: `apps/web/app/import/page.tsx`
- Create: `apps/web/app/import/DraftRecipeEditor.tsx`

- [ ] **Step 1: Identify the editable preview block**

```bash
grep -n "Title\|ingredients\|library_tags\|thumbnail" apps/web/app/import/page.tsx | head -30
```

Find the JSX block that renders the draft recipe (title input, ingredient rows, tag chips, thumbnail uploader). This is the block to extract.

- [ ] **Step 2: Create `DraftRecipeEditor.tsx`**

```tsx
"use client";

import type { Recipe } from "@cooking/shared";

export interface DraftRecipeEditorProps {
  draft: Recipe;
  onChange: (next: Recipe) => void;
  apiBase: string;
}

export function DraftRecipeEditor({ draft, onChange, apiBase }: DraftRecipeEditorProps) {
  // Move the existing JSX block here. Replace local state hooks on the parent
  // with controlled handlers that call onChange(next). Image upload retains its
  // current hook (move it into this component or pass it in as a prop).
  return (
    <div className="draft-recipe-editor">
      {/* existing title / ingredients / tags / thumbnail JSX, controlled */}
    </div>
  );
}
```

In `apps/web/app/import/page.tsx`, replace the inlined JSX with:

```tsx
<DraftRecipeEditor
  draft={draft}
  onChange={setDraft}
  apiBase={apiBase}
/>
```

(`draft` and `setDraft` are the existing state in the page.)

- [ ] **Step 3: Verify the import flow still works**

Open `http://localhost:3000/import`, log in, paste a transcript, click parse. Confirm the editor renders title + ingredients + tags + thumbnail unchanged, save works.

- [ ] **Step 4: Run web build to catch type errors**

```bash
npm --workspace @cooking/web run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/import/page.tsx apps/web/app/import/DraftRecipeEditor.tsx
git commit -m "refactor(web): extract DraftRecipeEditor from import page"
```

---

### Task 16: Add Description + TotalTime fields to `DraftRecipeEditor`

**Files:**
- Modify: `apps/web/app/import/DraftRecipeEditor.tsx`

- [ ] **Step 1: Wire `description` textarea**

Inside the editor, above the ingredients section, add:

```tsx
import { useT } from "@/app/lib/i18n";

// ...

const t = useT();

// inside JSX, above ingredients:
<section>
  <label className="field-label">{t("recipe.description")}</label>
  <textarea
    rows={3}
    maxLength={500}
    placeholder={t("recipe.description.placeholder")}
    value={draft.description ?? ""}
    onChange={(e) =>
      onChange({ ...draft, description: e.target.value })
    }
  />
  <div className="char-counter">
    {(draft.description ?? "").length} / 500
  </div>
</section>
```

- [ ] **Step 2: Wire `total_time_minutes` number input**

```tsx
<section>
  <label className="field-label">{t("recipe.totalTime")}</label>
  <div className="inline-input-row">
    <input
      type="number"
      min={0}
      placeholder={t("recipe.totalTime.placeholder")}
      value={draft.total_time_minutes ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        const n = raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0));
        onChange({ ...draft, total_time_minutes: n });
      }}
    />
    <span className="suffix">{t("recipe.totalTime.minutesSuffix")}</span>
  </div>
</section>
```

- [ ] **Step 3: Add minimal CSS classes**

In `apps/web/app/globals.css`, add:

```css
.field-label { display:block; font-weight:600; margin:.75rem 0 .25rem; font-size:.92rem; }
.char-counter { font-size:.78rem; opacity:.65; text-align:right; margin-top:.15rem; }
.inline-input-row { display:flex; align-items:center; gap:.5rem; }
.inline-input-row .suffix { font-size:.85rem; opacity:.75; }
```

- [ ] **Step 4: Verify in browser**

Reload `/import`, parse a transcript, confirm the description textarea and total-time input render and update state.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/import/DraftRecipeEditor.tsx apps/web/app/globals.css
git commit -m "feat(web): description + total time inputs in draft editor"
```

---

### Task 17: Create `StepListEditor` + `DurationField` for web

**Files:**
- Create: `apps/web/app/import/StepListEditor.tsx`
- Create: `apps/web/app/import/DurationField.tsx`

- [ ] **Step 1: Write `DurationField.tsx`**

```tsx
"use client";

interface Props {
  seconds: number | null | undefined;
  onChange: (next: number | null) => void;
  ariaLabel: string;
}

export function DurationField({ seconds, onChange, ariaLabel }: Props) {
  const total = seconds ?? 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  const update = (nextM: number, nextS: number) => {
    const total = Math.max(0, Math.floor(nextM)) * 60 + Math.max(0, Math.min(59, Math.floor(nextS)));
    onChange(total > 0 ? total : null);
  };
  return (
    <div className="duration-field" role="group" aria-label={ariaLabel}>
      <input
        type="number"
        min={0}
        value={m}
        onChange={(e) => update(Number(e.target.value) || 0, s)}
        aria-label="minutes"
      />
      <span>:</span>
      <input
        type="number"
        min={0}
        max={59}
        value={s.toString().padStart(2, "0")}
        onChange={(e) => update(m, Number(e.target.value) || 0)}
        aria-label="seconds"
      />
    </div>
  );
}
```

- [ ] **Step 2: Write `StepListEditor.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { RecipeStep } from "@cooking/shared";
import { useT } from "@/app/lib/i18n";
import { DurationField } from "./DurationField";

export interface StepListEditorProps {
  steps: RecipeStep[];
  onChange: (next: RecipeStep[]) => void;
  uploadImage: (file: File) => Promise<string>;  // returns file_url
}

export function StepListEditor({ steps, onChange, uploadImage }: StepListEditorProps) {
  const t = useT();
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  const updateAt = (i: number, next: RecipeStep) => {
    const arr = steps.slice();
    arr[i] = next;
    onChange(arr);
  };
  const removeAt = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= steps.length) return;
    const arr = steps.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };
  const append = () => onChange([...steps, { text: "" }]);

  const onPickImage = async (i: number, file: File) => {
    setUploadingIndex(i);
    try {
      const url = await uploadImage(file);
      updateAt(i, { ...steps[i], image_url: url });
    } finally {
      setUploadingIndex(null);
    }
  };

  return (
    <section className="step-list-editor">
      <label className="field-label">{t("recipe.steps")}</label>
      {steps.length === 0 && <p className="hint">{t("recipe.steps.empty")}</p>}
      <ol>
        {steps.map((step, i) => (
          <li key={i} className="step-row">
            <div className="step-row__index">{i + 1}</div>
            <div className="step-row__body">
              <textarea
                rows={2}
                placeholder={t("recipe.step.textPlaceholder")}
                value={step.text}
                onChange={(e) => updateAt(i, { ...step, text: e.target.value })}
              />
              <div className="step-row__meta">
                <label>{t("recipe.step.duration")}</label>
                <DurationField
                  seconds={step.duration_seconds ?? null}
                  onChange={(next) => updateAt(i, { ...step, duration_seconds: next })}
                  ariaLabel={`step ${i + 1} duration`}
                />
              </div>
              {step.image_url ? (
                <div className="step-row__image">
                  <img src={step.image_url} alt="" />
                  <button type="button" onClick={() => updateAt(i, { ...step, image_url: null })}>
                    {t("recipe.step.removeImage")}
                  </button>
                </div>
              ) : (
                <label className="step-row__upload">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && onPickImage(i, e.target.files[0])}
                  />
                  {uploadingIndex === i ? "Uploading…" : t("recipe.step.uploadImage")}
                </label>
              )}
            </div>
            <div className="step-row__actions">
              <button type="button" onClick={() => swap(i, i - 1)} aria-label={t("recipe.step.moveUp")}>↑</button>
              <button type="button" onClick={() => swap(i, i + 1)} aria-label={t("recipe.step.moveDown")}>↓</button>
              <button type="button" onClick={() => removeAt(i)} aria-label={t("recipe.step.remove")}>×</button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="add-row-btn" onClick={append}>
        + {t("recipe.step.addRow")}
      </button>
    </section>
  );
}
```

- [ ] **Step 3: Add styles**

In `apps/web/app/globals.css`, append:

```css
.duration-field { display:inline-flex; align-items:center; gap:.25rem; }
.duration-field input { width:3.5rem; text-align:center; }
.step-list-editor ol { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:.75rem; }
.step-row { display:grid; grid-template-columns:2rem 1fr auto; gap:.6rem; align-items:start; }
.step-row__index { font-weight:600; padding-top:.4rem; }
.step-row__body textarea { width:100%; }
.step-row__meta { display:flex; align-items:center; gap:.5rem; margin-top:.3rem; font-size:.85rem; }
.step-row__image img { max-width:200px; max-height:120px; border-radius:8px; margin-top:.4rem; display:block; }
.step-row__upload input { display:none; }
.step-row__upload { display:inline-block; padding:.3rem .5rem; border:1px dashed currentColor; border-radius:6px; cursor:pointer; font-size:.85rem; margin-top:.3rem; }
.step-row__actions { display:flex; flex-direction:column; gap:.2rem; }
.add-row-btn { margin-top:.6rem; }
.hint { opacity:.6; font-size:.9rem; margin:.3rem 0; }
```

- [ ] **Step 4: Verify the file compiles**

```bash
npm --workspace @cooking/web run build
```

Expected: build succeeds (the new files are not yet imported anywhere — that's fine).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/import/StepListEditor.tsx apps/web/app/import/DurationField.tsx apps/web/app/globals.css
git commit -m "feat(web): step list editor + duration field components"
```

---

### Task 18: Create `StringListEditor` for tips + equipment

**Files:**
- Create: `apps/web/app/import/StringListEditor.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

interface Props {
  label: string;
  addLabel: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}

export function StringListEditor({ label, addLabel, placeholder, values, onChange }: Props) {
  const updateAt = (i: number, v: string) => {
    const arr = values.slice();
    arr[i] = v;
    onChange(arr);
  };
  const removeAt = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const append = () => onChange([...values, ""]);

  return (
    <section className="string-list-editor">
      <label className="field-label">{label}</label>
      <ul>
        {values.map((v, i) => (
          <li key={i} className="string-row">
            <input
              type="text"
              placeholder={placeholder}
              value={v}
              onChange={(e) => updateAt(i, e.target.value)}
            />
            <button type="button" onClick={() => removeAt(i)} aria-label="remove">×</button>
          </li>
        ))}
      </ul>
      <button type="button" className="add-row-btn" onClick={append}>+ {addLabel}</button>
    </section>
  );
}
```

- [ ] **Step 2: Add styles**

Append to `apps/web/app/globals.css`:

```css
.string-list-editor ul { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:.4rem; }
.string-row { display:flex; gap:.4rem; }
.string-row input { flex:1; }
```

- [ ] **Step 3: Verify build**

```bash
npm --workspace @cooking/web run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/import/StringListEditor.tsx apps/web/app/globals.css
git commit -m "feat(web): string list editor for tips and equipment"
```

---

### Task 19: Wire all new sections into `DraftRecipeEditor`

**Files:**
- Modify: `apps/web/app/import/DraftRecipeEditor.tsx`

- [ ] **Step 1: Import the new components and add `uploadImage` plumbing**

At the top of `DraftRecipeEditor.tsx`:

```tsx
import { StepListEditor } from "./StepListEditor";
import { StringListEditor } from "./StringListEditor";
import { useT } from "@/app/lib/i18n";
```

The image upload helper should already exist in the editor or be a prop. If it's local-only to the page, lift the upload function and pass it as a prop:

```tsx
async function uploadRecipeImage(file: File, apiBase: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${apiBase}/recipes/upload-image`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (!r.ok) throw new Error("upload failed");
  const data = await r.json();
  if (data.upload_url) {
    // S3 presigned PUT path
    const put = await fetch(data.upload_url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
    if (!put.ok) throw new Error("S3 PUT failed");
  }
  return data.file_url as string;
}
```

(Reuse the same helper already used for `thumbnail_url` if it exists; do not duplicate.)

- [ ] **Step 2: Add sections to the JSX in the order specified by the spec**

Spec order: Title → Description → Total time → Ingredients → Steps → Tips → Equipment → Tags → Thumbnail.

```tsx
const t = useT();

// existing title + description + total time already added in Task 16
// existing ingredients block stays here
<StepListEditor
  steps={draft.steps ?? []}
  onChange={(steps) => onChange({ ...draft, steps })}
  uploadImage={(file) => uploadRecipeImage(file, apiBase)}
/>
<StringListEditor
  label={t("recipe.tips")}
  addLabel={t("recipe.tips.addRow")}
  placeholder={t("recipe.tips.placeholder")}
  values={draft.tips ?? []}
  onChange={(tips) => onChange({ ...draft, tips })}
/>
<StringListEditor
  label={t("recipe.equipment")}
  addLabel={t("recipe.equipment.addRow")}
  placeholder={t("recipe.equipment.placeholder")}
  values={draft.equipment ?? []}
  onChange={(equipment) => onChange({ ...draft, equipment })}
/>
// existing tags + thumbnail blocks stay below
```

- [ ] **Step 3: End-to-end smoke in browser**

1. Open `/import`, log in.
2. Paste a transcript (or use the YouTube URL field; with `OPENAI_API_KEY` unset locally the stub Mapo Tofu shows).
3. Confirm the parsed recipe shows description, total time, five steps, equipment, and one tip.
4. Edit each section (reorder a step, remove a tip, add equipment).
5. Save. Open the recipe via `/library/<id>` (or via library listing). Confirm fields persisted by fetching `curl -s -b /tmp/c.txt http://localhost:8000/recipes/<id> | jq .`.

- [ ] **Step 4: Run web build**

```bash
npm --workspace @cooking/web run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/import/DraftRecipeEditor.tsx
git commit -m "feat(web): wire steps, tips, equipment into import editor"
```

---

### Task 20: Add the same sections to the recipe edit page

**Files:**
- Modify: `apps/web/app/recipe/[id]/page.tsx`

- [ ] **Step 1: Locate the edit-mode block**

```bash
grep -n "isEditing\|setEditing\|RecipeUpdate\|PATCH" apps/web/app/recipe/[id]/page.tsx | head -20
```

(File name uses literal brackets — quote the path in shell.)

- [ ] **Step 2: Render the same sub-components when in edit mode**

Reuse `StepListEditor`, `StringListEditor`, and the description / total-time fields exactly as in `DraftRecipeEditor`. The simplest way is to lift the JSX from `DraftRecipeEditor` into a small shared `RecipeTutorialFields.tsx` component used by both edit surfaces, but since both files live in `apps/web/app/`, an internal import is fine without further structure change.

Save handler must send the new fields in the `PATCH /recipes/{id}` body. Confirm the existing save handler spreads the recipe object — if it does, the new fields ride along automatically.

- [ ] **Step 3: Verify in browser**

Open an existing recipe → click Edit → confirm new sections render (probably empty for legacy recipes) → add a step → save → re-open the recipe → confirm step persisted.

- [ ] **Step 4: Web build**

```bash
npm --workspace @cooking/web run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add 'apps/web/app/recipe/[id]/page.tsx'
git commit -m "feat(web): edit tutorial fields on recipe detail page"
```

---

### Task 21: Render tutorial fields read-only on the recipe view page

**Files:**
- Modify: `apps/web/app/recipe/[id]/page.tsx`

- [ ] **Step 1: Add the read-only renderers in non-edit mode**

In the same file, in the read-mode JSX:

```tsx
import { formatStepDuration } from "@cooking/shared";

// at the top of the recipe body:
{recipe.description && <p className="recipe-description">{recipe.description}</p>}
{typeof recipe.total_time_minutes === "number" && (
  <div className="recipe-total-time-chip">
    <span>⏱</span>
    <span>{recipe.total_time_minutes} {t("recipe.totalTime.minutesSuffix")}</span>
  </div>
)}

// existing ingredients block stays here

{(recipe.equipment ?? []).length > 0 && (
  <section className="recipe-equipment">
    <h3>{t("recipe.equipment")}</h3>
    <ul>{recipe.equipment!.map((e, i) => <li key={i}>{e}</li>)}</ul>
  </section>
)}

{(recipe.steps ?? []).length > 0 && (
  <section className="recipe-steps">
    <h3>{t("recipe.steps")}</h3>
    <ol>
      {recipe.steps!.map((s, i) => (
        <li key={i} className="recipe-step">
          <div className="recipe-step__header">
            <span className="recipe-step__index">{i + 1}</span>
            {s.duration_seconds && s.duration_seconds > 0 && (
              <span className="recipe-step__chip">⏱ {formatStepDuration(s.duration_seconds)}</span>
            )}
          </div>
          <p className="recipe-step__text">{s.text}</p>
          {s.image_url && <img src={s.image_url} alt="" className="recipe-step__image" />}
        </li>
      ))}
    </ol>
  </section>
)}

{(recipe.tips ?? []).length > 0 && (
  <section className="recipe-tips">
    <h3>{t("recipe.tips")}</h3>
    <ul>{recipe.tips!.map((tp, i) => <li key={i}>{tp}</li>)}</ul>
  </section>
)}
```

- [ ] **Step 2: Add styles**

Append to `apps/web/app/globals.css`:

```css
.recipe-description { font-style: italic; opacity:.85; margin: .5rem 0 1rem; }
.recipe-total-time-chip { display:inline-flex; gap:.3rem; align-items:center; background:#eef; padding:.2rem .55rem; border-radius:999px; font-size:.85rem; margin-bottom:.8rem; }
.recipe-step { display:flex; flex-direction:column; gap:.3rem; margin-bottom:1rem; }
.recipe-step__header { display:flex; align-items:center; gap:.5rem; font-weight:600; }
.recipe-step__index { background:#333; color:#fff; border-radius:999px; padding:.05rem .5rem; font-size:.8rem; }
.recipe-step__chip { background:#fef3c7; color:#92400e; border-radius:999px; padding:.05rem .5rem; font-size:.75rem; }
.recipe-step__text { margin: .2rem 0; }
.recipe-step__image { max-width: 100%; max-height: 320px; border-radius:10px; }
.recipe-equipment ul, .recipe-tips ul { padding-left:1.3rem; }
```

(Adjust colors to match the existing globals.css palette — keep these as starting values; tweak per the existing Material/Stitch hues.)

- [ ] **Step 3: Verify in browser**

Open the recipe you saved in Task 19. Confirm description, total-time chip, equipment, steps (with durations), and tips render. Open a legacy recipe — confirm none of those sections appear (no empty headers).

- [ ] **Step 4: Run web build**

```bash
npm --workspace @cooking/web run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add 'apps/web/app/recipe/[id]/page.tsx' apps/web/app/globals.css
git commit -m "feat(web): render tutorial fields on recipe view"
```

---

## Phase 5 — Mobile client (`apps/mobile`)

### Task 22: Add mobile primitives — `DurationField` + `TotalTimeField`

**Files:**
- Create: `apps/mobile/src/features/import/DurationField.tsx`
- Create: `apps/mobile/src/features/import/TotalTimeField.tsx`

- [ ] **Step 1: Write `DurationField.tsx`**

```tsx
import { View, TextInput, Text } from "react-native";
import { typography, spacing, colors } from "../../theme";

interface Props {
  seconds: number | null | undefined;
  onChange: (next: number | null) => void;
}

export function DurationField({ seconds, onChange }: Props) {
  const total = seconds ?? 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  const update = (nextM: number, nextS: number) => {
    const t = Math.max(0, Math.floor(nextM)) * 60 + Math.max(0, Math.min(59, Math.floor(nextS)));
    onChange(t > 0 ? t : null);
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
      <TextInput
        style={[typography.body, { width: 44, textAlign: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingVertical: 4 }]}
        keyboardType="number-pad"
        value={String(m)}
        onChangeText={(v) => update(Number(v) || 0, s)}
      />
      <Text style={typography.body}>:</Text>
      <TextInput
        style={[typography.body, { width: 44, textAlign: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingVertical: 4 }]}
        keyboardType="number-pad"
        value={s.toString().padStart(2, "0")}
        onChangeText={(v) => update(m, Number(v) || 0)}
      />
    </View>
  );
}
```

Field names match exactly what the existing theme module exports — verify with `grep -n "^export" apps/mobile/src/theme/index.ts` before locking color/typo names. Fix any name drift.

- [ ] **Step 2: Write `TotalTimeField.tsx`**

```tsx
import { View, TextInput, Text } from "react-native";
import { typography, spacing, colors } from "../../theme";

interface Props {
  minutes: number | null | undefined;
  onChange: (next: number | null) => void;
  suffix: string; // "min" from i18n later
}

export function TotalTimeField({ minutes, onChange, suffix }: Props) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <TextInput
        style={[typography.body, { width: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 8, textAlign: "center" }]}
        keyboardType="number-pad"
        value={minutes == null ? "" : String(minutes)}
        onChangeText={(v) => {
          if (v === "") return onChange(null);
          const n = Math.max(0, Math.floor(Number(v) || 0));
          onChange(n);
        }}
      />
      <Text style={typography.body}>{suffix}</Text>
    </View>
  );
}
```

- [ ] **Step 3: Verify mobile types**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/features/import/DurationField.tsx apps/mobile/src/features/import/TotalTimeField.tsx
git commit -m "feat(mobile): DurationField + TotalTimeField primitives"
```

---

### Task 23: `StepListEditor` for mobile

**Files:**
- Create: `apps/mobile/src/features/import/StepListEditor.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { View, Text, TextInput, Pressable, Image } from "react-native";
import { useState } from "react";
import type { RecipeStep } from "@cooking/shared";
import { typography, spacing, colors, radii } from "../../theme";
import { Button } from "@/src/components";
import { DurationField } from "./DurationField";
import { resolveImageUrl } from "@/src/lib/imageUrl";

interface Props {
  steps: RecipeStep[];
  onChange: (next: RecipeStep[]) => void;
  pickImage: () => Promise<string | null>;  // wraps expo-image-picker + useImageUpload
}

export function StepListEditor({ steps, onChange, pickImage }: Props) {
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  const updateAt = (i: number, next: RecipeStep) => {
    const arr = steps.slice();
    arr[i] = next;
    onChange(arr);
  };
  const removeAt = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= steps.length) return;
    const arr = steps.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };
  const append = () => onChange([...steps, { text: "" }]);

  const onPickImage = async (i: number) => {
    setUploadingIndex(i);
    try {
      const url = await pickImage();
      if (url) updateAt(i, { ...steps[i], image_url: url });
    } finally {
      setUploadingIndex(null);
    }
  };

  return (
    <View style={{ marginVertical: spacing.md }}>
      <Text style={typography.fieldLabel}>Steps</Text>
      {steps.length === 0 && (
        <Text style={[typography.caption, { opacity: 0.6, marginVertical: spacing.xs }]}>No steps yet.</Text>
      )}
      {steps.map((step, i) => (
        <View key={i} style={{ flexDirection: "row", gap: spacing.sm, marginVertical: spacing.xs, alignItems: "flex-start" }}>
          <Text style={[typography.body, { width: 24, fontWeight: "600", paddingTop: 8 }]}>{i + 1}</Text>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <TextInput
              multiline
              placeholder="Describe this step"
              style={[typography.body, { borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, padding: spacing.sm, minHeight: 60 }]}
              value={step.text}
              onChangeText={(v) => updateAt(i, { ...step, text: v })}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Text style={typography.caption}>Duration</Text>
              <DurationField
                seconds={step.duration_seconds ?? null}
                onChange={(next) => updateAt(i, { ...step, duration_seconds: next })}
              />
            </View>
            {step.image_url ? (
              <View>
                <Image
                  source={{ uri: resolveImageUrl(step.image_url) ?? step.image_url }}
                  style={{ width: "100%", height: 160, borderRadius: radii.md }}
                  resizeMode="cover"
                />
                <Pressable onPress={() => updateAt(i, { ...step, image_url: null })}>
                  <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.xs }]}>Remove image</Text>
                </Pressable>
              </View>
            ) : (
              <Button
                variant="ghost"
                onPress={() => onPickImage(i)}
                title={uploadingIndex === i ? "Uploading…" : "Add image"}
              />
            )}
          </View>
          <View style={{ gap: spacing.xs }}>
            <Pressable onPress={() => swap(i, i - 1)}><Text style={typography.body}>↑</Text></Pressable>
            <Pressable onPress={() => swap(i, i + 1)}><Text style={typography.body}>↓</Text></Pressable>
            <Pressable onPress={() => removeAt(i)}><Text style={[typography.body, { color: colors.danger }]}>×</Text></Pressable>
          </View>
        </View>
      ))}
      <Button variant="ghost" onPress={append} title="+ Add step" />
    </View>
  );
}
```

If `typography.fieldLabel` doesn't exist in `apps/mobile/src/theme/typography.ts`, add it (a bold ~14pt preset) — that's the right time to extend the theme, not to inline `fontWeight`/`fontSize` in feature code.

If the `Button` component doesn't accept `variant="ghost"` (check `apps/mobile/src/components/Button.tsx`), substitute one that exists. Per CLAUDE.md the variants are `primary | secondary | ghost | destructive`, so `ghost` should work.

- [ ] **Step 2: Verify types**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: zero errors. If `fieldLabel` is missing from `typography`, add it now (one-line preset) and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/features/import/StepListEditor.tsx apps/mobile/src/theme/typography.ts
git commit -m "feat(mobile): step list editor"
```

(Drop `typography.ts` from the add if you didn't change it.)

---

### Task 24: `StringListEditor` for mobile

**Files:**
- Create: `apps/mobile/src/features/import/StringListEditor.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { View, Text, TextInput, Pressable } from "react-native";
import { typography, spacing, colors, radii } from "../../theme";
import { Button } from "@/src/components";

interface Props {
  label: string;
  addLabel: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}

export function StringListEditor({ label, addLabel, placeholder, values, onChange }: Props) {
  const updateAt = (i: number, v: string) => {
    const arr = values.slice();
    arr[i] = v;
    onChange(arr);
  };
  const removeAt = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const append = () => onChange([...values, ""]);

  return (
    <View style={{ marginVertical: spacing.md }}>
      <Text style={typography.fieldLabel}>{label}</Text>
      {values.map((v, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginVertical: spacing.xs }}>
          <TextInput
            placeholder={placeholder}
            value={v}
            onChangeText={(next) => updateAt(i, next)}
            style={[typography.body, { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, padding: spacing.sm }]}
          />
          <Pressable onPress={() => removeAt(i)}>
            <Text style={[typography.body, { color: colors.danger }]}>×</Text>
          </Pressable>
        </View>
      ))}
      <Button variant="ghost" onPress={append} title={`+ ${addLabel}`} />
    </View>
  );
}
```

- [ ] **Step 2: Verify types**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/features/import/StringListEditor.tsx
git commit -m "feat(mobile): string list editor for tips and equipment"
```

---

### Task 25: Wire all sections into mobile `DraftRecipeEditor`

**Files:**
- Modify: `apps/mobile/src/features/import/DraftRecipeEditor.tsx`

- [ ] **Step 1: Add description + total-time fields, then steps/tips/equipment**

In `DraftRecipeEditor.tsx`, import and render:

```tsx
import { TotalTimeField } from "./TotalTimeField";
import { StepListEditor } from "./StepListEditor";
import { StringListEditor } from "./StringListEditor";

// inside the component, just below the title input and above the existing ingredients block:
<View style={{ marginVertical: spacing.md }}>
  <Text style={typography.fieldLabel}>Description</Text>
  <TextInput
    multiline
    maxLength={500}
    placeholder="Optional short description"
    style={[typography.body, { borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, padding: spacing.sm, minHeight: 60 }]}
    value={draft.description ?? ""}
    onChangeText={(v) => onChange({ ...draft, description: v })}
  />
</View>
<View style={{ marginVertical: spacing.md }}>
  <Text style={typography.fieldLabel}>Total time</Text>
  <TotalTimeField
    minutes={draft.total_time_minutes ?? null}
    onChange={(next) => onChange({ ...draft, total_time_minutes: next })}
    suffix="min"
  />
</View>

// existing ingredients block stays here

<StepListEditor
  steps={draft.steps ?? []}
  onChange={(steps) => onChange({ ...draft, steps })}
  pickImage={pickStepImage}
/>
<StringListEditor
  label="Tips"
  addLabel="Add tip"
  placeholder="Add a chef's note"
  values={draft.tips ?? []}
  onChange={(tips) => onChange({ ...draft, tips })}
/>
<StringListEditor
  label="Equipment"
  addLabel="Add equipment"
  placeholder="Add a pan or tool"
  values={draft.equipment ?? []}
  onChange={(equipment) => onChange({ ...draft, equipment })}
/>
```

- [ ] **Step 2: Wire `pickStepImage` using the existing upload hook**

In the parent (`ImportModalScreen.tsx` or wherever `useImageUpload` is consumed), add a helper:

```tsx
const { uploadImage } = useImageUpload();

const pickStepImage = async (): Promise<string | null> => {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const url = await uploadImage(asset.uri, asset.mimeType || "image/jpeg");
  return url;
};
```

Pass `pickStepImage` into `DraftRecipeEditor` as a prop (extend the props type).

- [ ] **Step 3: Run on the simulator**

```bash
cd apps/mobile && REACT_NATIVE_PACKAGER_HOSTNAME=localhost npx expo start --ios --clear
```

In the app: log in → tap Import → paste a transcript (or use the link form) → parse → confirm description, total time, steps, tips, equipment render. Edit a step, add an image (or skip if simulator can't access photos), save.

- [ ] **Step 4: Run tsc**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/import/DraftRecipeEditor.tsx apps/mobile/src/features/import/ImportModalScreen.tsx
git commit -m "feat(mobile): tutorial-rich import editor"
```

---

### Task 26: Recipe edit screen — add the same sections

**Files:**
- Modify: `apps/mobile/src/features/library/RecipeEditScreen.tsx`

- [ ] **Step 1: Reuse the same sub-components**

Import `StepListEditor`, `StringListEditor`, `TotalTimeField` from `../import/...`. Pull in `useImageUpload` and define `pickStepImage` the same way as in Task 25 (DRY: lift the helper to `apps/mobile/src/lib/pickStepImage.ts` if both screens use it).

Render the same five sections inside the existing edit form.

PATCH payload includes the new fields. Confirm via `grep -n "PATCH\|api.recipes.update\|recipes\.update" apps/mobile/src/features/library/RecipeEditScreen.tsx` that the existing save passes the full draft.

- [ ] **Step 2: Verify in simulator**

Open a recipe → tap Edit → confirm sections render → add a step → Save → reopen → confirm.

- [ ] **Step 3: Run tsc**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/features/library/RecipeEditScreen.tsx apps/mobile/src/lib/pickStepImage.ts 2>/dev/null
git commit -m "feat(mobile): edit tutorial fields on recipe edit screen"
```

---

### Task 27: Recipe detail screen — render new fields read-only

**Files:**
- Modify: `apps/mobile/src/features/library/RecipeDetailScreen.tsx`

- [ ] **Step 1: Add the read-only renderers**

```tsx
import { formatStepDuration } from "@cooking/shared";
import { resolveImageUrl } from "@/src/lib/imageUrl";

// inside the JSX, above the ingredients block:
{recipe.description ? (
  <Text style={[typography.body, { fontStyle: "italic", opacity: 0.85, marginBottom: spacing.sm }]}>
    {recipe.description}
  </Text>
) : null}
{typeof recipe.total_time_minutes === "number" ? (
  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.md }}>
    <Text style={typography.body}>⏱</Text>
    <Text style={typography.body}>{recipe.total_time_minutes} min</Text>
  </View>
) : null}

// existing ingredients block stays here

{(recipe.equipment ?? []).length > 0 && (
  <View style={{ marginTop: spacing.lg }}>
    <Text style={typography.h3}>Equipment</Text>
    {recipe.equipment!.map((e, i) => (
      <Text key={i} style={typography.body}>• {e}</Text>
    ))}
  </View>
)}

{(recipe.steps ?? []).length > 0 && (
  <View style={{ marginTop: spacing.lg }}>
    <Text style={typography.h3}>Steps</Text>
    {recipe.steps!.map((s, i) => (
      <View key={i} style={{ marginVertical: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={[typography.body, { fontWeight: "600" }]}>{i + 1}.</Text>
          {s.duration_seconds && s.duration_seconds > 0 ? (
            <Text style={[typography.caption, { backgroundColor: colors.chipBg, paddingHorizontal: spacing.xs, borderRadius: radii.xs }]}>
              ⏱ {formatStepDuration(s.duration_seconds)}
            </Text>
          ) : null}
        </View>
        <Text style={[typography.body, { marginTop: spacing.xs }]}>{s.text}</Text>
        {s.image_url ? (
          <Image
            source={{ uri: resolveImageUrl(s.image_url) ?? s.image_url }}
            style={{ width: "100%", height: 220, borderRadius: radii.md, marginTop: spacing.sm }}
            resizeMode="cover"
          />
        ) : null}
      </View>
    ))}
  </View>
)}

{(recipe.tips ?? []).length > 0 && (
  <View style={{ marginTop: spacing.lg }}>
    <Text style={typography.h3}>Tips</Text>
    {recipe.tips!.map((tp, i) => (
      <Text key={i} style={typography.body}>• {tp}</Text>
    ))}
  </View>
)}
```

If `colors.chipBg`, `typography.h3`, or `radii.xs` don't exist, add them to `apps/mobile/src/theme/` first. Per CLAUDE.md, never inline hex codes outside the theme module.

- [ ] **Step 2: Verify on simulator**

Open a recipe with tutorial fields → confirm everything renders. Open a legacy recipe → confirm nothing extra renders (no empty headers).

- [ ] **Step 3: Confirm theme rule still passes**

```bash
grep -rE "#[0-9a-fA-F]{6}" apps/mobile/src/features apps/mobile/src/navigation apps/mobile/src/components
```

Expected: zero matches. If any appear in your new code, move them into `apps/mobile/src/theme/colors.ts`.

- [ ] **Step 4: Run tsc**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/library/RecipeDetailScreen.tsx apps/mobile/src/theme
git commit -m "feat(mobile): render tutorial fields on recipe detail screen"
```

---

## Phase 6 — Docs & deploy prep

### Task 28: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the API surface table**

Find the row for `PATCH /recipes/{id}` and update its `Notes` column to mention the new fields:

```
| PATCH | `/recipes/{id}` | Partial update of `title`, `thumbnail_url`, `ingredients`, `library_tags`, `description`, `total_time_minutes`, `steps`, `tips`, `equipment` |
```

- [ ] **Step 2: Add a "Recipe tutorial fields" subsection under "Architecture notes that aren't obvious from a single file"**

```markdown
### Recipe tutorial fields

`Recipe` carries five optional, backward-compatible fields beyond the base ingredients/title set:
`description`, `total_time_minutes`, `steps`, `tips`, `equipment`. Stored as five new columns on
`recipes` (added in migration `20260514_recipe_tut`): the list-shaped fields are JSON-in-Text (same
pattern as `library_tags`); `description` is `Text NULL`; `total_time_minutes` is `Integer NULL`.

Each `RecipeStep` is `{ text, duration_seconds?, image_url? }`. **No stable IDs** — steps are
array-position only. If sub-project C (multi-modal extraction) later needs stable references to
enrich a specific step with a frame, add an `id` field then with on-read backfill; legacy entries
won't break.

Legacy recipes render gracefully with the new fields empty; no backfill job is wired up.
```

- [ ] **Step 3: Update "Alembic head" line**

Find the line "Alembic head is `20260416_store_cache`" — update to `20260514_recipe_tut`. Also acknowledge `20260510_user_lib` in the chain if missing.

- [ ] **Step 4: Append to "Known cleanup targets"**

```markdown
- **Stable step IDs:** Steps in `RecipeStep` are array-position only. Sub-project C (multi-modal
  extraction) will likely want stable IDs to attach extracted frames to specific steps. Add an
  optional `id: str` field to `RecipeStep`, generate ids on read for legacy rows, then drop the
  fallback once all rows are normalized.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: capture recipe tutorial schema + new alembic head in CLAUDE.md"
```

---

### Task 29: Final end-to-end verification

**Files:**
- None (verification only)

- [ ] **Step 1: Backend smoke**

```bash
bash backend/scripts/smoke_tutorial_schema.sh <your-test-email> <your-test-password>
```

Expected: `✓ tutorial schema smoke passed`.

- [ ] **Step 2: Web prod build (catches @types/react drift before Vercel)**

```bash
npm --workspace @cooking/web run build
```

Expected: build succeeds, no type errors.

- [ ] **Step 3: Mobile typecheck**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Manual click-through on web**

1. `/import` — paste transcript → parse → edit all sections → save.
2. `/recipe/<saved-id>` — confirm read view renders description, total-time chip, equipment, steps (with mm:ss chips and image if uploaded), tips.
3. `/recipe/<saved-id>` → Edit → modify a step duration → save → reopen → confirm persisted.
4. Open a legacy recipe — confirm no empty sections render.

- [ ] **Step 5: Manual click-through on iOS simulator**

Same five scenarios as Step 4, in the mobile UI.

- [ ] **Step 6: No regressions on the planner/shopping flow**

Quickly verify Library list, Planner, Shopping pages still load (they may pre-fetch recipes — confirm the new fields don't break JSON parsing). No code changes are expected to those flows, but the new `Recipe` shape rides along.

---

### Task 30: Deploy backend, then merge web

**Files:**
- None (deploy + merge)

- [ ] **Step 1: Verify the prod backend currently 404s on a tutorial field check**

This is the inverse of the typical readiness check — we don't have a new route, just new fields on existing routes. Verify by reading a known recipe ID and confirming the prod response lacks `steps`:

```bash
# Get a session cookie against prod first via /auth/login (skip if you don't have a prod test acct).
curl -s -b /tmp/prodc.txt https://api.chef-world.com/recipes/<known-id> | jq 'has("steps")'
```

Expected (pre-deploy): `false`.

- [ ] **Step 2: Deploy backend**

```bash
bash scripts/deploy-backend.sh
```

Expected: script reports the new task definition rolled and the smoke probe (`/health`) passes. Wait for "service stable" message.

- [ ] **Step 3: Confirm migration applied in prod**

```bash
curl -s -b /tmp/prodc.txt https://api.chef-world.com/recipes/<known-id> | jq '{has_steps: has("steps"), steps_len: (.steps // []) | length}'
```

Expected: `{ "has_steps": true, "steps_len": 0 }` (legacy recipe, empty array).

- [ ] **Step 4: Merge the feature branch to `main`**

Vercel auto-deploys web. Watch the Vercel build complete; confirm `chef-world.com/import` still loads and `/recipe/<id>` renders with the new sections.

- [ ] **Step 5: Mobile ships at its own cadence**

When ready: `cd apps/mobile && eas build --profile preview --platform ios`. Internal-testing build that points at the prod backend (now schema-aware). No urgency — web parity is the gate.

- [ ] **Step 6: Final commit (only if anything changed during the deploy pass)**

If you adjusted anything during the rollout, commit it. Otherwise skip.

---

## Notes for the implementing agent

- **Frequent commits** — every task ends with a commit. If a step uncovers a bug or makes a code path inconsistent with a prior task, fix it in the same commit and update later tasks if they reference the wrong name. Type-name drift across tasks is the most common failure mode for this kind of plan; the implementing agent should grep before locking each task's new identifier.
- **`@cooking/shared` is rebuilt only on workspace consumers' build.** If web pages can't see new types, run `npm --workspace @cooking/shared run build` (or equivalent — confirm the shared package's build script). Mobile uses `file:` workspace linking too.
- **OPENAI_API_KEY** is unset locally per CLAUDE.md, so `extract_recipe_from_text` falls back to the stub. Use the stub Mapo Tofu recipe to exercise the full UI without burning tokens. Set the key only when manually verifying that the real prompt produces good output.
- **The `Button` / typography preset names** referenced in mobile tasks reflect what CLAUDE.md describes today. If a name differs, prefer adding to the theme module over inlining values.
- **Deploy-order rule (from CLAUDE.md):** backend first, then web. Reversing this risks silent data loss because FastAPI ignores unknown body keys.
