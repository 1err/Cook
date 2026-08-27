"""Cooking-session API contracts and deterministic step state transitions."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.db.models import CookingSessionDishModel, CookingSessionStepModel
from app.models import IngredientItem


CookingStepState = Literal[
    "locked",
    "ready",
    "timer_running",
    "timer_paused",
    "needs_attention",
    "completed",
    "skipped",
]
CookingAction = Literal[
    "start_timer",
    "pause_timer",
    "resume_timer",
    "extend_timer",
    "complete",
    "skip",
    "reopen",
    "take_alert_ownership",
]

RESOLVED_STATES = frozenset({"completed", "skipped"})
ACTIVE_TIMER_STATES = frozenset({"timer_running", "timer_paused", "needs_attention"})


class CookingConflict(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class CookingSessionCreate(BaseModel):
    recipe_ids: list[str]

    @field_validator("recipe_ids", mode="before")
    @classmethod
    def normalize_recipe_ids(cls, value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        result: list[str] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, str) or not (recipe_id := item.strip()) or recipe_id in seen:
                continue
            seen.add(recipe_id)
            result.append(recipe_id)
        return result


class CookingDishesAdd(CookingSessionCreate):
    pass


class CookingStepActionBody(BaseModel):
    action: CookingAction
    mutation_id: UUID
    device_id: str = Field(min_length=1, max_length=128)
    occurred_at: datetime
    expected_revision: int = Field(ge=1)
    extension_seconds: int | None = None

    @field_validator("device_id")
    @classmethod
    def trim_device_id(cls, value: str) -> str:
        return value.strip()


class CookingStep(BaseModel):
    id: str
    recipe_step_id: str
    position: int
    text: str
    duration_seconds: int
    duration_source: str
    attention_type: str
    action_type: str
    image_url: str | None
    state: CookingStepState
    timer_started_at: datetime | None
    timer_ends_at: datetime | None
    paused_remaining_seconds: int | None
    resolved_at: datetime | None
    notification_owner_device_id: str | None
    revision: int
    updated_at: datetime


class CookingDish(BaseModel):
    id: str
    recipe_id: str
    position: int
    title: str
    thumbnail_url: str | None
    ingredients: list[IngredientItem]
    equipment: list[str]
    tips: list[str]
    created_at: datetime
    steps: list[CookingStep]


class CookingSession(BaseModel):
    id: str
    version: int
    created_at: datetime
    updated_at: datetime
    dishes: list[CookingDish]


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _occurred_at(body: CookingStepActionBody, now: datetime) -> datetime:
    occurred = _utc(body.occurred_at)
    canonical_now = _utc(now)
    return min(occurred, canonical_now)


def _require_state(step: CookingSessionStepModel, *states: str) -> None:
    if step.state not in states:
        raise CookingConflict(
            "invalid_transition",
            f"Cannot apply this action while the step is {step.state}.",
        )


def _clear_timer(step: CookingSessionStepModel) -> None:
    step.timer_started_at = None
    step.timer_ends_at = None
    step.paused_remaining_seconds = None
    step.notification_owner_device_id = None


def _bump(step: CookingSessionStepModel, at: datetime) -> None:
    step.revision += 1
    step.updated_at = at


def normalize_expired_timers(dish: CookingSessionDishModel, now: datetime) -> bool:
    """Persist elapsed running timers as attention without resolving them."""
    canonical_now = _utc(now)
    changed = False
    for step in dish.steps:
        if (
            step.state == "timer_running"
            and step.timer_ends_at is not None
            and _utc(step.timer_ends_at) <= canonical_now
        ):
            step.state = "needs_attention"
            _bump(step, canonical_now)
            changed = True
    return changed


def apply_step_action(
    dish: CookingSessionDishModel,
    step: CookingSessionStepModel,
    body: CookingStepActionBody,
    now: datetime,
) -> None:
    """Apply one valid transition in place; repository owns locking/idempotency."""
    if step.revision != body.expected_revision:
        raise CookingConflict(
            "revision_conflict",
            "This step changed on another device. Reload the latest progress.",
        )

    occurred = _occurred_at(body, now)

    if body.action == "start_timer":
        _require_state(step, "ready")
        if step.attention_type != "passive":
            raise CookingConflict(
                "timer_requires_passive_step", "Only passive steps use countdown timers."
            )
        step.state = "timer_running"
        step.timer_started_at = occurred
        step.timer_ends_at = occurred + timedelta(seconds=step.duration_seconds)
        step.paused_remaining_seconds = None
        step.notification_owner_device_id = body.device_id

    elif body.action == "pause_timer":
        _require_state(step, "timer_running")
        ends_at = _utc(step.timer_ends_at) if step.timer_ends_at else occurred
        step.state = "timer_paused"
        step.paused_remaining_seconds = max(
            0, int((ends_at - occurred).total_seconds() + 0.999999)
        )
        step.timer_ends_at = None

    elif body.action == "resume_timer":
        _require_state(step, "timer_paused")
        remaining = max(0, step.paused_remaining_seconds or step.duration_seconds)
        step.state = "timer_running"
        step.timer_started_at = occurred
        step.timer_ends_at = occurred + timedelta(seconds=remaining)
        step.paused_remaining_seconds = None
        step.notification_owner_device_id = body.device_id

    elif body.action == "extend_timer":
        _require_state(step, "timer_running", "timer_paused", "needs_attention")
        extension = body.extension_seconds
        if extension is None or extension < 1 or extension > 86_400:
            raise CookingConflict("invalid_extension", "Timer extension must be 1–86,400 seconds.")
        if step.state == "timer_paused":
            step.paused_remaining_seconds = (step.paused_remaining_seconds or 0) + extension
        else:
            existing_end = _utc(step.timer_ends_at) if step.timer_ends_at else occurred
            base = max(occurred, existing_end) if step.state == "timer_running" else occurred
            step.state = "timer_running"
            step.timer_started_at = step.timer_started_at or occurred
            step.timer_ends_at = base + timedelta(seconds=extension)
            step.paused_remaining_seconds = None
            step.notification_owner_device_id = body.device_id

    elif body.action in ("complete", "skip"):
        _require_state(step, "ready", "timer_running", "timer_paused", "needs_attention")
        step.state = "completed" if body.action == "complete" else "skipped"
        step.resolved_at = occurred
        _clear_timer(step)
        locked = next((candidate for candidate in dish.steps if candidate.state == "locked"), None)
        if locked is not None:
            locked.state = "ready"
            _bump(locked, occurred)

    elif body.action == "reopen":
        _require_state(step, "completed", "skipped")
        if any(candidate.state in ACTIVE_TIMER_STATES for candidate in dish.steps):
            raise CookingConflict(
                "active_timer_blocks_reopen",
                "Resolve or pause the active timer before reopening an earlier step.",
            )
        for candidate in dish.steps:
            if candidate is not step and candidate.state == "ready":
                candidate.state = "locked"
                _bump(candidate, occurred)
        step.state = "ready"
        step.resolved_at = None
        _clear_timer(step)

    elif body.action == "take_alert_ownership":
        _require_state(step, "timer_running", "timer_paused", "needs_attention")
        step.notification_owner_device_id = body.device_id

    _bump(step, occurred)
