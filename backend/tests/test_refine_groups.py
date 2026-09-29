"""Smart groups account for every original source before trusting model totals."""
import json
from unittest.mock import AsyncMock

import pytest

from app import refine


def response(*groups):
    return json.dumps({"purchase_items": list(groups)}, ensure_ascii=False)


def group(ids, name, quantity, category="Produce"):
    return {"source_ids": ids, "name": name, "suggested_purchase": quantity, "grocery_category": category}


@pytest.mark.asyncio
async def test_original_sources_reach_model_and_synonyms_share_one_total(monkeypatch):
    inputs = [
        {"name": " 大蒜 ", "quantity": "55 g"},
        {"name": "蒜", "quantity": "2 瓣"},
        {"name": "生姜", "quantity": "10 g"},
        {"name": "姜", "quantity": "1 小段"},
    ]
    complete = AsyncMock(return_value=response(
        group(["ingredient-1", "ingredient-2"], "大蒜", "约 60 g"),
        group(["ingredient-3", "ingredient-4"], "生姜", "约 20 g"),
    ))
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", complete)
    result = await refine.refine_shopping_list(inputs)
    assert result == {"purchase_items": [
        {"name": "大蒜", "suggested_purchase": "约 60 g", "grocery_category": "Produce"},
        {"name": "生姜", "suggested_purchase": "约 20 g", "grocery_category": "Produce"},
    ], "refinement_status": "refined"}
    payload = json.loads(complete.await_args.kwargs["messages"][1]["content"].split("Input ingredients JSON:\n")[1])
    assert payload == [
        {"source_id": "ingredient-1", "name": "大蒜", "quantity": "55 g"},
        {"source_id": "ingredient-2", "name": "蒜", "quantity": "2 瓣"},
        {"source_id": "ingredient-3", "name": "生姜", "quantity": "10 g"},
        {"source_id": "ingredient-4", "name": "姜", "quantity": "1 小段"},
    ]
    assert complete.await_count == 1


@pytest.mark.parametrize("inputs,total", [
    ([{"name": "胡萝卜", "quantity": "1 小段"}, {"name": "胡萝卜", "quantity": "200 g"}], "约 220 g"),
    ([{"name": "盐", "quantity": "13 g"}, {"name": "食用盐", "quantity": "5–10 g"}], "18–23 g"),
    ([{"name": "白糖", "quantity": "约 15.2 g"}, {"name": "白糖", "quantity": "10–20 g"}], "约 25–35 g"),
])
def test_screenshot_totals_accept_one_model_estimate_or_range(inputs, total):
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], inputs[0]["name"], total)), inputs)
    assert result["refinement_status"] == "refined"
    assert [item["suggested_purchase"] for item in result["purchase_items"]] == [total]


@pytest.mark.parametrize("rows", [
    [group(["ingredient-1"], "大蒜", "10 g")],
    [group(["ingredient-1", "ingredient-1", "ingredient-2"], "大蒜", "20 g")],
    [group(["ingredient-1", "ingredient-2"], "大蒜", "20 g"), group(["ingredient-2"], "蒜", "10 g")],
    [group(["ingredient-1", "ingredient-2", "invented"], "大蒜", "20 g")],
    [group("ingredient-1", "大蒜", "10 g"), group(["ingredient-2"], "蒜", "10 g")],
    [group(["ingredient-1", 2], "大蒜", "20 g")],
])
def test_invalid_source_partition_falls_back_without_dropping_or_doublecounting(rows):
    inputs = [{"name": "大蒜", "quantity": "10 g"}, {"name": "蒜", "quantity": "10 g"}]
    result = refine._parse_llm_refine_response(response(*rows), inputs)
    assert result == {"purchase_items": [
        {"name": "大蒜", "suggested_purchase": "10 g", "grocery_category": "Other"},
        {"name": "蒜", "suggested_purchase": "10 g", "grocery_category": "Other"},
    ], "refinement_status": "fallback"}


def test_invalid_partition_fallback_still_sums_repeated_exact_sources_once():
    inputs = [{"name": "盐", "quantity": "2 g"}, {"name": "盐", "quantity": "3 g"}]
    result = refine._parse_llm_refine_response(response(group(["ingredient-1"], "盐", "2 g")), inputs)
    assert result["purchase_items"] == [{"name": "盐", "suggested_purchase": "5 g", "grocery_category": "Other"}]
    assert result["refinement_status"] == "fallback"


@pytest.mark.parametrize("quantity", ["", None, {"amount": 20}, "10 g + 2 g", "10 g; 2 g", "20 g（另按口味添加）", "20 g, plus more to taste", "-20 g", "20–10 g", "0 g"])
def test_invalid_or_fragmented_group_quantity_falls_back(quantity):
    result = refine._parse_llm_refine_response(response(group(["ingredient-1"], "盐", quantity, "Pantry & Dry Goods")), [{"name": "盐", "quantity": "20 g"}])
    assert result["refinement_status"] == "fallback"
    assert result["purchase_items"][0]["suggested_purchase"] == "20 g"


def test_pure_vague_sources_cannot_be_invented_into_a_numeric_amount():
    inputs = [{"name": "盐", "quantity": "适量"}, {"name": "食用盐", "quantity": "少许"}]
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "盐", "约 5 g")), inputs)
    assert result["refinement_status"] == "fallback"
    assert "5" not in result["purchase_items"][0]["suggested_purchase"]


def test_measured_sources_cannot_be_replaced_with_only_vague_amount():
    result = refine._parse_llm_refine_response(response(group(["ingredient-1"], "盐", "适量")), [{"name": "盐", "quantity": "20 g"}])
    assert result["refinement_status"] == "fallback"
    assert result["purchase_items"][0]["suggested_purchase"] == "20 g"


def test_measured_and_vague_sources_have_one_clean_total():
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "盐", "20 g")), [{"name": "盐", "quantity": "20 g"}, {"name": "盐", "quantity": "适量"}])
    assert result["refinement_status"] == "refined"
    assert result["purchase_items"][0]["suggested_purchase"] == "20 g"


def test_duplicate_output_names_cannot_hide_different_groups():
    inputs = [{"name": "salt (fine)", "quantity": "2 g"}, {"name": "salt (coarse)", "quantity": "3 g"}]
    result = refine._parse_llm_refine_response(response(group(["ingredient-1"], "salt", "2 g"), group(["ingredient-2"], "salt", "3 g")), inputs)
    assert result["refinement_status"] == "fallback"
    assert {item["name"] for item in result["purchase_items"]} == {"salt (fine)", "salt (coarse)"}


def test_translated_group_name_does_not_keep_renamed_group_quantity():
    inputs = [{"name": "大蒜", "quantity": "10 g"}, {"name": "蒜", "quantity": "5 g"}]
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "garlic", "15 g")), inputs)
    assert result["refinement_status"] == "fallback"
    assert {item["name"] for item in result["purchase_items"]} == {"大蒜", "蒜"}


def test_source_approximation_is_not_silently_removed():
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "白糖", "25–35 g")), [{"name": "白糖", "quantity": "约15.2 g"}, {"name": "白糖", "quantity": "10–20 g"}])
    assert result["refinement_status"] == "fallback"
    assert result["purchase_items"][0]["suggested_purchase"].startswith("约")


def test_legacy_output_is_honest_about_not_performing_smart_aggregation():
    result = refine._parse_llm_refine_response(response({
        "source_name": "盐", "name": "盐", "grocery_category": "Pantry & Dry Goods",
    }), [{"name": "盐", "quantity": "20 g"}])
    assert result["refinement_status"] == "fallback"
    assert result["purchase_items"] == [{"name": "盐", "suggested_purchase": "20 g", "grocery_category": "Pantry & Dry Goods"}]


@pytest.mark.parametrize("quantity,status", [("21 g", "fallback"), ("约 21 g", "refined"), ("18–23 g", "refined")])
def test_measured_range_cannot_be_presented_as_an_exact_scalar(quantity, status):
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "盐", quantity)), [
        {"name": "盐", "quantity": "13 g"}, {"name": "盐", "quantity": "5–10 g"},
    ])
    assert result["refinement_status"] == status


@pytest.mark.parametrize("quantity,status", [("220 g", "fallback"), ("约 220 g", "refined"), ("约 210–230 g", "refined")])
def test_section_to_weight_estimates_require_approximation_marker(quantity, status):
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "胡萝卜", quantity)), [
        {"name": "胡萝卜", "quantity": "1 小段"}, {"name": "胡萝卜", "quantity": "200 g"},
    ])
    assert result["refinement_status"] == status


@pytest.mark.parametrize("inputs,quantity,status", [
    (["13 g", "5–10 g"], "18–23", "fallback"),
    (["13 g", "5 g"], "5 g", "fallback"),
    (["13 g", "5 g"], "18 g", "refined"),
    (["13 g", "5 g"], "0.018 kg", "refined"),
    (["13 g", "5–10 g"], "18–23 kg", "fallback"),
    (["13 g", "5–10 g"], "18–23 g", "refined"),
    (["13 g", "5–10 g"], "about 18–23 kg", "fallback"),
    (["0.2 kg", "50 g"], "250 g", "refined"),
    (["2", "3"], "5", "refined"),
    (["约15.2 g", "10–20 g"], "约 25–35 g", "refined"),
])
def test_compatible_quantity_sanity_check_preserves_totals_and_units(inputs, quantity, status):
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "盐", quantity)), [
        {"name": "盐", "quantity": value} for value in inputs
    ])
    assert result["refinement_status"] == status
