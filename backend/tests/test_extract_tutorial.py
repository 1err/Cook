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


def test_parser_marks_missing_or_invalid_step_metadata_as_unknown():
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
            "duration_seconds": None,
            "duration_source": "unknown",
            "attention_type": "hands_on",
            "action_type": "other",
        },
        {
            "text": "Stir.",
            "duration_seconds": None,
            "duration_source": "unknown",
            "attention_type": "hands_on",
            "action_type": "other",
        },
    ]


def test_parser_marks_string_step_metadata_as_unknown():
    parsed = parse_llm_recipe_response(
        json.dumps({"title": "Soup", "steps": ["Simmer."]})
    )

    assert parsed["steps"] == [
        {
            "text": "Simmer.",
            "duration_seconds": None,
            "duration_source": "unknown",
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
    assert parsed["steps"][1]["duration_source"] == "unknown"


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
            "duration_source": "unknown",
            "attention_type": "hands_on",
            "action_type": "other",
        }
    ]


def _audit(*, steps, actions, warnings=None, **checks):
    return {
        "steps": steps,
        "actions": actions,
        "audit": {
            "complete": True,
            "order_valid": True,
            "method_available": bool(steps),
            "missing_action_ids": [],
            "unsupported_step_ids": [],
            "warnings": warnings or [],
            **checks,
        },
    }


def _action(action_id, text, start=None, end=None):
    return {
        "id": action_id,
        "text": text,
        "source_excerpt": text,
        "source_start_seconds": start,
        "source_end_seconds": end,
    }


def _step(text, *action_ids, **metadata):
    return {"text": text, "source_action_ids": list(action_ids), **metadata}


@pytest.mark.asyncio
async def test_nonempty_partial_tutorial_is_audited_and_missing_transfer_is_repaired(monkeypatch):
    source = ("[s1 0-4s] Dice the tofu.\n[s2 4-10s] Brown both sides.\n"
              "[s3 10-12s] Transfer it to the claypot.\n[s4 12-20s] Render the pork fat in the remaining oil.")
    actions = [
        _action("a1", "Dice the tofu.", 0, 4),
        _action("a2", "Brown both sides.", 4, 10),
        _action("a3", "Transfer it to the claypot.", 10, 12),
        _action("a4", "Render the pork fat in the remaining oil.", 12, 20),
    ]
    client, create = _client_with_responses(
        {"title": "Tofu claypot", "ingredients": [{"name": "Tofu", "quantity": "400 g"}],
         "actions": actions, "steps": [_step("Dice the tofu.", "a1")]},
        _audit(actions=actions, steps=[
            _step("Dice the tofu.", "a1"),
            _step("Brown both sides.", "a2"),
            _step("Transfer the tofu to the claypot.", "a3"),
            _step("Render pork fat in the remaining oil.", "a4"),
        ]),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text(source, source_kind="captions")

    assert [step.text for step in recipe.steps] == [
        "Dice the tofu.", "Brown both sides.", "Transfer the tofu to the claypot.",
        "Render pork fat in the remaining oil.",
    ]
    assert recipe.ingredients[0].quantity == "400 g"
    assert recipe.import_review.status == "ready"
    assert recipe.import_review.source_kind == "captions"
    assert recipe.steps[2].instruction_source == "source"
    assert recipe.steps[2].source_start_seconds == 10
    assert recipe.steps[2].source_excerpt == "Transfer it to the claypot."
    assert recipe.steps[2].duration_seconds is None
    assert recipe.steps[2].duration_source == "unknown"
    assert create.await_count == 2
    assert source in create.await_args.kwargs["messages"][0]["content"]


@pytest.mark.asyncio
async def test_ingredient_only_source_returns_unfinished_draft_without_invented_method(monkeypatch):
    client, create = _client_with_responses(
        {"title": "豆腐茄子煲", "ingredients": [{"name": "老豆腐", "quantity": "400克"}], "steps": []},
        _audit(actions=[], steps=[], method_available=False),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("豆腐茄子煲。老豆腐400克。", source_kind="description")

    assert recipe.ingredients[0].name == "老豆腐"
    assert recipe.steps == []
    assert recipe.import_review.status == "needs_review"
    assert recipe.import_review.warnings
    assert create.await_count == 2


@pytest.mark.asyncio
async def test_audit_failure_preserves_valid_initial_draft_and_requires_review(monkeypatch):
    action = _action("a1", "Slice the mushrooms.")
    create = AsyncMock(side_effect=[
        _completion({"title": "Soup", "ingredients": [{"name": "Mushrooms", "quantity": "200 g"}],
                     "actions": [action], "steps": [_step("Slice the mushrooms.", "a1")]}),
        RuntimeError("secret provider detail"),
    ])
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("Slice the mushrooms.")

    assert [step.text for step in recipe.steps] == ["Slice the mushrooms."]
    assert recipe.ingredients[0].quantity == "200 g"
    assert recipe.import_review.status == "needs_review"
    assert recipe.import_review.warnings
    assert "secret" not in " ".join(recipe.import_review.warnings)
    assert recipe.steps[0].duration_seconds is None


@pytest.mark.asyncio
@pytest.mark.parametrize("audit_response", ["not JSON", {"steps": []}, {"audit": {"complete": True}}])
async def test_malformed_audit_cannot_claim_ready_or_erase_initial_draft(monkeypatch, audit_response):
    client, _ = _client_with_responses(
        {"title": "Tofu", "ingredients": [{"name": "Tofu"}], "steps": ["Slice tofu."]},
        audit_response,
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("Slice tofu.")

    assert [step.text for step in recipe.steps] == ["Slice tofu."]
    assert recipe.import_review.status == "needs_review"


@pytest.mark.asyncio
@pytest.mark.parametrize("steps", [
    [_step("Brown tofu.", "a2")],
    [_step("Brown tofu.", "a2"), _step("Slice tofu.", "a1")],
])
async def test_deterministic_inventory_check_rejects_auditor_missing_actions_or_wrong_order(monkeypatch, steps):
    actions = [_action("a1", "Slice tofu."), _action("a2", "Brown tofu.")]
    client, _ = _client_with_responses(
        {"title": "Tofu", "actions": actions, "steps": [_step("Slice tofu.", "a1")]},
        _audit(actions=actions, steps=steps),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("Slice tofu. Brown tofu.")

    assert recipe.import_review.status == "needs_review"
    assert recipe.import_review.warnings


@pytest.mark.asyncio
async def test_audit_cannot_invent_source_evidence_for_ingredient_only_input(monkeypatch):
    client, _ = _client_with_responses(
        {"title": "Tofu", "ingredients": [{"name": "Tofu", "quantity": "400 g"}], "steps": []},
        _audit(actions=[_action("a1", "Deep fry tofu.")], steps=[_step("Deep fry tofu.", "a1")]),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("Tofu, 400 g")

    assert recipe.steps == []
    assert recipe.ingredients[0].quantity == "400 g"
    assert recipe.import_review.status == "needs_review"


@pytest.mark.asyncio
async def test_empty_first_pass_still_gets_one_bounded_audit(monkeypatch):
    client, create = _client_with_responses({"steps": [], "ingredients": ["N/A"]}, _audit(actions=[], steps=[]))
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("No recipe content")
    assert recipe.ingredients == []
    assert recipe.steps == []
    assert recipe.import_review.status == "needs_review"
    assert create.await_count == 2


@pytest.mark.asyncio
async def test_manual_tofu_reference_preserves_order_duration_relationship_and_unexplained_scallions(monkeypatch):
    # Manually corrected reference from Jerry, NOT a downloaded or verified video transcript.
    action_texts = [
        "准备豆腐、茄子、猪肉、辣椒、大蒜、蘑菇和葱白。",
        "热锅加油和盐，降低火力。",
        "将豆腐两面煎金黄，总共六分钟，每面三分钟。",
        "将豆腐转入砂锅。",
        "用锅内余油煸出猪肉的油脂。",
        "加入茄子，中小火炒五分钟。",
        "加入蚝油8克、生抽5克、老抽2克和水。",
        "加入切好的辣椒、大蒜和蘑菇。",
        "加入水淀粉。",
        "转入砂锅，最后撒上葱花。",
    ]
    actions = [_action(f"a{i}", text) for i, text in enumerate(action_texts, 1)]
    steps = [_step(text, f"a{i}") for i, text in enumerate(action_texts, 1)]
    steps[2].update(duration_seconds=360, duration_source="stated")
    steps[5].update(duration_seconds=300, duration_source="stated")
    client, _ = _client_with_responses(
        {"title": "豆腐茄子煲", "ingredients": [{"name": "老豆腐", "quantity": "约400克"},
                                             {"name": "紫皮茄子", "quantity": "1根"}],
         "actions": actions, "steps": [_step("准备豆腐。", "a1")]},
        _audit(actions=actions, steps=steps, warnings=["葱白的后续使用未在参考中明确，请核对来源。"]),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("\n".join(action_texts))

    assert [step.text for step in recipe.steps][3:7] == [
        "将豆腐转入砂锅。", "用锅内余油煸出猪肉的油脂。", "加入茄子，中小火炒五分钟。", "加入蚝油8克、生抽5克、老抽2克和水。",
    ]
    assert recipe.steps[2].duration_seconds == 360
    assert recipe.steps[5].duration_seconds == 300
    assert recipe.steps[3].duration_seconds is None
    assert recipe.ingredients[0].quantity == "约400克"
    assert recipe.import_review.status == "needs_review"
    assert "葱白" in " ".join(recipe.import_review.warnings)


@pytest.mark.asyncio
async def test_video_pipeline_uses_same_media_in_both_passes_and_keeps_timestamp_evidence(monkeypatch):
    action = _action("a1", "The cook transfers browned tofu into a claypot.", 42, 46)
    complete = AsyncMock(side_effect=[
        json.dumps({"title": "Tofu", "ingredients": [{"name": "Tofu"}], "actions": [action],
                    "steps": [_step("Transfer tofu to the claypot.", "a1")]}),
        json.dumps(_audit(actions=[action], steps=[_step("Transfer tofu to the claypot.", "a1")])),
    ])
    monkeypatch.setattr(extract_module, "complete_video", complete, raising=False)

    assert hasattr(extract_module, "extract_recipe_from_video"), "Video extraction entry point is required"
    recipe = await extract_module.extract_recipe_from_video(media_data=b"video-data", media_type="video/mp4", notes="Keep Chinese terms")

    assert recipe.steps[0].instruction_source == "source"
    assert recipe.steps[0].source_start_seconds == 42
    assert recipe.steps[0].duration_seconds is None
    assert recipe.import_review.status == "ready"
    assert recipe.import_review.source_kind == "media"
    assert complete.await_count == 2
    assert all(call.kwargs["media_data"] == b"video-data" for call in complete.await_args_list)
    assert all(call.kwargs["media_type"] == "video/mp4" for call in complete.await_args_list)
    extraction_schema = complete.await_args_list[0].kwargs.get("response_schema")
    audit_schema = complete.await_args_list[1].kwargs.get("response_schema")
    assert isinstance(extraction_schema, dict), "Video extraction must constrain its JSON response"
    assert {"title", "ingredients", "actions", "steps"} <= set(extraction_schema["required"])
    assert isinstance(audit_schema, dict), "Video audit must constrain its distinct response shape"
    assert set(audit_schema["required"]) == {"actions", "steps", "audit"}
    audit_fields = audit_schema["properties"]["audit"]
    assert set(audit_fields["required"]) == {
        "complete", "order_valid", "method_available", "missing_action_ids", "unsupported_step_ids", "warnings",
    }
    for key in ("complete", "order_valid", "method_available"):
        assert audit_fields["properties"][key]["type"] == "boolean"
    for key in ("missing_action_ids", "unsupported_step_ids", "warnings"):
        assert audit_fields["properties"][key]["type"] == "array"
    for schema in (extraction_schema, audit_schema):
        assert {"id", "text", "source_action_ids", "duration_seconds", "duration_source"} <= set(
            schema["properties"]["steps"]["items"]["required"]
        )
        assert {"id", "text", "source_excerpt", "source_start_seconds", "source_end_seconds", "role"} <= set(
            schema["properties"]["actions"]["items"]["required"]
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("malformed_shape", ["flattened", "string_boolean", "missing_arrays"])
async def test_video_response_schema_does_not_replace_fail_safe_audit_validation(monkeypatch, malformed_shape):
    action = _action("a1", "Transfer tofu to the claypot.", 42, 46)
    steps = [_step("Transfer tofu to the claypot.", "a1")]
    audit = _audit(actions=[action], steps=steps)
    if malformed_shape == "flattened":
        audit.update(audit.pop("audit"))
    elif malformed_shape == "string_boolean":
        audit["audit"]["complete"] = "true"
    else:
        del audit["audit"]["missing_action_ids"]
    complete = AsyncMock(side_effect=[
        json.dumps({"title": "Tofu", "ingredients": [{"name": "Tofu"}], "actions": [action], "steps": steps}),
        json.dumps(audit),
    ])
    monkeypatch.setattr(extract_module, "complete_video", complete)
    recipe = await extract_module.extract_recipe_from_video(media_data=b"video-data", media_type="video/mp4")
    assert [step.text for step in recipe.steps] == ["Transfer tofu to the claypot."]
    assert recipe.import_review.status == "needs_review"
    assert any("completeness check could not finish" in warning for warning in recipe.import_review.warnings)
    assert complete.await_count == 2


@pytest.mark.asyncio
async def test_contradictory_empty_audit_preserves_initial_method(monkeypatch):
    actions = [_action("a1", "Slice tofu.")]
    client, _ = _client_with_responses(
        {"title": "Tofu", "actions": actions, "steps": [_step("Slice tofu.", "a1")]},
        _audit(actions=actions, steps=[], method_available=True),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("Slice tofu.")

    assert [step.text for step in recipe.steps] == ["Slice tofu."]
    assert recipe.import_review.status == "needs_review"


@pytest.mark.asyncio
async def test_audit_flagged_unsupported_step_is_not_returned_as_source_instruction(monkeypatch):
    actions = [_action("a1", "Brown tofu.")]
    client, _ = _client_with_responses(
        {"title": "Tofu", "actions": actions, "steps": [_step("Brown tofu.", "a1")]},
        _audit(actions=actions, steps=[
            _step("Brown tofu.", "a1", id="s1"),
            _step("Deep fry at 220 degrees.", "a1", id="s2"),
        ], unsupported_step_ids=["s2"]),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("Brown tofu.")

    assert [step.text for step in recipe.steps] == ["Brown tofu."]
    assert recipe.import_review.status == "needs_review"


@pytest.mark.asyncio
async def test_reordered_action_inventory_cannot_hide_wrong_tutorial_order(monkeypatch):
    first = _action("a1", "Slice tofu.")
    second = _action("a2", "Brown tofu.")
    client, _ = _client_with_responses(
        {"title": "Tofu", "actions": [first, second], "steps": [_step("Slice tofu.", "a1")]},
        _audit(actions=[second, first], steps=[_step("Brown tofu.", "a2"), _step("Slice tofu.", "a1")]),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    recipe = await extract_recipe_from_text("Slice tofu. Brown tofu.")

    assert recipe.import_review.status == "needs_review"


@pytest.mark.parametrize("duration", [None, "60", True, {}, -20, 0])
def test_unusable_generated_duration_never_becomes_a_default_timer(duration):
    parsed = parse_llm_recipe_response(json.dumps({
        "title": "Tofu", "steps": [{"text": "Transfer tofu.", "duration_seconds": duration,
                                      "duration_source": "stated"}],
    }))
    recipe = make_recipe(parsed)
    assert recipe.steps[0].duration_seconds is None
    assert recipe.steps[0].duration_source == "unknown"


def test_malformed_provenance_does_not_discard_valid_step_text():
    parsed = parse_llm_recipe_response(json.dumps({
        "title": "Tofu", "steps": [{"text": "Slice tofu.", "instruction_source": ["source"],
                                      "source_excerpt": {"text": "Slice tofu."}}],
    }))
    assert parsed["steps"][0]["text"] == "Slice tofu."
    assert "instruction_source" not in parsed["steps"][0]
    assert "source_excerpt" not in parsed["steps"][0]


@pytest.mark.asyncio
async def test_explicit_timing_estimation_can_fill_unknown_duration_without_changing_instruction(monkeypatch):
    recipe = Recipe(id=str(uuid4()), title="Tofu", ingredients=[], steps=[{
        "id": "00000000-0000-0000-0000-000000000001", "text": "Transfer tofu to the claypot.", "duration_seconds": None,
        "duration_source": "unknown", "instruction_source": "source", "source_excerpt": "Transfer tofu.",
    }])
    client, _ = _client_with_responses([{"id": "00000000-0000-0000-0000-000000000001", "duration_seconds": 30,
                                         "attention_type": "hands_on", "action_type": "assemble"}])
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    steps = await extract_module.estimate_tutorial_step_metadata(recipe.steps)

    assert steps[0].duration_seconds == 30
    assert steps[0].duration_source == "estimated"
    assert steps[0].text == "Transfer tofu to the claypot."
    assert steps[0].source_excerpt == "Transfer tofu."
    assert recipe.steps[0].duration_seconds is None


@pytest.mark.asyncio
async def test_audit_local_deadline_returns_valid_draft_before_outer_operation_expires():
    import asyncio
    import time
    from app.core.ai_context import AIRequestContext, current_ai_request

    deadline = time.monotonic() + 7.04
    token = current_ai_request.set(AIRequestContext("owner", uuid4(), deadline))
    audit_cancelled = asyncio.Event()
    count = 0
    async def request(prompt):
        nonlocal count
        count += 1
        if count == 1:
            return json.dumps({"title": "Tofu", "ingredients": [{"name": "Tofu", "quantity": "400 g"}],
                               "actions": [_action("a1", "Slice tofu.")], "steps": [_step("Slice tofu.", "a1")]})
        try:
            await asyncio.sleep(10)
        finally:
            audit_cancelled.set()
    try:
        async with asyncio.timeout_at(deadline):
            result = await extract_module._extract_with_audit("Slice tofu.", kind="text", request=request, audiovisual=False)
    finally:
        current_ai_request.reset(token)

    assert result.title == "Tofu"
    assert result.ingredients[0].quantity == "400 g"
    assert [step.text for step in result.steps] == ["Slice tofu."]
    assert result.import_review.status == "needs_review"
    assert audit_cancelled.is_set()
    assert count == 2


@pytest.mark.asyncio
async def test_exhausted_audit_time_budget_keeps_first_pass_without_new_provider_call():
    import time
    from app.core.ai_context import AIRequestContext, current_ai_request

    token = current_ai_request.set(AIRequestContext("owner", uuid4(), time.monotonic() + .5))
    request = AsyncMock(return_value=json.dumps({"title": "Tofu", "ingredients": [{"name": "Tofu", "quantity": "400 g"}],
                        "actions": [_action("a1", "Slice tofu.")], "steps": [_step("Slice tofu.", "a1")]}))
    try:
        result = await extract_module._extract_with_audit("Slice tofu.", kind="text", request=request, audiovisual=False)
    finally:
        current_ai_request.reset(token)

    assert result.import_review.status == "needs_review"
    assert result.ingredients[0].quantity == "400 g"
    assert request.await_count == 1


@pytest.mark.asyncio
async def test_user_cancellation_during_audit_still_cancels_import():
    import asyncio
    import time
    from app.core.ai_context import AIRequestContext, current_ai_request

    token = current_ai_request.set(AIRequestContext("owner", uuid4(), time.monotonic() + 10))
    audit_started = asyncio.Event()
    count = 0
    async def request(prompt):
        nonlocal count
        count += 1
        if count == 1:
            return json.dumps({"title": "Tofu", "ingredients": [], "steps": ["Slice tofu."]})
        audit_started.set()
        await asyncio.sleep(10)
    try:
        task = asyncio.create_task(extract_module._extract_with_audit("Slice tofu.", kind="text", request=request, audiovisual=False))
        await audit_started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        current_ai_request.reset(token)


@pytest.mark.asyncio
async def test_audit_deadline_allows_slow_provider_cancellation_reconciliation():
    import asyncio
    import time
    from app.core.ai_context import AIRequestContext, current_ai_request

    deadline = time.monotonic() + 7.04
    token = current_ai_request.set(AIRequestContext("owner", uuid4(), deadline))
    cleanup_completed = asyncio.Event()
    count = 0
    async def request(prompt):
        nonlocal count
        count += 1
        if count == 1:
            return json.dumps({"title": "Tofu", "ingredients": [{"name": "Tofu", "quantity": "400 g"}],
                               "actions": [_action("a1", "Slice tofu.")], "steps": [_step("Slice tofu.", "a1")]})
        try:
            await asyncio.sleep(20)
        finally:
            # Ledger reconciliation may use its full5s cancellation-cleanup budget.
            await asyncio.sleep(5.0)
            cleanup_completed.set()
    try:
        async with asyncio.timeout_at(deadline):
            result = await extract_module._extract_with_audit("Slice tofu.", kind="text", request=request, audiovisual=False)
    finally:
        current_ai_request.reset(token)

    assert result.ingredients[0].quantity == "400 g"
    assert result.import_review.status == "needs_review"
    assert cleanup_completed.is_set()
    assert count == 2


@pytest.mark.asyncio
async def test_ingredient_name_quote_cannot_ground_an_invented_cooking_method(monkeypatch):
    invented = {"id": "a1", "text": "Deep-fry tofu at 220 C.", "source_excerpt": "tofu", "role": "main"}
    steps = [_step("Deep-fry tofu at 220 C.", "a1")]
    client, _ = _client_with_responses(
        {"title": "Tofu", "ingredients": [{"name": "tofu", "quantity": ""}], "actions": [invented], "steps": steps},
        _audit(actions=[invented], steps=steps),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("Ingredients: tofu, eggplant.", source_kind="description")
    assert recipe.import_review.status == "needs_review"
    assert recipe.steps == []
    assert recipe.ingredients[0].name == "tofu"


@pytest.mark.asyncio
@pytest.mark.parametrize("changed_action", [
    {"id": "a2", "text": "Transfer tofu to claypot.", "source_excerpt": "Transfer tofu to claypot.", "role": "recap"},
    {"id": "a2", "text": "Transfer tofu to claypot.", "source_excerpt": "Transfer tofu to claypot.", "role": "alternative"},
    {"id": "a2", "text": "Simmer.", "source_excerpt": "Simmer.", "role": "main"},
])
async def test_audit_cannot_hide_required_transfer_by_reclassifying_or_replacing_its_evidence(monkeypatch, changed_action):
    actions = [_action("a1", "Slice tofu."), _action("a2", "Transfer tofu to claypot."), _action("a3", "Simmer.")]
    client, _ = _client_with_responses(
        {"title": "Tofu", "actions": actions, "steps": [_step("Slice tofu.", "a1")]},
        _audit(actions=[actions[0], changed_action, actions[2]],
               steps=[_step("Slice tofu.", "a1"), _step("Simmer.", *(["a2", "a3"] if changed_action["role"] == "main" else ["a3"]))]),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("Slice tofu. Transfer tofu to claypot. Simmer.")
    assert recipe.import_review.status == "needs_review"
    assert recipe.import_review.warnings


@pytest.mark.asyncio
async def test_caption_evidence_uses_actual_segment_time_instead_of_model_invented_time(monkeypatch):
    action = _action("a1", "Transfer tofu to claypot.", 80000, 80005)
    client, _ = _client_with_responses(
        {"title": "Tofu", "actions": [action], "steps": [_step("Transfer tofu to claypot.", "a1")]},
        _audit(actions=[action], steps=[_step("Transfer tofu to claypot.", "a1")]),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("[s1 10-12s] Transfer tofu to claypot.", source_kind="captions")
    assert recipe.steps[0].source_start_seconds == 10
    assert recipe.steps[0].source_end_seconds == 12
    assert recipe.import_review.status == "needs_review"


@pytest.mark.asyncio
async def test_plain_source_text_cannot_receive_invented_video_timestamps(monkeypatch):
    action = _action("a1", "Slice tofu.", 10, 12)
    client, _ = _client_with_responses(
        {"title": "Tofu", "actions": [action], "steps": [_step("Slice tofu.", "a1")]},
        _audit(actions=[action], steps=[_step("Slice tofu.", "a1")]),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("Slice tofu.")
    assert recipe.steps[0].source_start_seconds is None
    assert recipe.steps[0].source_end_seconds is None
    assert recipe.import_review.status == "needs_review"


@pytest.mark.asyncio
async def test_translated_instruction_can_cite_real_source_language_action(monkeypatch):
    action = {"id": "a1", "text": "Slice tofu.", "source_excerpt": "把豆腐切片。"}
    steps = [_step("Slice the tofu.", "a1")]
    client, _ = _client_with_responses(
        {"title": "Tofu", "actions": [action], "steps": steps}, _audit(actions=[action], steps=steps),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("把豆腐切片。")
    assert recipe.steps[0].instruction_source == "source"
    assert recipe.steps[0].source_excerpt == "把豆腐切片。"
    assert recipe.import_review.status == "ready"


@pytest.mark.asyncio
@pytest.mark.parametrize("instruction", ["Fry chicken at 220 C.", "Fry 400 g tofu.", "Fry tofu for 20 minutes."])
async def test_unstated_numbers_do_not_become_source_supported_instructions(monkeypatch, instruction):
    action = {"id": "a1", "text": instruction, "source_excerpt": "Fry tofu in a pan."}
    steps = [_step(instruction, "a1")]
    client, _ = _client_with_responses(
        {"title": "Tofu", "ingredients": [{"name": "tofu", "quantity": ""}], "actions": [action], "steps": steps},
        _audit(actions=[action], steps=steps),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("Fry tofu in a pan.")
    assert recipe.import_review.status == "needs_review"
    assert all(step.instruction_source != "source" for step in recipe.steps)


@pytest.mark.asyncio
async def test_known_ingredient_cannot_be_substituted_for_the_one_in_the_cited_action(monkeypatch):
    actions = [_action("a1", "Fry tofu in a pan.")]
    steps = [_step("Fry chicken in a pan.", "a1")]
    client, _ = _client_with_responses(
        {"title": "Dinner", "ingredients": [{"name": "tofu", "quantity": ""}, {"name": "chicken", "quantity": ""}],
         "actions": actions, "steps": steps}, _audit(actions=actions, steps=steps),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("Ingredients: tofu, chicken.\nFry tofu in a pan.")
    assert recipe.import_review.status == "needs_review"
    assert recipe.steps[0].instruction_source != "source"


@pytest.mark.asyncio
async def test_ingredient_heading_does_not_turn_brown_rice_into_a_frying_instruction(monkeypatch):
    action = {"id": "a1", "text": "Brown rice until fragrant.", "source_excerpt": "brown rice", "role": "main"}
    steps = [_step("Brown rice until fragrant.", "a1")]
    client, _ = _client_with_responses(
        {"title": "Rice", "ingredients": [{"name": "rice", "quantity": ""}, {"name": "black beans", "quantity": ""}],
         "actions": [action], "steps": steps}, _audit(actions=[action], steps=steps),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("Ingredients: brown rice, black beans.", source_kind="description")
    assert recipe.import_review.status == "needs_review"
    assert recipe.steps == []


@pytest.mark.asyncio
async def test_unstated_cooking_time_cannot_be_labeled_source_stated(monkeypatch):
    actions = [_action("a1", "Fry tofu in a pan.")]
    steps = [_step("Fry tofu in a pan.", "a1", duration_seconds=300, duration_source="stated")]
    client, _ = _client_with_responses({"title": "Tofu", "actions": actions, "steps": steps}, _audit(actions=actions, steps=steps))
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("Fry tofu in a pan.")
    assert recipe.import_review.status == "needs_review"
    assert recipe.steps[0].duration_source == "unknown"
    assert recipe.steps[0].duration_seconds is None


@pytest.mark.asyncio
@pytest.mark.parametrize("instruction, excerpt, metadata", [
    ("Fry tofu for 6 minutes.", "将豆腐煎六分钟。", {"duration_seconds": 360, "duration_source": "stated"}),
    ("Fry 0.4 kg tofu.", "煎400克豆腐。", {}),
    ("Fry 400 g tofu.", "煎0.4千克豆腐。", {}),
])
async def test_bilingual_ingredients_and_explicit_quantities_remain_supported(monkeypatch, instruction, excerpt, metadata):
    action = {"id": "a1", "text": instruction, "source_excerpt": excerpt}
    steps = [_step(instruction, "a1", **metadata)]
    client, _ = _client_with_responses(
        {"title": "Tofu", "ingredients": [{"name": "Tofu (豆腐)", "quantity": ""}], "actions": [action], "steps": steps},
        _audit(actions=[action], steps=steps),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text(excerpt)
    assert recipe.import_review.status == "ready"
    assert recipe.steps[0].instruction_source == "source"


@pytest.mark.asyncio
async def test_prepared_garlic_and_scallion_bulbs_need_explained_use_even_when_audit_claims_complete(monkeypatch):
    texts = ["将大蒜拍散剁碎，小葱头切成颗粒备用。", "加入茄子炒熟。", "撒上葱花。"]
    actions = [_action(f"a{index}", text) for index, text in enumerate(texts)]
    steps = [_step(text, action["id"]) for text, action in zip(texts, actions)]
    ingredients = [{"name": name} for name in ("大蒜", "小葱头", "茄子", "葱花")]
    client, _ = _client_with_responses(
        {"title": "茄子", "ingredients": ingredients, "actions": actions, "steps": steps},
        _audit(actions=actions, steps=steps),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("\n".join(texts))
    assert [step.text for step in recipe.steps] == texts
    assert recipe.import_review.status == "needs_review"
    assert recipe.import_review.warnings == [
        "大蒜 is prepared but no later use is explained; check the source.",
        "小葱头 is prepared but no later use is explained; check the source.",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("ingredient, texts", [
    ("garlic", ["Chop the garlic.", "Add garlic to the pan."]),
    ("大蒜", ["将大蒜剁碎。", "加入大蒜炒香。"]),
    ("Garlic (大蒜)", ["将大蒜剁碎。", "Add garlic to the pan."]),
    ("garlic", ["Chop the cloves.", "Fry the aromatics."]),
    ("garlic", ["Chop the garlic."]),
    ("老豆腐", ["将老豆腐切片。", "煎豆腐。"]),
    ("紫皮茄子", ["将紫皮茄子切块。", "加入茄子炒熟。"]),
    ("五花肉", ["将五花肉切粒。", "将肥肉粒炒出猪油。"]),
])
async def test_prepared_ingredient_warning_requires_exact_preparation_without_recognized_use(monkeypatch, ingredient, texts):
    actions = [_action(f"a{index}", text) for index, text in enumerate(texts)]
    steps = [_step(text, action["id"]) for text, action in zip(texts, actions)]
    client, _ = _client_with_responses(
        {"title": "Dinner", "ingredients": [{"name": ingredient}], "actions": actions, "steps": steps},
        _audit(actions=actions, steps=steps),
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)
    recipe = await extract_recipe_from_text("\n".join(texts))
    assert [step.text for step in recipe.steps] == texts
    assert recipe.import_review.status == "ready"
    assert recipe.import_review.warnings == []
