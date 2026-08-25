from __future__ import annotations

import json
from uuid import uuid4

from app.extract import _build_extraction_prompt, _stub_extraction, parse_llm_recipe_response
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


def test_extraction_prompt_requests_timing_metadata_without_changing_procedure():
    prompt = _build_extraction_prompt("小火煮到浓稠")

    assert "duration_source" in prompt
    assert '"hands_on" or "passive"' in prompt
    assert "simmer" in prompt
    assert "DO NOT invent" in prompt
    assert "DO NOT add, split, merge, or invent procedural steps" in prompt
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


def test_parser_discards_a_non_list_procedure_shape():
    parsed = parse_llm_recipe_response(
        json.dumps({"title": "Malformed steps", "steps": "just stir it"})
    )

    assert parsed["steps"] == []


def test_mapo_stub_has_canonical_timing_metadata_and_thin_input_has_no_steps():
    mapo = _stub_extraction("I made mapo tofu")
    thin = _stub_extraction("hello")

    assert mapo["steps"][0]["duration_source"] == "estimated"
    assert mapo["steps"][0]["attention_type"] == "hands_on"
    assert mapo["steps"][0]["action_type"] == "chop"
    assert mapo["steps"][3] == {
        "text": "Drain the tofu, slide it into the wok, and simmer gently with stock.",
        "duration_seconds": 180,
        "duration_source": "estimated",
        "attention_type": "passive",
        "action_type": "simmer",
    }
    assert thin["steps"] == []
