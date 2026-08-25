"""Regression tests for the immutable recipe-step metadata migration."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from uuid import UUID

import pytest

from app.tutorial import normalize_step_payloads


def _migration_module():
    path = Path(__file__).parents[1] / "alembic/versions/20260825_step_meta.py"
    spec = importlib.util.spec_from_file_location("step_meta_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _fixed_ids():
    values = iter(
        [
            UUID("10000000-0000-0000-0000-000000000001"),
            UUID("10000000-0000-0000-0000-000000000002"),
        ]
    )
    return lambda: next(values)


def test_upgrade_steps_json_backfills_metadata_and_is_idempotent() -> None:
    """Breaks if legacy rows are not upgraded into stable canonical steps."""
    migration = _migration_module()
    raw = json.dumps(
        [
            {"text": "Chop onion", "duration_seconds": 120},
            {"text": "Bake until golden", "image_url": "/uploads/bake.jpg"},
        ]
    )

    upgraded_json = migration._upgrade_steps_json(raw, 12, id_factory=_fixed_ids())
    upgraded = json.loads(upgraded_json)

    assert upgraded == [
        {
            "id": "10000000-0000-0000-0000-000000000001",
            "text": "Chop onion",
            "duration_seconds": 120,
            "duration_source": "stated",
            "attention_type": "hands_on",
            "action_type": "other",
            "image_url": None,
        },
        {
            "id": "10000000-0000-0000-0000-000000000002",
            "text": "Bake until golden",
            "duration_seconds": 600,
            "duration_source": "fallback",
            "attention_type": "hands_on",
            "action_type": "other",
            "image_url": "/uploads/bake.jpg",
        },
    ]
    assert json.loads(migration._upgrade_steps_json(upgraded_json, 12)) == upgraded


@pytest.mark.parametrize("raw", ["{not json", json.dumps({"text": "Not an array"})])
def test_upgrade_steps_json_turns_malformed_or_non_array_json_into_empty_array(raw: str) -> None:
    """Breaks if one bad steps JSON value aborts the migration deployment."""
    migration = _migration_module()

    assert migration._upgrade_steps_json(raw, 10) == "[]"


def test_downgrade_removes_only_the_added_metadata_keys() -> None:
    """Breaks if downgrade discards resolved duration, text, or an image URL."""
    migration = _migration_module()
    canonical = {
        "id": "10000000-0000-0000-0000-000000000001",
        "text": "Bake until golden",
        "duration_seconds": 600,
        "duration_source": "fallback",
        "attention_type": "hands_on",
        "action_type": "bake",
        "image_url": "/uploads/bake.jpg",
    }

    downgraded = json.loads(migration._downgrade_steps_json(json.dumps([canonical])))

    assert downgraded == [
        {
            "text": "Bake until golden",
            "duration_seconds": 600,
            "image_url": "/uploads/bake.jpg",
        }
    ]


@pytest.mark.parametrize(
    ("raw", "total_time_minutes"),
    [
        (
            [
                {"text": "Chop onion", "duration_seconds": 120},
                {"text": "Bake until golden", "image_url": "/uploads/bake.jpg"},
            ],
            12,
        ),
        (
            [{"id": "not-a-uuid", "text": "Rest", "duration_seconds": 0}],
            None,
        ),
    ],
)
def test_migration_normalization_matches_the_canonical_step_contract(
    raw: list[dict[str, object]], total_time_minutes: int | None
) -> None:
    """Breaks if frozen migration semantics drift from the live canonical contract."""
    migration = _migration_module()
    migration_steps = json.loads(
        migration._upgrade_steps_json(json.dumps(raw), total_time_minutes, id_factory=_fixed_ids())
    )
    canonical_steps = normalize_step_payloads(raw, total_time_minutes, id_factory=_fixed_ids())

    assert migration_steps == canonical_steps
