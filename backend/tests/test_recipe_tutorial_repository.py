"""Repository persistence contracts for canonical tutorial steps."""
from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.db.repo_recipes import _row_to_recipe, copy_public_recipe_to_user, save_recipe
from app.db.models import UserModel, RecipeModel
from test_recipe_write_security import sql_session, OWNER_ID, CALLER_ID


STEP_ID = "20000000-0000-0000-0000-000000000001"
CANONICAL_STEP = {
    "id": STEP_ID,
    "text": "Bake until golden",
    "duration_seconds": 600,
    "duration_source": "fallback",
    "attention_type": "hands_on",
    "action_type": "bake",
    "image_url": "/uploads/bake.jpg",
    "instruction_source": None,
    "source_start_seconds": None,
    "source_end_seconds": None,
    "source_excerpt": None,
}


def _recipe_row(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = {
        "id": "recipe-1",
        "user_id": uuid.UUID("30000000-0000-0000-0000-000000000001"),
        "title": "Baked onions",
        "source_url": None,
        "thumbnail_url": None,
        "ingredients": "[]",
        "raw_extraction_text": None,
        "library_tags": "[]",
        "library_category": None,
        "is_public_catalog": False,
        "catalog_source_recipe_id": None,
        "description": None,
        "total_time_minutes": 12,
        "steps": json.dumps(
            [
                {"text": "Chop onion", "duration_seconds": 120},
                {"text": "Bake until golden", "image_url": "/uploads/bake.jpg"},
            ]
        ),
        "tips": "[]",
        "equipment": "[]",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_row_to_recipe_normalizes_legacy_steps_using_the_recipe_total_time() -> None:
    """Breaks if repository reads omit timing context or canonical step metadata."""
    recipe = _row_to_recipe(_recipe_row())

    assert recipe.steps[0].duration_seconds == 120
    assert recipe.steps[0].duration_source == "stated"
    assert recipe.steps[1].model_dump(exclude={"id"}) == {
        "text": "Bake until golden",
        "duration_seconds": 600,
        "duration_source": "fallback",
        "attention_type": "hands_on",
        "action_type": "other",
        "image_url": "/uploads/bake.jpg",
        "instruction_source": None,
        "source_start_seconds": None,
        "source_end_seconds": None,
        "source_excerpt": None,
    }
    assert UUID(recipe.steps[0].id or "")
    assert UUID(recipe.steps[1].id or "")


class _RecordingSession:
    def __init__(self) -> None:
        self.saved: list[object] = []

    async def execute(self, statement: object) -> object:
        row = SimpleNamespace(**statement.compile().params)
        self.saved.append(row)
        return self

    def scalars(self) -> "_ScalarsResult":
        return _ScalarsResult(self.saved[-1])


@pytest.mark.asyncio
async def test_save_recipe_serializes_all_canonical_fields_and_preserves_ids(sql_session) -> None:
    """Real saves retain canonical tutorial values and stable IDs."""
    recipe = _row_to_recipe(_recipe_row())
    await save_recipe(sql_session, recipe, CALLER_ID)
    first_payload = json.loads(sql_session.sync.get(RecipeModel, recipe.id).steps)
    await save_recipe(sql_session, recipe, CALLER_ID)
    second_payload = json.loads(sql_session.sync.get(RecipeModel, recipe.id).steps)
    assert first_payload == second_payload
    assert set(first_payload[0]) == set(CANONICAL_STEP)
    assert first_payload[1]["image_url"] == "/uploads/bake.jpg"
    assert [step["id"] for step in first_payload] == [step.id for step in recipe.steps]


class _ScalarsResult:
    def __init__(self, row: object | None) -> None:
        self.row = row

    def one_or_none(self) -> object | None:
        return self.row


class _CopySession:
    def __init__(self, source: object) -> None:
        self._results = iter([UUID("30000000-0000-0000-0000-000000000004"), source, None])
        self.added: list[object] = []

    async def execute(self, statement: object) -> "_CopySession":
        self._current = next(self._results)
        return self

    def scalars(self) -> _ScalarsResult:
        return _ScalarsResult(self._current)

    def scalar_one_or_none(self) -> object | None:
        return self._current

    def add(self, model: object) -> None:
        self.added.append(model)

    async def flush(self) -> None:
        return None


@pytest.mark.asyncio
async def test_copy_public_recipe_keeps_the_source_step_metadata(sql_session) -> None:
    """Shared copying retains the original tutorial metadata and photos."""
    source = RecipeModel(id="recipe-1", user_id=OWNER_ID, title="Baked onions", ingredients="[]",
        is_public_catalog=True, steps=json.dumps([CANONICAL_STEP]))
    sql_session.add(source)
    await sql_session.flush()
    copied = await copy_public_recipe_to_user(sql_session, source.id, CALLER_ID)
    assert copied is not None
    assert [step.model_dump() for step in copied.steps] == [CANONICAL_STEP]
