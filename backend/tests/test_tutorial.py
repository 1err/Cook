from __future__ import annotations

from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
from pydantic import TypeAdapter

from app.api._types import StepList
from app.models import Recipe
from app.tutorial import normalize_step_payloads, parse_step_rows


def make_recipe(**overrides: object) -> Recipe:
    payload: dict[str, object] = {
        "id": str(uuid4()),
        "title": "Test recipe",
        "ingredients": [],
    }
    payload.update(overrides)
    return Recipe(**payload)


def uuid_factory() -> Iterator[str]:
    while True:
        yield str(uuid4())


def test_recipe_step_contract_and_legacy_known_duration():
    recipe = make_recipe(steps=[{"text": "Stir", "duration_seconds": 5}])
    step = recipe.steps[0]

    assert UUID(step.id)
    assert step.duration_seconds == 15
    assert step.duration_source == "stated"
    assert step.attention_type == "hands_on"
    assert step.action_type == "other"


def test_user_duration_accepts_one_second():
    step = make_recipe(
        steps=[
            {
                "text": "Taste",
                "duration_seconds": 1,
                "duration_source": "user",
                "attention_type": "hands_on",
                "action_type": "season",
            }
        ]
    ).steps[0]

    assert step.duration_seconds == 1


def test_recipe_derives_missing_total_time_from_normalized_steps():
    recipe = make_recipe(steps=[{"text": "Stir", "duration_seconds": 5}])

    assert recipe.total_time_minutes == 1


def test_recipe_preserves_explicit_total_time():
    recipe = make_recipe(total_time_minutes=42, steps=[{"text": "Stir", "duration_seconds": 5}])

    assert recipe.total_time_minutes == 42


def test_invalid_metadata_uses_safe_contract_defaults():
    step = make_recipe(
        steps=[
            {
                "text": "Stir",
                "duration_seconds": 60,
                "duration_source": "machine_guess",
                "attention_type": "continuous",
                "action_type": "flip",
            }
        ]
    ).steps[0]

    assert step.duration_source == "fallback"
    assert step.attention_type == "hands_on"
    assert step.action_type == "other"


def test_duration_clamps_to_one_day():
    step = make_recipe(
        steps=[
            {
                "text": "Wait",
                "duration_seconds": 100_000,
                "duration_source": "estimated",
            }
        ]
    ).steps[0]

    assert step.duration_seconds == 86_400


def test_empty_text_rows_disappear():
    recipe = make_recipe(steps=["  ", {"text": None}, {"text": "  Keep this  "}, 4])

    assert [step.text for step in recipe.steps] == ["Keep this"]


def test_valid_step_ids_survive_reordering():
    first, second = str(uuid4()), str(uuid4())
    ids = uuid_factory()

    steps = normalize_step_payloads(
        [
            {"id": second, "text": "Second"},
            {"id": first, "text": "First"},
        ],
        total_time_minutes=None,
        id_factory=lambda: next(ids),
    )

    assert [step["id"] for step in steps] == [second, first]


def test_duplicate_and_missing_step_ids_are_regenerated_uniquely():
    existing = str(uuid4())
    generated = iter([str(uuid4()), str(uuid4())])

    steps = normalize_step_payloads(
        [
            {"id": existing, "text": "First"},
            {"id": existing, "text": "Second"},
            {"text": "Third"},
        ],
        total_time_minutes=None,
        id_factory=lambda: next(generated),
    )

    assert [step["id"] for step in steps[:1]] == [existing]
    assert len({step["id"] for step in steps}) == 3
    assert all(UUID(str(step["id"])) for step in steps)


@pytest.mark.parametrize(
    ("durations", "total_time_minutes", "expected"),
    [
        ([240, None, None], 10, [240, 180, 180]),
        ([120, 300, None], None, [120, 300, 210]),
        ([None], None, [300]),
    ],
)
def test_missing_durations_use_recipe_context(
    durations: list[int | None], total_time_minutes: int | None, expected: list[int]
):
    ids = uuid_factory()
    steps = normalize_step_payloads(
        [{"text": f"Step {index}", "duration_seconds": duration} for index, duration in enumerate(durations)],
        total_time_minutes=total_time_minutes,
        id_factory=lambda: next(ids),
    )

    assert [step["duration_seconds"] for step in steps] == expected


def test_parse_step_rows_trims_text_and_keeps_unknown_keys_until_normalization():
    rows = parse_step_rows(["  Mix  ", {"text": "  Serve ", "legacy_hint": "quickly"}, None])

    assert rows == [
        {"text": "Mix"},
        {"text": "Serve", "legacy_hint": "quickly"},
    ]


def test_step_list_parses_rows_without_cross_step_duration_fallback():
    steps = TypeAdapter(StepList).validate_python(["Stir", {"text": "Rest"}])

    assert [step.text for step in steps] == ["Stir", "Rest"]
    assert [step.duration_seconds for step in steps] == [None, None]
