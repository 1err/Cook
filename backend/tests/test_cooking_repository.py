from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID

import pytest

from app.cooking import CookingConflict, CookingStepActionBody
from app.db import repo_cooking
from app.db.models import (
    CookingSessionDishModel,
    CookingSessionModel,
    CookingSessionStepModel,
)


NOW = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)
USER_ID = UUID("10000000-0000-0000-0000-000000000001")
SESSION_ID = UUID("20000000-0000-0000-0000-000000000001")
DISH_ID = UUID("30000000-0000-0000-0000-000000000001")
STEP_ID = UUID("40000000-0000-0000-0000-000000000001")
RECIPE_STEP_ID = UUID("50000000-0000-0000-0000-000000000001")
MUTATION_ID = UUID("60000000-0000-0000-0000-000000000001")


class RecordingSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.flushes = 0

    def add(self, value: object) -> None:
        self.added.append(value)

    async def delete(self, value: object) -> None:
        self.deleted.append(value)

    async def flush(self) -> None:
        self.flushes += 1


def recipe_row(recipe_id: str = "recipe-1", *, user_id: UUID = USER_ID):
    return SimpleNamespace(
        id=recipe_id,
        user_id=user_id,
        title="Mapo tofu",
        source_url=None,
        thumbnail_url="https://images.example/mapo.jpg",
        ingredients=json.dumps([{"name": "Tofu", "quantity": "1 block"}]),
        raw_extraction_text=None,
        library_tags="[]",
        library_category=None,
        is_public_catalog=False,
        catalog_source_recipe_id=None,
        description=None,
        total_time_minutes=12,
        steps=json.dumps(
            [
                {
                    "id": str(RECIPE_STEP_ID),
                    "text": "Simmer gently",
                    "duration_seconds": 600,
                    "duration_source": "stated",
                    "attention_type": "passive",
                    "action_type": "simmer",
                    "image_url": None,
                },
                {
                    "id": "50000000-0000-0000-0000-000000000002",
                    "text": "Plate",
                    "duration_seconds": 120,
                    "duration_source": "estimated",
                    "attention_type": "hands_on",
                    "action_type": "plate",
                    "image_url": None,
                },
            ]
        ),
        tips=json.dumps(["Taste before serving"]),
        equipment=json.dumps(["Skillet"]),
    )


def active_model(*, first_state: str = "ready", second_state: str = "locked") -> CookingSessionModel:
    model = CookingSessionModel(
        id=SESSION_ID,
        user_id=USER_ID,
        version=1,
        created_at=NOW - timedelta(hours=1),
        updated_at=NOW - timedelta(minutes=1),
    )
    dish = CookingSessionDishModel(
        id=DISH_ID,
        session_id=SESSION_ID,
        recipe_id="recipe-1",
        position=0,
        title="Mapo tofu",
        thumbnail_url=None,
        ingredients=[{"name": "Tofu", "quantity": "1 block"}],
        equipment=["Skillet"],
        tips=["Taste before serving"],
        created_at=NOW - timedelta(hours=1),
    )
    first = CookingSessionStepModel(
        id=STEP_ID,
        dish_id=DISH_ID,
        recipe_step_id=RECIPE_STEP_ID,
        position=0,
        text="Simmer gently",
        duration_seconds=600,
        duration_source="stated",
        attention_type="passive",
        action_type="simmer",
        image_url=None,
        state=first_state,
        revision=1,
        updated_at=NOW - timedelta(minutes=1),
    )
    second = CookingSessionStepModel(
        id=UUID("40000000-0000-0000-0000-000000000002"),
        dish_id=DISH_ID,
        recipe_step_id=UUID("50000000-0000-0000-0000-000000000002"),
        position=1,
        text="Plate",
        duration_seconds=120,
        duration_source="estimated",
        attention_type="hands_on",
        action_type="plate",
        image_url=None,
        state=second_state,
        revision=1,
        updated_at=NOW - timedelta(minutes=1),
    )
    dish.steps = [first, second]
    model.dishes = [dish]
    return model


def action(action_name: str = "complete", revision: int = 1) -> CookingStepActionBody:
    return CookingStepActionBody(
        action=action_name,
        mutation_id=MUTATION_ID,
        device_id="device-a",
        occurred_at=NOW,
        expected_revision=revision,
    )


@pytest.mark.asyncio
async def test_create_snapshots_owned_recipe_data_and_stable_step_metadata(monkeypatch) -> None:
    db = RecordingSession()
    monkeypatch.setattr(repo_cooking, "_now", lambda: NOW)
    monkeypatch.setattr(repo_cooking, "_get_active_model", AsyncMock(return_value=None))
    monkeypatch.setattr(
        repo_cooking, "_load_owned_recipe_rows", AsyncMock(return_value=[recipe_row()])
    )

    result = await repo_cooking.create_session(db, USER_ID, ["recipe-1"])

    assert result.dishes[0].title == "Mapo tofu"
    assert result.dishes[0].ingredients[0].name == "Tofu"
    assert [step.state for step in result.dishes[0].steps] == ["ready", "locked"]
    assert result.dishes[0].steps[0].recipe_step_id == str(RECIPE_STEP_ID)
    assert result.dishes[0].steps[0].attention_type == "passive"
    assert len(db.added) == 1
    assert db.flushes == 1


@pytest.mark.asyncio
async def test_create_rejects_an_existing_active_session(monkeypatch) -> None:
    monkeypatch.setattr(
        repo_cooking, "_get_active_model", AsyncMock(return_value=active_model())
    )

    with pytest.raises(CookingConflict) as exc_info:
        await repo_cooking.create_session(RecordingSession(), USER_ID, ["recipe-1"])

    assert exc_info.value.code == "active_session_exists"


@pytest.mark.asyncio
async def test_create_rejects_missing_unowned_or_step_less_recipes(monkeypatch) -> None:
    monkeypatch.setattr(repo_cooking, "_get_active_model", AsyncMock(return_value=None))
    monkeypatch.setattr(repo_cooking, "_load_owned_recipe_rows", AsyncMock(return_value=[]))

    with pytest.raises(CookingConflict) as missing:
        await repo_cooking.create_session(RecordingSession(), USER_ID, ["not-owned"])
    assert missing.value.code == "recipe_not_owned"

    no_steps = recipe_row()
    no_steps.steps = "[]"
    monkeypatch.setattr(
        repo_cooking, "_load_owned_recipe_rows", AsyncMock(return_value=[no_steps])
    )
    with pytest.raises(CookingConflict) as empty:
        await repo_cooking.create_session(RecordingSession(), USER_ID, ["recipe-1"])
    assert empty.value.code == "recipe_has_no_steps"


@pytest.mark.asyncio
async def test_get_active_normalizes_expiry_without_completing(monkeypatch) -> None:
    model = active_model(first_state="timer_running")
    model.dishes[0].steps[0].timer_ends_at = NOW - timedelta(seconds=1)
    monkeypatch.setattr(repo_cooking, "_now", lambda: NOW)
    monkeypatch.setattr(
        repo_cooking, "_get_active_model", AsyncMock(return_value=model)
    )
    db = RecordingSession()

    result = await repo_cooking.get_active_session(db, USER_ID)

    assert result is not None
    assert result.dishes[0].steps[0].state == "needs_attention"
    assert result.dishes[0].steps[1].state == "locked"
    assert model.version == 2
    assert db.flushes == 1


@pytest.mark.asyncio
async def test_get_active_normalizes_elapsed_timers_in_every_dish(monkeypatch) -> None:
    model = active_model(first_state="timer_running")
    model.dishes[0].steps[0].timer_ends_at = NOW - timedelta(seconds=1)
    second_dish = active_model(first_state="timer_running").dishes[0]
    second_dish.id = UUID("30000000-0000-0000-0000-000000000002")
    second_dish.position = 1
    second_dish.title = "Rice"
    second_dish.steps[0].id = UUID("40000000-0000-0000-0000-000000000003")
    second_dish.steps[0].timer_ends_at = NOW - timedelta(seconds=2)
    model.dishes.append(second_dish)
    monkeypatch.setattr(repo_cooking, "_now", lambda: NOW)
    monkeypatch.setattr(repo_cooking, "_get_active_model", AsyncMock(return_value=model))

    result = await repo_cooking.get_active_session(RecordingSession(), USER_ID)

    assert result is not None
    assert [dish.steps[0].state for dish in result.dishes] == [
        "needs_attention",
        "needs_attention",
    ]


@pytest.mark.asyncio
async def test_duplicate_mutation_returns_canonical_state_without_reapplying(monkeypatch) -> None:
    model = active_model()
    monkeypatch.setattr(
        repo_cooking, "_get_active_model", AsyncMock(return_value=model)
    )
    monkeypatch.setattr(repo_cooking, "_mutation_exists", AsyncMock(return_value=True))
    transition = Mock()
    monkeypatch.setattr(repo_cooking, "apply_step_action", transition)

    result = await repo_cooking.apply_action(
        RecordingSession(), USER_ID, SESSION_ID, STEP_ID, action()
    )

    assert result.id == str(SESSION_ID)
    transition.assert_not_called()
    assert model.version == 1


@pytest.mark.asyncio
async def test_action_updates_only_requested_dish_and_records_idempotency(monkeypatch) -> None:
    model = active_model()
    monkeypatch.setattr(repo_cooking, "_now", lambda: NOW)
    monkeypatch.setattr(
        repo_cooking, "_get_active_model", AsyncMock(return_value=model)
    )
    monkeypatch.setattr(repo_cooking, "_mutation_exists", AsyncMock(return_value=False))
    db = RecordingSession()

    result = await repo_cooking.apply_action(db, USER_ID, SESSION_ID, STEP_ID, action())

    assert [step.state for step in result.dishes[0].steps] == ["completed", "ready"]
    assert result.version == 2
    assert db.added[0].mutation_id == MUTATION_ID
    assert db.flushes == 1


@pytest.mark.asyncio
async def test_finish_rejects_unresolved_work_and_deletes_a_completed_session(monkeypatch) -> None:
    model = active_model()
    monkeypatch.setattr(
        repo_cooking, "_get_active_model", AsyncMock(return_value=model)
    )
    db = RecordingSession()

    with pytest.raises(CookingConflict) as exc_info:
        await repo_cooking.finish_session(db, USER_ID, SESSION_ID)
    assert exc_info.value.code == "session_not_complete"

    for step in model.dishes[0].steps:
        step.state = "completed"
    result = await repo_cooking.finish_session(db, USER_ID, SESSION_ID)
    assert result == {"ok": True}
    assert db.deleted == [model]


@pytest.mark.asyncio
async def test_removing_the_final_dish_discards_the_session(monkeypatch) -> None:
    model = active_model()
    monkeypatch.setattr(
        repo_cooking, "_get_active_model", AsyncMock(return_value=model)
    )
    db = RecordingSession()

    result = await repo_cooking.remove_dish(db, USER_ID, SESSION_ID, DISH_ID)

    assert result is None
    assert db.deleted == [model]
