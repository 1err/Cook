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
def test_invalid_or_fragmented_group_quantity_recovers_original_total(quantity):
    result = refine._parse_llm_refine_response(response(group(["ingredient-1"], "盐", quantity, "Pantry & Dry Goods")), [{"name": "盐", "quantity": "20 g"}])
    assert result["refinement_status"] == "refined"
    assert result["purchase_items"][0]["suggested_purchase"] == "20 g"


def test_pure_vague_sources_cannot_be_invented_into_a_numeric_amount():
    inputs = [{"name": "盐", "quantity": "适量"}, {"name": "食用盐", "quantity": "少许"}]
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "盐", "约 5 g")), inputs)
    assert result["refinement_status"] == "refined"
    assert "5" not in result["purchase_items"][0]["suggested_purchase"]


def test_measured_sources_cannot_be_replaced_with_only_vague_amount():
    result = refine._parse_llm_refine_response(response(group(["ingredient-1"], "盐", "适量")), [{"name": "盐", "quantity": "20 g"}])
    assert result["refinement_status"] == "refined"
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
    assert result["refinement_status"] == "refined"
    assert result["purchase_items"][0]["suggested_purchase"] == "约 25.2–35.2 g"


def test_legacy_output_is_honest_about_not_performing_smart_aggregation():
    result = refine._parse_llm_refine_response(response({
        "source_name": "盐", "name": "盐", "grocery_category": "Pantry & Dry Goods",
    }), [{"name": "盐", "quantity": "20 g"}])
    assert result["refinement_status"] == "fallback"
    assert result["purchase_items"] == [{"name": "盐", "suggested_purchase": "20 g", "grocery_category": "Pantry & Dry Goods"}]


@pytest.mark.parametrize("quantity,status", [("21 g", "refined"), ("约 21 g", "refined"), ("18–23 g", "refined")])
def test_measured_range_cannot_be_presented_as_an_exact_scalar(quantity, status):
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "盐", quantity)), [
        {"name": "盐", "quantity": "13 g"}, {"name": "盐", "quantity": "5–10 g"},
    ])
    assert result["refinement_status"] == status
    assert result["purchase_items"][0]["suggested_purchase"] == ("18–23 g" if quantity == "21 g" else quantity)


@pytest.mark.parametrize("quantity,status", [("220 g", "fallback"), ("约 220 g", "refined"), ("约 210–230 g", "refined")])
def test_section_to_weight_estimates_require_approximation_marker(quantity, status):
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "胡萝卜", quantity)), [
        {"name": "胡萝卜", "quantity": "1 小段"}, {"name": "胡萝卜", "quantity": "200 g"},
    ])
    assert result["refinement_status"] == status


@pytest.mark.parametrize("inputs,quantity,status", [
    (["13 g", "5–10 g"], "18–23", "refined"),
    (["13 g", "5 g"], "5 g", "refined"),
    (["13 g", "5 g"], "18 g", "refined"),
    (["13 g", "5 g"], "0.018 kg", "refined"),
    (["13 g", "5–10 g"], "18–23 kg", "refined"),
    (["13 g", "5–10 g"], "18–23 g", "refined"),
    (["13 g", "5–10 g"], "about 18–23 kg", "refined"),
    (["0.2 kg", "50 g"], "250 g", "refined"),
    (["2", "3"], "5", "refined"),
    (["约15.2 g", "10–20 g"], "约 25–35 g", "refined"),
])
def test_compatible_quantity_sanity_check_preserves_totals_and_units(inputs, quantity, status):
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "盐", quantity)), [
        {"name": "盐", "quantity": value} for value in inputs
    ])
    assert result["refinement_status"] == status
    if inputs == ["13 g", "5 g"]:
        assert result["purchase_items"][0]["suggested_purchase"] == ("0.018 kg" if quantity == "0.018 kg" else "18 g")
    if inputs == ["13 g", "5–10 g"]:
        assert result["purchase_items"][0]["suggested_purchase"] == "18–23 g"


def test_one_invalid_salt_total_recovers_without_resetting_good_produce():
    inputs = [
        {"name": "大葱", "quantity": "145 g"}, {"name": "大葱", "quantity": "1 小段"},
        {"name": "姜", "quantity": "61 g"}, {"name": "姜", "quantity": "2 片"},
        {"name": "盐", "quantity": "13 g"}, {"name": "食用盐", "quantity": "5 g"},
    ]
    result = refine._parse_llm_refine_response(response(
        group(["ingredient-1", "ingredient-2"], "大葱", "约 165–175 g"),
        group(["ingredient-3", "ingredient-4"], "姜", "约 65–70 g"),
        group(["ingredient-5", "ingredient-6"], "盐", "5 g", "Pantry & Dry Goods"),
    ), inputs)
    assert result == {"purchase_items": [
        {"name": "大葱", "suggested_purchase": "约 165–175 g", "grocery_category": "Produce"},
        {"name": "姜", "suggested_purchase": "约 65–70 g", "grocery_category": "Produce"},
        {"name": "盐", "suggested_purchase": "18 g", "grocery_category": "Pantry & Dry Goods"},
    ], "refinement_status": "refined"}


def test_unresolved_missing_unit_preserves_only_its_original_group():
    inputs = [
        {"name": "大葱", "quantity": "145 g"}, {"name": "大葱", "quantity": "1 小段"},
        {"name": "中筋面粉", "quantity": "2"}, {"name": "中筋面粉", "quantity": "0.25 杯"},
    ]
    result = refine._parse_llm_refine_response(response(
        group(["ingredient-1", "ingredient-2"], "大葱", "约 165–175 g"),
        group(["ingredient-3", "ingredient-4"], "中筋面粉", "2; 0.25 杯", "Pantry & Dry Goods"),
    ), inputs)
    assert result == {"purchase_items": [
        {"name": "大葱", "suggested_purchase": "约 165–175 g", "grocery_category": "Produce"},
        {"name": "中筋面粉", "suggested_purchase": "约 30 g；2（单位待确认）", "grocery_category": "Pantry & Dry Goods"},
    ], "refinement_status": "fallback"}


@pytest.mark.parametrize("name,source,output,expected", [
    ("干辣椒", "若干", "若干", "适量"),
    ("盐", "少量", "少量", "适量"),
    ("大蒜", "几瓣", "几瓣", "适量"),
    ("pepper", "some", "some", "as needed"),
])
def test_safe_vague_labels_are_normalized_without_resetting_other_groups(name, source, output, expected):
    result = refine._parse_llm_refine_response(response(
        group(["ingredient-1", "ingredient-2"], "大葱", "约 165–175 g"),
        group(["ingredient-3"], name, output),
    ), [{"name": "大葱", "quantity": "145 g"}, {"name": "大葱", "quantity": "1 小段"}, {"name": name, "quantity": source}])
    assert result["refinement_status"] == "refined"
    assert [item["suggested_purchase"] for item in result["purchase_items"]] == ["约 165–175 g", expected]


def test_vague_model_label_cannot_replace_a_known_numeric_source():
    result = refine._parse_llm_refine_response(response(group(["ingredient-1"], "盐", "若干")), [{"name": "盐", "quantity": "13 g"}])
    assert result["purchase_items"][0]["suggested_purchase"] == "13 g"
    assert result["refinement_status"] == "refined"


def test_group_recovery_does_not_merge_unknown_original_names():
    result = refine._parse_llm_refine_response(response(
        group(["ingredient-1", "ingredient-2"], "胡萝卜", "约 220 g"),
        group(["ingredient-3", "ingredient-4"], "seasoning", "not a quantity"),
    ), [
        {"name": "胡萝卜", "quantity": "200 g"}, {"name": "胡萝卜", "quantity": "1 小段"},
        {"name": "salt (fine)", "quantity": "2 g"}, {"name": "salt (coarse)", "quantity": "3 g"},
    ])
    assert result["refinement_status"] == "fallback"
    assert [(item["name"], item["suggested_purchase"]) for item in result["purchase_items"]] == [
        ("胡萝卜", "约 220 g"), ("salt (coarse)", "3 g"), ("salt (fine)", "2 g"),
    ]


def test_refinement_diagnostics_report_fixed_reason_counts_without_recipe_data(caplog):
    inputs = [{"name": "private carrot", "quantity": "123456 g"}, {"name": "private salt", "quantity": "777 g"}]
    with caplog.at_level("INFO", logger="app.refine"):
        refine._parse_llm_refine_response(response(
            group(["ingredient-1"], "private carrot", "123456 g"),
            group(["ingredient-2"], "private salt", "1 g"),
        ), inputs)
        refine._parse_llm_refine_response(response(group(["ingredient-1"], "private carrot", "123456 g")), inputs)
    assert "reason=quantity_recovered" in caplog.text
    assert "reason=source_coverage" in caplog.text
    assert "source_count=2" in caplog.text
    assert "group_count=" in caplog.text
    for private in ("private carrot", "private salt", "123456", "777", "ingredient-1", "suggested_purchase"):
        assert private not in caplog.text


def test_recovery_omits_only_recognized_vague_additions_to_known_measured_total():
    result = refine._parse_llm_refine_response(response(
        group(["ingredient-1", "ingredient-2"], "大葱", "约 165–175 g"),
        group(["ingredient-3", "ingredient-4"], "大蒜", "约 55 g"),
    ), [
        {"name": "大葱", "quantity": "145 g"}, {"name": "大葱", "quantity": "1 小段"},
        {"name": "大蒜", "quantity": "约46g；几颗"}, {"name": "蒜", "quantity": "适量"},
    ])
    assert result["refinement_status"] == "refined"
    assert [(item["name"], item["suggested_purchase"]) for item in result["purchase_items"]] == [
        ("大葱", "约 165–175 g"), ("大蒜", "约 46 g"),
    ]


def test_recovery_keeps_unrecognized_and_missing_unit_amounts_while_omitting_vague_notes():
    result = refine._parse_llm_refine_response(response(
        group(["ingredient-1"], "大葱", "145 g"),
        group(["ingredient-2"], "中筋面粉", "约 30 g"),
    ), [{"name": "大葱", "quantity": "145 g"}, {"name": "中筋面粉", "quantity": "2; 0.25 杯; 少量"}])
    assert result["refinement_status"] == "fallback"
    assert result["purchase_items"] == [
        {"name": "大葱", "suggested_purchase": "145 g", "grocery_category": "Produce"},
        {"name": "中筋面粉", "suggested_purchase": "约 30 g；2（单位待确认）", "grocery_category": "Produce"},
    ]


@pytest.mark.parametrize("plain,specialty", [
    ("洋葱", "红洋葱"), ("洋葱", "紫皮洋葱"), ("白洋葱", "黄洋葱"),
    ("onion", "red onion"), ("onions", "purple onions"), ("white onion", "yellow onions"),
])
def test_distinct_onion_varieties_are_restored_without_discarding_other_groups(plain, specialty):
    result = refine._parse_llm_refine_response(response(
        group(["ingredient-1", "ingredient-2"], "大葱", "约 165–175 g"),
        group(["ingredient-3", "ingredient-4"], plain, "450 g"),
    ), [
        {"name": "大葱", "quantity": "145 g"}, {"name": "大葱", "quantity": "1 小段"},
        {"name": plain, "quantity": "350 g"}, {"name": specialty, "quantity": "100 g"},
    ])
    assert result["refinement_status"] == "refined"
    assert {item["name"]: item["suggested_purchase"] for item in result["purchase_items"]} == {
        "大葱": "约 165–175 g", plain: "350 g", specialty: "100 g",
    }


def test_same_onion_variety_still_aggregates_repeated_requirements():
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], "红洋葱", "450 g")), [
        {"name": "红洋葱", "quantity": "350 g"}, {"name": "红洋葱", "quantity": "100 g"},
    ])
    assert result["refinement_status"] == "refined"
    assert result["purchase_items"] == [{"name": "红洋葱", "suggested_purchase": "450 g", "grocery_category": "Produce"}]


@pytest.mark.parametrize("sources,expected", [
    (["13 g", "5–10 g"], "18–23 g"),
    (["0.013 kg", "5–10 g"], "18–23 g"),
    (["约 15.2 g", "10–20 g"], "约 25.2–35.2 g"),
])
def test_invalid_model_range_recovers_exact_compatible_bounds_without_resetting_produce(sources, expected):
    result = refine._parse_llm_refine_response(response(
        group(["ingredient-1", "ingredient-2"], "大葱", "约 165–175 g"),
        group(["ingredient-3", "ingredient-4"], "盐", "18–23 kg", "Pantry & Dry Goods"),
    ), [
        {"name": "大葱", "quantity": "145 g"}, {"name": "大葱", "quantity": "1 小段"},
        *[{"name": "盐", "quantity": amount} for amount in sources],
    ])
    assert result["refinement_status"] == "refined"
    assert [item["suggested_purchase"] for item in result["purchase_items"]] == ["约 165–175 g", expected]


@pytest.mark.parametrize("name,alias", [("大蒜", "蒜"), ("生姜", "姜"), ("番茄", "西红柿")])
def test_safe_recovery_aliases_keep_known_synonyms_in_one_row(name, alias):
    result = refine._parse_llm_refine_response(response(group(["ingredient-1", "ingredient-2"], name, "5 g")), [
        {"name": name, "quantity": "10 g"}, {"name": alias, "quantity": "20 g"},
    ])
    assert result["refinement_status"] == "refined"
    assert result["purchase_items"] == [{"name": name, "suggested_purchase": "30 g", "grocery_category": "Produce"}]


def test_local_recovery_preserves_distinct_vague_ingredient_alongside_measured_ingredient():
    # Force quantity recovery: a fabricated total must not erase the vague row.
    invalid = response(
        group(["ingredient-1", "ingredient-2"], "大葱", "约 165–175 g"),
        group(["ingredient-3", "ingredient-4"], "salt", "3 g"),
    )
    result = refine._parse_llm_refine_response(invalid, [
        {"name": "大葱", "quantity": "145 g"}, {"name": "大葱", "quantity": "1 小段"},
        {"name": "salt (fine)", "quantity": "2 g"}, {"name": "salt (coarse)", "quantity": "some"},
    ])
    assert result["refinement_status"] == "fallback"
    assert {item["name"]: item["suggested_purchase"] for item in result["purchase_items"]} == {
        "大葱": "约 165–175 g", "salt (fine)": "2 g", "salt (coarse)": "to taste",
    }
