"""Backfill stable recipe tutorial step metadata in existing JSON arrays.

Revision ID: 20260825_step_meta
Revises: 20260514_recipe_tut
"""
from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from statistics import median
from typing import Union
from uuid import UUID, uuid4

from alembic import op
import sqlalchemy as sa


revision: str = "20260825_step_meta"
down_revision: Union[str, None] = "20260514_recipe_tut"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DURATION_SOURCES = frozenset({"stated", "estimated", "user", "fallback"})
_ATTENTION_TYPES = frozenset({"hands_on", "passive"})
_ACTION_TYPES = frozenset(
    {
        "prep",
        "chop",
        "mix",
        "season",
        "sear",
        "simmer",
        "boil",
        "bake",
        "rest",
        "drain",
        "assemble",
        "plate",
        "other",
    }
)
_GENERATED_MIN_SECONDS = 15
_USER_MIN_SECONDS = 1
_MAX_STEP_SECONDS = 86_400
_DEFAULT_FALLBACK_SECONDS = 300


def _parse_step_rows(raw: object) -> list[dict[str, object]]:
    if not isinstance(raw, list):
        return []
    rows: list[dict[str, object]] = []
    for item in raw:
        if isinstance(item, str):
            payload: dict[str, object] = {"text": item}
        elif isinstance(item, dict):
            payload = dict(item)
        else:
            continue
        text = payload.get("text")
        if not isinstance(text, str) or not (text := text.strip()):
            continue
        payload["text"] = text
        rows.append(payload)
    return rows


def _coerce_nonnegative_int(value: object) -> int | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _valid_id(value: object) -> str | None:
    if not isinstance(value, (str, UUID)):
        return None
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        return None


def _metadata(value: object, allowed: frozenset[str], default: str) -> str:
    if not isinstance(value, str):
        return default
    value = value.strip()
    return value if value in allowed else default


def _normalized_image_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _clamp_duration(duration: int, source: str) -> int:
    minimum = _USER_MIN_SECONDS if source == "user" else _GENERATED_MIN_SECONDS
    return min(_MAX_STEP_SECONDS, max(minimum, duration))


def _new_id(id_factory: Callable[[], object], seen: set[str]) -> str:
    while True:
        generated = _valid_id(id_factory())
        if generated and generated not in seen:
            return generated


def _normalize_step_payloads(
    raw: object, total_time_minutes: object, id_factory: Callable[[], object] = uuid4
) -> list[dict[str, object]]:
    """Frozen copy of the canonical recipe-step normalization at migration time."""
    records: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    for row in _parse_step_rows(raw):
        duration = _coerce_nonnegative_int(row.get("duration_seconds"))
        supplied_source = row.get("duration_source")
        if duration is None:
            source = "fallback"
        elif supplied_source is None or supplied_source == "":
            source = "stated"
        else:
            source = _metadata(supplied_source, _DURATION_SOURCES, "fallback")

        step_id = _valid_id(row.get("id"))
        if step_id is None or step_id in seen_ids:
            step_id = _new_id(id_factory, seen_ids)
        seen_ids.add(step_id)
        records.append(
            {
                "id": step_id,
                "text": row["text"],
                "duration_seconds": _clamp_duration(duration, source)
                if duration is not None
                else None,
                "duration_source": source,
                "attention_type": _metadata(
                    row.get("attention_type"), _ATTENTION_TYPES, "hands_on"
                ),
                "action_type": _metadata(row.get("action_type"), _ACTION_TYPES, "other"),
                "image_url": _normalized_image_url(row.get("image_url")),
            }
        )

    missing_indexes = [
        index for index, record in enumerate(records) if record["duration_seconds"] is None
    ]
    known_durations = [
        int(record["duration_seconds"])
        for record in records
        if record["duration_seconds"] is not None
    ]
    if not missing_indexes:
        return records

    total_seconds = _coerce_nonnegative_int(total_time_minutes)
    remaining_seconds = total_seconds * 60 - sum(known_durations) if total_seconds is not None else 0
    if remaining_seconds > 0:
        base, remainder = divmod(remaining_seconds, len(missing_indexes))
        fallback_durations = [
            max(60, base + (1 if offset < remainder else 0))
            for offset in range(len(missing_indexes))
        ]
    elif known_durations:
        fallback_durations = [round(median(known_durations))] * len(missing_indexes)
    else:
        fallback_durations = [_DEFAULT_FALLBACK_SECONDS] * len(missing_indexes)

    for index, duration in zip(missing_indexes, fallback_durations, strict=True):
        records[index]["duration_seconds"] = _clamp_duration(duration, "fallback")
        records[index]["duration_source"] = "fallback"
    return records


def _upgrade_steps_json(
    raw_steps: object, total_time_minutes: object, id_factory: Callable[[], object] = uuid4
) -> str:
    """Upgrade one stored steps JSON value; corrupt or non-array values become ``[]``."""
    try:
        decoded = json.loads(raw_steps) if isinstance(raw_steps, str) else raw_steps
    except (TypeError, ValueError, json.JSONDecodeError):
        decoded = []
    if not isinstance(decoded, list):
        decoded = []
    return json.dumps(_normalize_step_payloads(decoded, total_time_minutes, id_factory))


def _downgrade_steps_json(raw_steps: object) -> object:
    """Remove only metadata introduced here, retaining resolved legacy step content."""
    if not isinstance(raw_steps, str):
        return raw_steps
    try:
        decoded = json.loads(raw_steps)
    except (TypeError, ValueError, json.JSONDecodeError):
        return raw_steps
    if not isinstance(decoded, list):
        return raw_steps
    downgraded = []
    for step in decoded:
        if not isinstance(step, dict):
            downgraded.append(step)
            continue
        legacy_step = dict(step)
        for key in ("id", "duration_source", "attention_type", "action_type"):
            legacy_step.pop(key, None)
        downgraded.append(legacy_step)
    return json.dumps(downgraded)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, steps, total_time_minutes FROM recipes")).mappings()
    for row in rows:
        bind.execute(
            sa.text("UPDATE recipes SET steps = :steps WHERE id = :id"),
            {
                "id": row["id"],
                "steps": _upgrade_steps_json(row["steps"], row["total_time_minutes"]),
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, steps FROM recipes")).mappings()
    for row in rows:
        bind.execute(
            sa.text("UPDATE recipes SET steps = :steps WHERE id = :id"),
            {"id": row["id"], "steps": _downgrade_steps_json(row["steps"])},
        )
