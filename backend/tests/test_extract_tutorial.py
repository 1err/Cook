from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import app.extract as extract_module
from app.extract import (
    _build_extraction_prompt,
    extract_recipe_from_text,
    parse_llm_recipe_response,
)
from app.models import Recipe
from app.tutorial import ACTION_TYPES


def make_recipe(parsed: dict) -> Recipe:
    return Recipe(
        id=str(uuid4()),
        title=parsed["title"],
        ingredients=[],
        total_time_minutes=parsed["total_time_minutes"],
        steps=parsed["steps"],
    )


def _completion(payload: object):
    content = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


def _client_with_responses(*payloads: object):
    create = AsyncMock(side_effect=[_completion(payload) for payload in payloads])
    return (
        SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create))
        ),
        create,
    )


def test_extraction_prompt_turns_fragmented_procedure_into_grounded_instructions():
    prompt = _build_extraction_prompt("小火煮到浓稠")

    assert "duration_source" in prompt
    assert '"hands_on" or "passive"' in prompt
    assert "simmer" in prompt
    assert "fragmented narration" in prompt
    assert "self-contained, actionable" in prompt
    assert "Do not introduce new ingredients" in prompt
    assert "DO NOT add, split, merge, or invent procedural steps" not in prompt
    assert "positive whole seconds" in prompt
    assert "stated" in prompt
    assert "estimated" in prompt
    assert all(action_type in prompt for action_type in ACTION_TYPES)


def test_parser_preserves_instruction_text_and_valid_step_metadata():
    parsed = parse_llm_recipe_response(
        json.dumps(
            {
                "title": "Mapo Tofu",
                "total_time_minutes": 12,
                "steps": [
                    {
                        "text": "Stir-fry the pork until browned.",
                        "duration_seconds": 120,
                        "duration_source": "stated",
                        "attention_type": "hands_on",
                        "action_type": "sear",
                    },
                    {
                        "text": "小火煮到浓稠。",
                        "duration_seconds": 300,
                        "duration_source": "estimated",
                        "attention_type": "passive",
                        "action_type": "simmer",
                    },
                ],
            }, ensure_ascii=False
        )
    )

    assert parsed["steps"] == [
        {
            "text": "Stir-fry the pork until browned.",
            "duration_seconds": 120,
            "duration_source": "stated",
            "attention_type": "hands_on",
            "action_type": "sear",
        },
        {
            "text": "小火煮到浓稠。",
            "duration_seconds": 300,
            "duration_source": "estimated",
            "attention_type": "passive",
            "action_type": "simmer",
        },
    ]


def test_parser_marks_missing_or_invalid_step_metadata_as_fallback():
    parsed = parse_llm_recipe_response(
        json.dumps(
            {
                "title": "Soup",
                "steps": [
                    {"text": "Simmer.", "duration_seconds": 60},
                    {
                        "text": "Stir.",
                        "duration_seconds": 60,
                        "duration_source": "guessed",
                        "attention_type": "continuous",
                        "action_type": "flip",
                    },
                ],
            }
        )
    )

    assert parsed["steps"] == [
        {
            "text": "Simmer.",
            "duration_seconds": 60,
            "duration_source": "fallback",
            "attention_type": "hands_on",
            "action_type": "other",
        },
        {
            "text": "Stir.",
            "duration_seconds": 60,
            "duration_source": "fallback",
            "attention_type": "hands_on",
            "action_type": "other",
        },
    ]


def test_parser_marks_string_step_metadata_as_fallback():
    parsed = parse_llm_recipe_response(
        json.dumps({"title": "Soup", "steps": ["Simmer."]})
    )

    assert parsed["steps"] == [
        {
            "text": "Simmer.",
            "duration_seconds": None,
            "duration_source": "fallback",
            "attention_type": "hands_on",
            "action_type": "other",
        }
    ]


def test_parser_recovers_common_instruction_aliases():
    parsed = parse_llm_recipe_response(
        json.dumps(
            {
                "title": "Alias soup",
                "instructions": [
                    {
                        "instruction": "Slice the mushrooms.",
                        "duration_seconds": 120,
                        "duration_source": "estimated",
                        "attention_type": "hands_on",
                        "action_type": "chop",
                    },
                    {"step": "Simmer until tender."},
                ],
            }
        )
    )

    assert [step["text"] for step in parsed["steps"]] == [
        "Slice the mushrooms.",
        "Simmer until tender.",
    ]
    assert parsed["steps"][0]["action_type"] == "chop"
    assert parsed["steps"][1]["duration_source"] == "fallback"


def test_parser_falls_through_unusable_steps_to_valid_instruction_alias():
    parsed = parse_llm_recipe_response(
        json.dumps(
            {
                "title": "Alias soup",
                "steps": [{"content": "Unsupported field"}],
                "instructions": ["Stir the soup until smooth."],
            }
        )
    )

    assert [step["text"] for step in parsed["steps"]] == [
        "Stir the soup until smooth."
    ]


@pytest.mark.parametrize(
    "placeholder",
    [
        "N/A",
        "No instructions available.",
        "No tutorial steps available.",
        "No usable instructions",
        "Steps not provided",
        "Not provided",
        "暂无步骤",
        "没有提供步骤",
        "未找到烹饪步骤",
        "无可用步骤",
    ],
)
def test_parser_rejects_non_instruction_placeholder_text(placeholder):
    parsed = parse_llm_recipe_response(
        json.dumps({"title": "Ingredient list", "method": placeholder})
    )

    assert parsed["steps"] == []


@pytest.mark.parametrize(
    "ingredient",
    [
        "N/A",
        {"name": "Not provided"},
        "暂无食材",
        {"name": "未提供"},
    ],
)
def test_parser_rejects_ingredient_placeholder_rows(ingredient):
    parsed = parse_llm_recipe_response(
        json.dumps({"title": "Unknown dish", "ingredients": [ingredient]})
    )

    assert parsed["ingredients"] == []


def test_parser_discards_non_list_ingredient_equipment_and_tip_containers():
    parsed = parse_llm_recipe_response(
        json.dumps(
            {
                "title": "Malformed containers",
                "ingredients": 7,
                "equipment": {"wok": True},
                "tips": "serve immediately",
            }
        )
    )

    assert parsed["ingredients"] == []
    assert parsed["equipment"] == []
    assert parsed["tips"] == []


def test_parser_discards_malformed_scalar_ingredient_rows():
    parsed = parse_llm_recipe_response(
        json.dumps(
            {
                "title": "Malformed ingredients",
                "ingredients": [None, 42, "Salt", "  ", {"name": None}],
            }
        )
    )

    assert parsed["ingredients"] == [
        {"name": "Salt", "quantity": "", "metric_quantity": None, "notes": None}
    ]


def test_parser_coerces_numeric_ingredient_quantity_to_safe_text():
    parsed = parse_llm_recipe_response(
        json.dumps(
            {
                "title": "Sauce",
                "ingredients": [
                    {"name": "Soy sauce", "quantity": 7, "notes": 3}
                ],
            }
        )
    )

    assert parsed["ingredients"] == [
        {"name": "Soy sauce", "quantity": "7", "metric_quantity": None, "notes": "3"}
    ]


def test_generated_duration_is_clamped_and_missing_total_is_derived_after_parsing():
    parsed = parse_llm_recipe_response(
        json.dumps(
            {
                "title": "Quick sauce",
                "total_time_minutes": None,
                "steps": [
                    {
                        "text": "Warm the sauce.",
                        "duration_seconds": 2,
                        "duration_source": "estimated",
                        "attention_type": "passive",
                        "action_type": "simmer",
                    }
                ],
            }
        )
    )

    recipe = make_recipe(parsed)

    assert recipe.steps[0].duration_seconds == 15
    assert recipe.steps[0].duration_source == "estimated"
    assert recipe.total_time_minutes == 1


def test_parser_keeps_an_explicit_total_and_empty_procedure():
    parsed = parse_llm_recipe_response(
        json.dumps({"title": "Ingredients only", "total_time_minutes": 42, "steps": []})
    )

    recipe = make_recipe(parsed)

    assert recipe.total_time_minutes == 42
    assert recipe.steps == []


def test_malformed_llm_json_returns_safe_empty_draft():
    assert parse_llm_recipe_response("not JSON") == {
        "title": "Imported Recipe",
        "description": None,
        "total_time_minutes": None,
        "ingredients": [],
        "equipment": [],
        "steps": [],
        "tips": [],
    }


def test_parser_accepts_a_single_instruction_string():
    parsed = parse_llm_recipe_response(
        json.dumps({"title": "Malformed steps", "steps": "just stir it"})
    )

    assert parsed["steps"] == [
        {
            "text": "just stir it",
            "duration_seconds": None,
            "duration_source": "fallback",
            "attention_type": "hands_on",
            "action_type": "other",
        }
    ]


@pytest.mark.asyncio
async def test_extract_recovers_steps_when_initial_recipe_only_has_ingredients(monkeypatch):
    client, create = _client_with_responses(
        {
            "title": "豆腐茄子煲",
            "description": "一道家常砂锅菜。",
            "total_time_minutes": 25,
            "ingredients": [
                {"name": "老豆腐", "quantity": "约400克", "notes": None},
                {"name": "紫皮茄子", "quantity": "1根", "notes": None},
            ],
            "equipment": [],
            "steps": [],
            "tips": [],
        },
        {
            "steps": [
                {
                    "text": "将豆腐切块，煎至两面金黄。",
                    "duration_seconds": 300,
                    "duration_source": "stated",
                    "attention_type": "hands_on",
                    "action_type": "sear",
                },
                {
                    "text": "放入茄子翻炒至软。",
                    "duration_seconds": 300,
                    "duration_source": "estimated",
                    "attention_type": "hands_on",
                    "action_type": "sear",
                },
            ]
        },
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text(
        "Video title: 豆腐茄子煲\nVideo description: 老豆腐约400克，紫皮茄子1根。"
    )

    assert recipe.title == "豆腐茄子煲"
    assert [ingredient.name for ingredient in recipe.ingredients] == ["老豆腐", "紫皮茄子"]
    assert [step.text for step in recipe.steps] == [
        "将豆腐切块，煎至两面金黄。",
        "放入茄子翻炒至软。",
    ]
    assert all(step.duration_source == "estimated" for step in recipe.steps)
    assert create.await_count == 2


@pytest.mark.asyncio
async def test_extract_does_not_recover_for_malformed_or_placeholder_ingredients(
    monkeypatch,
):
    client, create = _client_with_responses(
        {
            "title": "Malformed ingredients",
            "ingredients": [
                None,
                42,
                "  ",
                "N/A",
                {"name": None},
                {"name": "Not provided"},
            ],
            "steps": [],
        }
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("No usable recipe content.")

    assert recipe.ingredients == []
    assert recipe.steps == []
    assert create.await_count == 1


@pytest.mark.asyncio
async def test_extract_recovers_when_initial_step_rows_have_no_usable_text(monkeypatch):
    client, _create = _client_with_responses(
        {
            "title": "Mushroom soup",
            "description": None,
            "total_time_minutes": 20,
            "ingredients": [
                {"name": "Mushrooms", "quantity": "200 g", "notes": None}
            ],
            "equipment": [],
            "steps": [{"content": "This unsupported key is not an instruction."}],
            "tips": [],
        },
        {
            "steps": [
                {
                    "text": "Slice the mushrooms.",
                    "duration_seconds": 180,
                    "duration_source": "estimated",
                    "attention_type": "hands_on",
                    "action_type": "chop",
                }
            ]
        },
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("Mushroom soup with 200 g mushrooms.")

    assert [step.text for step in recipe.steps] == ["Slice the mushrooms."]


@pytest.mark.asyncio
async def test_extract_keeps_procedural_transcript_to_one_json_completion(monkeypatch):
    client, create = _client_with_responses(
        {
            "title": "Quick tofu",
            "description": None,
            "total_time_minutes": 8,
            "ingredients": [
                {"name": "Tofu", "quantity": "1 block", "notes": None}
            ],
            "equipment": ["wok"],
            "steps": [
                {
                    "text": "Dice the tofu.",
                    "duration_seconds": 120,
                    "duration_source": "estimated",
                    "attention_type": "hands_on",
                    "action_type": "chop",
                },
                {
                    "text": "Sear the tofu until golden.",
                    "duration_seconds": 360,
                    "duration_source": "estimated",
                    "attention_type": "hands_on",
                    "action_type": "sear",
                },
            ],
            "tips": [],
        }
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text(
        "Dice one block of tofu, then sear it until golden."
    )

    assert [step.text for step in recipe.steps] == [
        "Dice the tofu.",
        "Sear the tofu until golden.",
    ]
    assert create.await_count == 1
    assert create.await_args.kwargs.get("response_format") == {"type": "json_object"}


@pytest.mark.asyncio
async def test_extract_keeps_initial_draft_when_step_recovery_fails(monkeypatch):
    initial_payload = {
        "title": "Ingredient-only soup",
        "description": None,
        "total_time_minutes": None,
        "ingredients": [
            {"name": "Mushrooms", "quantity": "200 g", "notes": None}
        ],
        "equipment": [],
        "steps": [],
        "tips": [],
    }
    create = AsyncMock(
        side_effect=[
            _completion(initial_payload),
            RuntimeError("provider detail must not escape"),
        ]
    )
    client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("Mushrooms, 200 g")

    assert [ingredient.name for ingredient in recipe.ingredients] == ["Mushrooms"]
    assert recipe.steps == []
