"""New imports simplify Chinese display text without rewriting source evidence."""
from copy import deepcopy
import json
from unittest.mock import AsyncMock

import pytest

import app.extract as extract
from app.models import Recipe
from app.services.tutorial_quality import action_inventory, ground_steps


SOURCE = "[s1 1.5-3.5s] 攪拌雞蛋。\n[s2 4-6s] 燜煮兩分鐘。"


def chinese_payloads():
    actions = [
        {"id": "攪拌-a1", "text": "搅拌鸡蛋。", "source_excerpt": "攪拌雞蛋。",
         "source_start_seconds": 1.5, "source_end_seconds": 3.5, "role": "main"},
        {"id": "燜煮-a2", "text": "焖煮两分钟。", "source_excerpt": "燜煮兩分鐘。",
         "source_start_seconds": 4, "source_end_seconds": 6, "role": "main"},
    ]
    steps = [
        {"id": "00000000-0000-0000-0000-000000000001", "text": "攪拌雞蛋。", "source_action_ids": ["攪拌-a1"],
         "duration_seconds": 30, "duration_source": "estimated", "action_type": "mix"},
        {"id": "00000000-0000-0000-0000-000000000002", "text": "焖煮两分钟。", "source_action_ids": ["燜煮-a2"],
         "duration_seconds": 120, "duration_source": "stated", "action_type": "simmer"},
    ]
    initial = {"title": "Egg custard 蒸雞蛋", "description": "Soft eggs，口感滑順。",
               "ingredients": [{"name": "雞蛋 / Eggs", "quantity": "兩個", "metric_quantity": "約100克", "notes": "攪拌均勻"}],
               "tips": ["保持鍋蓋密合。", "Serve warm."], "equipment": ["平底鍋", "Bowl"],
               "total_time_minutes": 3, "actions": actions, "steps": steps}
    audit = {"actions": actions, "steps": steps,
             "audit": {"complete": True, "order_valid": True, "method_available": True,
                       "missing_action_ids": [], "unsupported_step_ids": [], "warnings": []}}
    return initial, audit


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["text", "captions", "video", "media"])
async def test_all_import_paths_simplify_display_only_after_grounding(monkeypatch, mode):
    initial, audit = chinese_payloads()
    complete = AsyncMock(side_effect=[json.dumps(initial, ensure_ascii=False), json.dumps(audit, ensure_ascii=False)])
    url = "https://www.youtube.com/watch?v=A6bByqI_TH8"
    if mode in {"text", "captions"}:
        monkeypatch.setattr(extract, "get_openai_client", lambda: object())
        monkeypatch.setattr(extract, "_request_json_completion", complete)
        recipe = await extract.extract_recipe_from_text(SOURCE, source_kind=mode)
    else:
        monkeypatch.setattr(extract, "complete_video", complete)
        recipe = await extract.extract_recipe_from_video(
            source_url=url, notes=SOURCE,
            **({"media_data": b"fixture", "media_type": "video/mp4"} if mode == "media" else {}),
        )
        assert recipe.source_url == url
    assert complete.await_count == 2
    assert recipe.title == "Egg custard 蒸鸡蛋"
    assert recipe.description == "Soft eggs，口感滑顺。"
    assert recipe.ingredients[0].model_dump() == {
        "name": "鸡蛋 / Eggs", "quantity": "两个", "metric_quantity": "约100克", "notes": "搅拌均匀",
    }
    assert recipe.tips == ["保持锅盖密合。", "Serve warm."]
    assert recipe.equipment == []  # Legacy provider fields must not reintroduce the retired feature.
    assert [step.text for step in recipe.steps] == ["搅拌鸡蛋。", "焖煮两分钟。"]
    assert [step.id for step in recipe.steps] == ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"]
    assert recipe.steps[1].duration_seconds == 120
    assert recipe.steps[1].duration_source == "stated"
    assert recipe.total_time_minutes == 3
    assert [step.source_excerpt for step in recipe.steps] == ["攪拌雞蛋。", "燜煮兩分鐘。"]
    assert [step.source_start_seconds for step in recipe.steps] == [1.5, 4]
    assert [step.source_end_seconds for step in recipe.steps] == [3.5, 6]
    assert recipe.raw_extraction_text == SOURCE
    assert recipe.import_review.status == "ready"
    assert all(step.instruction_source == "source" for step in recipe.steps)


def test_japanese_recipe_and_its_kanji_only_labels_are_unchanged():
    from app.services.recipe_language import normalize_import_display_fields
    data = {"title": "醤油鶏鍋", "description": "鶏肉を柔らかく煮ます。",
            "ingredients": [{"name": "醤油", "quantity": "大さじ1", "notes": "薄口"}],
            "steps": [{"text": "鶏肉を鍋に入れて煮ます。"}], "equipment": ["鍋"], "tips": ["熱いうちに食べます。"]}
    assert normalize_import_display_fields(data) == data


def test_korean_prose_and_source_only_japanese_context_are_preserved():
    from app.services.recipe_language import normalize_import_display_fields
    korean = {"title": "醬油 닭고기", "steps": [{"text": "鷄肉을 냄비에 넣고 끓입니다."}],
              "ingredients": [{"name": "醬油", "quantity": "한 큰술"}]}
    assert normalize_import_display_fields(korean) == korean
    title_only = {"title": "醤油鶏鍋", "steps": [], "ingredients": [{"name": "醤油", "quantity": ""}]}
    assert normalize_import_display_fields(title_only, source_text="鶏肉を鍋に入れます。") == title_only


@pytest.mark.asyncio
async def test_audit_failure_still_normalizes_the_grounded_initial_draft():
    initial, _ = chinese_payloads()
    request = AsyncMock(side_effect=[json.dumps(initial, ensure_ascii=False), TimeoutError("fixture")])
    recipe = await extract._extract_with_audit(SOURCE, kind="captions", request=request, audiovisual=False)
    assert request.await_count == 2
    assert recipe.title == "Egg custard 蒸鸡蛋"
    assert recipe.steps[1].text == "焖煮两分钟。"
    assert recipe.steps[1].duration_seconds == 120 and recipe.steps[1].duration_source == "stated"
    assert recipe.steps[1].source_excerpt == "燜煮兩分鐘。"
    assert recipe.import_review.status == "needs_review"
    assert recipe.equipment == []


def test_chinese_recipe_keeps_japanese_field_and_all_non_display_metadata():
    from app.services.recipe_language import normalize_import_display_fields
    data = {"id": "繁體-id", "title": "蔥油雞", "description": None,
            "source_url": "https://example.com/雞", "raw_extraction_text": "蔥油雞原文",
            "thumbnail_url": "https://example.com/鍋.png", "total_time_minutes": 5,
            "ingredients": [{"name": "醤油（しょうゆ）", "quantity": "兩勺", "notes": "日文標籤"}],
            "steps": [{"id": "雞-step", "text": "加入醬油。", "source_excerpt": "加入醬油。",
                       "duration_seconds": 30, "duration_source": "user", "image_url": "https://example.com/雞.png",
                       "source_start_seconds": 12.5, "source_end_seconds": 14}],
            "tips": ["See https://example.com/雞?鍋=蔥 for details; 灑上蔥花。"], "equipment": ["鍋"]}
    original = deepcopy(data)
    normalized = normalize_import_display_fields(data)
    assert data == original
    assert normalized["title"] == "葱油鸡"
    assert normalized["ingredients"] == [{"name": "醤油（しょうゆ）", "quantity": "两勺", "notes": "日文标签"}]
    assert normalized["tips"] == ["See https://example.com/雞?鍋=蔥 for details; 洒上葱花。"]
    assert normalized["equipment"] == data["equipment"]  # Retired metadata is not a display-language field.
    assert normalized["steps"][0] == {**data["steps"][0], "text": "加入酱油。"}
    for key in ("id", "description", "source_url", "raw_extraction_text", "thumbnail_url", "total_time_minutes"):
        assert normalized[key] == data[key]


def test_manual_recipe_models_and_raw_parser_are_not_normalized():
    values = {"id": "manual", "title": "蔥油雞", "ingredients": [{"name": "雞肉", "quantity": "兩塊"}],
              "steps": [{"text": "熱鍋。", "duration_seconds": 120, "duration_source": "user"}]}
    manual = Recipe(**values)
    assert manual.title == "蔥油雞" and manual.steps[0].text == "熱鍋。"
    assert extract.parse_llm_recipe_response(json.dumps(values, ensure_ascii=False))["title"] == "蔥油雞"


@pytest.mark.parametrize("instruction,duration", [("焖煮三分钟。", 180), ("加入鸡蛋。", 30)])
def test_script_folding_does_not_accept_unsupported_numbers_or_actions(instruction, duration):
    initial, _ = chinese_payloads()
    actions, _ = action_inventory(initial, SOURCE, audiovisual=False)
    steps, warnings = ground_steps([{"text": instruction, "source_action_ids": ["燜煮-a2"],
                                     "duration_seconds": duration, "duration_source": "stated"}],
                                   actions, SOURCE, audiovisual=False, require_evidence=True)
    assert warnings
    assert not steps or steps[0]["instruction_source"] is None
    assert not steps or steps[0]["duration_source"] == "unknown"


def test_simplified_rewriting_is_not_a_verbatim_traditional_quote():
    initial, _ = chinese_payloads()
    initial["actions"][0]["source_excerpt"] = "搅拌鸡蛋。"
    actions, warnings = action_inventory(initial, SOURCE, audiovisual=False)
    assert [action["id"] for action in actions] == ["燜煮-a2"]
    assert any("matched" in warning for warning in warnings)


def test_simplified_ingredient_substitution_is_rejected_against_traditional_evidence():
    payload = {"ingredients": [{"name": "鸡蛋"}, {"name": "鸡肉"}],
               "actions": [{"id": "a1", "text": "加入鸡肉。", "source_excerpt": "加入雞蛋。"}]}
    actions, warnings = action_inventory(payload, "加入雞蛋。", audiovisual=False)
    assert warnings and actions[0]["_evidence_uncertain"] is True


def test_prompts_request_simplified_chinese_and_verbatim_evidence():
    for prompt in (extract._build_extraction_prompt(SOURCE), extract._build_tutorial_audit_prompt(SOURCE, {})):
        assert "Simplified Chinese" in prompt
        assert "Japanese" in prompt
        assert "source_excerpt" in prompt and "verbatim" in prompt
