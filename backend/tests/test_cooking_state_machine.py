from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from app.cooking import (
    CookingConflict,
    CookingStepActionBody,
    apply_step_action,
    normalize_expired_timers,
)
from app.db.models import CookingSessionDishModel, CookingSessionStepModel


NOW = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)
SESSION_ID = UUID("10000000-0000-0000-0000-000000000001")
DISH_ID = UUID("20000000-0000-0000-0000-000000000001")
STEP_IDS = [
    UUID("30000000-0000-0000-0000-000000000001"),
    UUID("30000000-0000-0000-0000-000000000002"),
    UUID("30000000-0000-0000-0000-000000000003"),
]
RECIPE_STEP_IDS = [
    UUID("40000000-0000-0000-0000-000000000001"),
    UUID("40000000-0000-0000-0000-000000000002"),
    UUID("40000000-0000-0000-0000-000000000003"),
]


def make_step(
    position: int,
    state: str,
    *,
    attention_type: str = "hands_on",
    duration_seconds: int = 120,
    revision: int = 1,
) -> CookingSessionStepModel:
    return CookingSessionStepModel(
        id=STEP_IDS[position],
        dish_id=DISH_ID,
        recipe_step_id=RECIPE_STEP_IDS[position],
        position=position,
        text=f"Step {position + 1}",
        duration_seconds=duration_seconds,
        duration_source="estimated",
        attention_type=attention_type,
        action_type="other",
        image_url=None,
        state=state,
        revision=revision,
        updated_at=NOW - timedelta(minutes=10),
    )


def make_dish(*steps: CookingSessionStepModel) -> CookingSessionDishModel:
    dish = CookingSessionDishModel(
        id=DISH_ID,
        session_id=SESSION_ID,
        recipe_id="recipe-1",
        position=0,
        title="Mapo tofu",
        thumbnail_url=None,
        ingredients=[],
        equipment=[],
        tips=[],
        created_at=NOW - timedelta(hours=1),
    )
    dish.steps = list(steps)
    return dish


def body(
    action: str,
    *,
    revision: int = 1,
    occurred_at: datetime = NOW,
    extension_seconds: int | None = None,
) -> CookingStepActionBody:
    return CookingStepActionBody(
        action=action,
        mutation_id=UUID("50000000-0000-0000-0000-000000000001"),
        device_id="device-a",
        occurred_at=occurred_at,
        expected_revision=revision,
        extension_seconds=extension_seconds,
    )


@pytest.mark.parametrize(
    ("state", "action", "attention_type", "expected"),
    [
        ("ready", "start_timer", "passive", "timer_running"),
        ("timer_running", "pause_timer", "passive", "timer_paused"),
        ("timer_paused", "resume_timer", "passive", "timer_running"),
        ("ready", "complete", "hands_on", "completed"),
        ("ready", "skip", "hands_on", "skipped"),
        ("completed", "reopen", "hands_on", "ready"),
    ],
)
def test_valid_transitions_change_state_and_revision(
    state: str, action: str, attention_type: str, expected: str
) -> None:
    step = make_step(0, state, attention_type=attention_type)
    if state == "timer_running":
        step.timer_started_at = NOW - timedelta(seconds=30)
        step.timer_ends_at = NOW + timedelta(seconds=90)
    if state == "timer_paused":
        step.paused_remaining_seconds = 90
    if state == "completed":
        step.resolved_at = NOW - timedelta(seconds=30)
    dish = make_dish(step)

    apply_step_action(dish, step, body(action), NOW)

    assert step.state == expected
    assert step.revision == 2
    assert step.updated_at == NOW


def test_start_timer_uses_absolute_end_and_assigns_alert_owner() -> None:
    step = make_step(0, "ready", attention_type="passive", duration_seconds=95)
    dish = make_dish(step)

    apply_step_action(dish, step, body("start_timer"), NOW)

    assert step.timer_started_at == NOW
    assert step.timer_ends_at == NOW + timedelta(seconds=95)
    assert step.notification_owner_device_id == "device-a"


def test_expiry_becomes_needs_attention_without_resolving_or_advancing() -> None:
    first = make_step(0, "timer_running", attention_type="passive")
    first.timer_ends_at = NOW - timedelta(seconds=1)
    second = make_step(1, "locked")
    dish = make_dish(first, second)

    changed = normalize_expired_timers(dish, NOW)

    assert changed is True
    assert first.state == "needs_attention"
    assert first.resolved_at is None
    assert first.revision == 2
    assert second.state == "locked"


def test_complete_advances_only_the_earliest_locked_step() -> None:
    first = make_step(0, "ready")
    second = make_step(1, "locked")
    third = make_step(2, "locked")
    dish = make_dish(first, second, third)

    apply_step_action(dish, first, body("complete"), NOW)

    assert [step.state for step in dish.steps] == ["completed", "ready", "locked"]
    assert [step.revision for step in dish.steps] == [2, 2, 1]


def test_reopen_locks_the_previously_ready_step_and_subtracts_progress() -> None:
    first = make_step(0, "completed")
    first.resolved_at = NOW - timedelta(minutes=2)
    second = make_step(1, "ready")
    dish = make_dish(first, second)

    apply_step_action(dish, first, body("reopen"), NOW)

    assert [step.state for step in dish.steps] == ["ready", "locked"]
    assert first.resolved_at is None
    assert second.revision == 2


def test_reopen_is_blocked_while_the_dish_has_an_active_timer() -> None:
    first = make_step(0, "completed")
    active = make_step(1, "timer_running", attention_type="passive")
    active.timer_ends_at = NOW + timedelta(minutes=1)
    dish = make_dish(first, active)

    with pytest.raises(CookingConflict) as exc_info:
        apply_step_action(dish, first, body("reopen"), NOW)

    assert exc_info.value.code == "active_timer_blocks_reopen"
    assert first.state == "completed"


def test_hands_on_steps_reject_timer_start() -> None:
    step = make_step(0, "ready", attention_type="hands_on")
    dish = make_dish(step)

    with pytest.raises(CookingConflict) as exc_info:
        apply_step_action(dish, step, body("start_timer"), NOW)

    assert exc_info.value.code == "timer_requires_passive_step"


def test_stale_revision_rejects_without_mutation() -> None:
    step = make_step(0, "ready", revision=3)
    dish = make_dish(step)

    with pytest.raises(CookingConflict) as exc_info:
        apply_step_action(dish, step, body("complete", revision=2), NOW)

    assert exc_info.value.code == "revision_conflict"
    assert step.state == "ready"
    assert step.revision == 3


def test_extend_restarts_an_attention_timer_and_takeover_only_changes_owner() -> None:
    step = make_step(0, "needs_attention", attention_type="passive")
    step.notification_owner_device_id = "device-old"
    dish = make_dish(step)

    apply_step_action(dish, step, body("extend_timer", extension_seconds=60), NOW)

    assert step.state == "timer_running"
    assert step.timer_ends_at == NOW + timedelta(seconds=60)
    assert step.notification_owner_device_id == "device-a"

    takeover = body("take_alert_ownership", revision=2, occurred_at=NOW + timedelta(seconds=5))
    takeover.device_id = "device-b"
    original_end = step.timer_ends_at
    apply_step_action(dish, step, takeover, NOW + timedelta(seconds=5))

    assert step.timer_ends_at == original_end
    assert step.notification_owner_device_id == "device-b"


@pytest.mark.parametrize("extension", [None, 0, -1, 86_401])
def test_invalid_timer_extensions_have_a_stable_reason(extension: int | None) -> None:
    step = make_step(0, "timer_running", attention_type="passive")
    step.timer_ends_at = NOW + timedelta(seconds=30)
    dish = make_dish(step)

    with pytest.raises(CookingConflict) as exc_info:
        apply_step_action(dish, step, body("extend_timer", extension_seconds=extension), NOW)

    assert exc_info.value.code == "invalid_extension"
