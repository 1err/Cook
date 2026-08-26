from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app import extract
from app.models import RecipeStep


class _FakeCompletions:
    def __init__(self, content: str) -> None:
        self.content = content
        self.messages: list[dict[str, object]] | None = None

    async def create(self, **kwargs: object) -> SimpleNamespace:
        self.messages = kwargs["messages"]  # type: ignore[assignment]
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))]
        )


def _client(content: str) -> SimpleNamespace:
    return SimpleNamespace(
        chat=SimpleNamespace(completions=_FakeCompletions(content))
    )


@pytest.mark.asyncio
async def test_estimator_merges_metadata_by_unique_known_id_without_changing_steps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    steps = [
        RecipeStep(
            id="00000000-0000-0000-0000-000000000001",
            text="Chop the onions.",
            duration_seconds=45,
            duration_source="user",
            attention_type="hands_on",
            action_type="chop",
            image_url="https://images.example/onions.jpg",
        ),
        RecipeStep(
            id="00000000-0000-0000-0000-000000000002",
            text="Simmer the sauce.",
            duration_seconds=300,
            duration_source="fallback",
            attention_type="hands_on",
            action_type="other",
            image_url="https://images.example/sauce.jpg",
        ),
        RecipeStep(
            id="00000000-0000-0000-0000-000000000003",
            text="Bake until golden.",
            duration_seconds=900,
            duration_source="stated",
            attention_type="passive",
            action_type="bake",
        ),
        RecipeStep(
            id="00000000-0000-0000-0000-000000000004",
            text="Let it rest.",
            duration_seconds=180,
            duration_source="estimated",
            attention_type="passive",
            action_type="rest",
        ),
    ]
    response = json.dumps(
        [
            {
                "id": steps[0].id,
                "duration_seconds": 99,
                "attention_type": "passive",
                "action_type": "rest",
                "text": "Replace the user's instruction",
            },
            {
                "id": steps[1].id,
                "duration_seconds": 420,
                "attention_type": "passive",
                "action_type": "simmer",
            },
            {
                "id": steps[2].id,
                "duration_seconds": 1200,
                "attention_type": "hands_on",
                "action_type": "sear",
            },
            {
                "id": steps[3].id,
                "duration_seconds": 240,
                "attention_type": "hands_on",
                "action_type": "mix",
            },
            {
                "id": "00000000-0000-0000-0000-000000000099",
                "duration_seconds": 60,
                "attention_type": "hands_on",
                "action_type": "prep",
            },
            {
                "id": steps[1].id,
                "duration_seconds": 30,
                "attention_type": "hands_on",
                "action_type": "boil",
            },
        ]
    )
    fake_client = _client(response)
    monkeypatch.setattr(extract, "get_openai_client", lambda: fake_client)

    result = await extract.estimate_tutorial_step_metadata(steps)

    assert [(step.id, step.text, step.image_url) for step in result] == [
        (step.id, step.text, step.image_url) for step in steps
    ]
    assert len(result) == len(steps)
    assert (result[0].duration_seconds, result[0].duration_source) == (45, "user")
    assert (result[1].duration_seconds, result[1].duration_source) == (300, "fallback")
    assert (result[2].duration_seconds, result[2].duration_source) == (900, "stated")
    assert (result[3].duration_seconds, result[3].duration_source) == (180, "estimated")
    assert (result[0].attention_type, result[0].action_type) == ("passive", "rest")
    assert steps[0].attention_type == "hands_on"


@pytest.mark.asyncio
async def test_estimator_upgrades_only_a_fallback_duration_from_valid_model_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    steps = [
        RecipeStep(
            id="00000000-0000-0000-0000-000000000011",
            text="Simmer gently.",
            duration_seconds=300,
            duration_source="fallback",
        ),
        RecipeStep(
            id="00000000-0000-0000-0000-000000000012",
            text="Boil the noodles.",
            duration_seconds=240,
            duration_source="fallback",
        ),
    ]
    monkeypatch.setattr(
        extract,
        "get_openai_client",
        lambda: _client(
            json.dumps(
                [
                    {
                        "id": steps[0].id,
                        "duration_seconds": 420,
                        "attention_type": "passive",
                        "action_type": "simmer",
                    },
                    {
                        "id": steps[1].id,
                        "duration_seconds": 0,
                        "attention_type": "passive",
                        "action_type": "boil",
                    },
                ]
            )
        ),
    )

    result = await extract.estimate_tutorial_step_metadata(steps)

    assert (result[0].duration_seconds, result[0].duration_source) == (420, "estimated")
    assert (result[1].duration_seconds, result[1].duration_source) == (240, "fallback")


@pytest.mark.asyncio
async def test_estimator_accepts_a_steps_envelope_from_the_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    step = RecipeStep(
        id="00000000-0000-0000-0000-000000000013",
        text="Bake the casserole.",
        duration_seconds=300,
        duration_source="fallback",
    )
    monkeypatch.setattr(
        extract,
        "get_openai_client",
        lambda: _client(
            json.dumps(
                {
                    "steps": [
                        {
                            "id": step.id,
                            "duration_seconds": 1800,
                            "attention_type": "passive",
                            "action_type": "bake",
                        }
                    ]
                }
            )
        ),
    )

    result = await extract.estimate_tutorial_step_metadata([step])

    assert (result[0].duration_seconds, result[0].duration_source) == (
        1800,
        "estimated",
    )


@pytest.mark.asyncio
async def test_estimator_without_a_client_keeps_fallback_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    step = RecipeStep(
        id="00000000-0000-0000-0000-000000000014",
        text="Boil the stock.",
        duration_seconds=300,
        duration_source="fallback",
        attention_type="hands_on",
        action_type="other",
    )
    monkeypatch.setattr(extract, "get_openai_client", lambda: None)

    result = await extract.estimate_tutorial_step_metadata([step])

    assert (result[0].attention_type, result[0].action_type) == (
        "passive",
        "boil",
    )
    assert (result[0].duration_seconds, result[0].duration_source) == (
        300,
        "fallback",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("model_output", ["not json", '{"steps": "wrong shape"}'])
async def test_estimator_uses_deterministic_metadata_for_malformed_model_output(
    monkeypatch: pytest.MonkeyPatch,
    model_output: str,
) -> None:
    steps = [
        RecipeStep(
            id="00000000-0000-0000-0000-000000000021",
            text="Bake until golden.",
            duration_seconds=300,
            duration_source="fallback",
            attention_type="hands_on",
            action_type="other",
        )
    ]
    monkeypatch.setattr(extract, "get_openai_client", lambda: _client(model_output))

    result = await extract.estimate_tutorial_step_metadata(steps)

    assert result[0].attention_type == "passive"
    assert result[0].action_type == "bake"
    assert result[0].duration_seconds == 300
    assert result[0].duration_source == "fallback"
