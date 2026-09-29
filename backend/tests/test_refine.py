"""Quantity correctness must not depend on a successful model response."""
import json
from unittest.mock import AsyncMock

import pytest

from app import refine


INGREDIENTS = [
    {"name": " Sugar ", "quantity": "12 g"},
    {"name": "sugar", "quantity": "3 g"},
    {"name": "盐", "quantity": "适量"},
    {"name": "盐", "quantity": "适量"},
    {"name": "食用盐", "quantity": "适量"},
]


def by_name(result):
    return {item["name"].casefold(): item for item in result["purchase_items"]}


@pytest.mark.asyncio
async def test_no_provider_aggregates_duplicate_ingredients_and_uncertain_amounts(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", lambda: None)
    complete = AsyncMock()
    monkeypatch.setattr(refine, "complete_chat", complete)

    result = by_name(await refine.refine_shopping_list(INGREDIENTS))

    assert set(result) == {"sugar", "盐"}
    assert result["sugar"]["suggested_purchase"] == "15 g"
    assert result["盐"]["suggested_purchase"] == "适量"
    complete.assert_not_awaited()


@pytest.mark.asyncio
async def test_provider_failure_preserves_normalized_totals_without_logging_input(monkeypatch, caplog):
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", AsyncMock(side_effect=RuntimeError("private ingredients")))

    result = by_name(await refine.refine_shopping_list(INGREDIENTS))

    assert result["sugar"]["suggested_purchase"] == "15 g"
    assert result["盐"]["suggested_purchase"] == "适量"
    assert "private ingredients" not in caplog.text


@pytest.mark.asyncio
async def test_legacy_response_cannot_replace_original_amounts_without_source_ids(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", object)
    complete = AsyncMock(return_value=json.dumps({"purchase_items": [
        {"source_name": "Sugar", "name": "Granulated sugar", "suggested_purchase": "1 kg bag", "grocery_category": "Pantry & Dry Goods"},
        {"source_name": "盐", "name": "盐 (salt)", "suggested_purchase": "2 tbsp", "grocery_category": "Pantry & Dry Goods"},
    ]}))
    monkeypatch.setattr(refine, "complete_chat", complete)

    result = by_name(await refine.refine_shopping_list(INGREDIENTS))

    messages = complete.await_args.kwargs["messages"]
    payload = json.loads(messages[1]["content"].split("Input ingredients JSON:\n", 1)[1])
    assert [(item["source_id"], item["name"], item["quantity"]) for item in payload] == [
        ("ingredient-1", "Sugar", "12 g"), ("ingredient-2", "sugar", "3 g"),
        ("ingredient-3", "盐", "适量"), ("ingredient-4", "盐", "适量"),
        ("ingredient-5", "食用盐", "适量"),
    ]
    assert result["granulated sugar"]["suggested_purchase"] == "15 g"
    assert result["granulated sugar"]["grocery_category"] == "Pantry & Dry Goods"
    assert result["盐"]["suggested_purchase"] == "适量"


@pytest.mark.asyncio
@pytest.mark.parametrize("raw", ["not json", "[]", '{"purchase_items":null}', '{"purchase_items":[]}'])
async def test_invalid_model_response_falls_back_to_normalized_totals(monkeypatch, raw):
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", AsyncMock(return_value=raw))

    result = by_name(await refine.refine_shopping_list(INGREDIENTS))

    assert result["sugar"]["suggested_purchase"] == "15 g"
    assert result["盐"]["suggested_purchase"] == "适量"


@pytest.mark.asyncio
async def test_partial_duplicate_and_unrecognized_output_cannot_drop_or_add_ingredients(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", AsyncMock(return_value=json.dumps({"purchase_items": [
        {"name": "Sugar", "suggested_purchase": "15 g", "grocery_category": "Pantry & Dry Goods"},
        {"name": "Sugar", "suggested_purchase": "15 g", "grocery_category": "Other"},
        {"name": "butter", "suggested_purchase": "1 pack", "grocery_category": "Dairy"},
        {"name": None, "suggested_purchase": {"amount": "bad"}},
    ]})))

    result = await refine.refine_shopping_list(INGREDIENTS)
    names = by_name(result)

    assert len(result["purchase_items"]) == 2
    assert set(names) == {"sugar", "盐"}
    assert names["sugar"]["grocery_category"] == "Pantry & Dry Goods"
    assert names["盐"]["suggested_purchase"] == "适量"


@pytest.mark.asyncio
async def test_translated_model_name_keeps_original_ingredient_language(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", AsyncMock(return_value=json.dumps({"purchase_items": [
        {"source_name": "盐", "name": "salt", "grocery_category": "Pantry & Dry Goods"},
    ]})))

    result = by_name(await refine.refine_shopping_list([{"name": "盐", "quantity": "适量"}]))

    assert set(result) == {"盐"}
    assert result["盐"]["suggested_purchase"] == "适量"
    assert result["盐"]["grocery_category"] == "Pantry & Dry Goods"


@pytest.mark.asyncio
async def test_empty_or_blank_input_does_not_invoke_provider(monkeypatch):
    client = AsyncMock()
    monkeypatch.setattr(refine, "get_openai_client", client)

    assert await refine.refine_shopping_list([]) == {"purchase_items": [], "refinement_status": "refined"}
    assert await refine.refine_shopping_list([{"name": " ", "quantity": "1 g"}]) == {"purchase_items": [], "refinement_status": "refined"}
    client.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("extra_item", [False, True])
async def test_name_cleanup_cannot_hide_distinct_ingredients_behind_duplicate_names(monkeypatch, extra_item):
    items = [
        {"name": "salt (fine)", "quantity": "2 g"},
        {"name": "salt (coarse)", "quantity": "3 g"},
    ]
    model_items = [
        {"source_name": item["name"], "name": "salt", "grocery_category": "Pantry & Dry Goods"}
        for item in items
    ]
    if extra_item:
        # Renaming a third input to a source's original name must not create a
        # new collision when the first two names are restored.
        items.append({"name": "pepper", "quantity": "4 g"})
        model_items.append({"source_name": "pepper", "name": "salt (fine)", "grocery_category": "Pantry & Dry Goods"})
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", AsyncMock(return_value=json.dumps({"purchase_items": model_items})))

    result = await refine.refine_shopping_list(items)
    names = by_name(result)

    assert len(names) == len(items)
    assert set(names) == {item["name"] for item in items}
    for item in items:
        assert names[item["name"]]["suggested_purchase"] == item["quantity"]
        assert names[item["name"]]["grocery_category"] == "Pantry & Dry Goods"


@pytest.mark.parametrize("source_name", ["oil (sesame)", "oil", "oil（sesame）"])
def test_explicit_source_reference_cannot_match_a_different_ingredient_modifier(source_name):
    result = refine._parse_llm_refine_response(json.dumps({"purchase_items": [{
        "source_name": source_name, "name": "sesame oil", "grocery_category": "Pantry & Dry Goods",
    }]}), [{"name": "oil (peanut)", "quantity": "20 ml"}])

    assert result["purchase_items"] == [{
        "name": "oil (peanut)", "suggested_purchase": "20 ml", "grocery_category": "Other",
    }]
    assert result["refinement_status"] == "fallback"


def test_partial_refinement_keeps_useful_categories_and_reports_fallback():
    result = refine._parse_llm_refine_response(json.dumps({"purchase_items": [{
        "source_name": "牛肉", "name": "牛肉", "grocery_category": "Meat & Seafood",
    }]}), [{"name": "牛肉", "quantity": "250 g"}, {"name": "姜", "quantity": "10 g"}])

    assert result["refinement_status"] == "fallback"
    assert by_name(result) == {
        "牛肉": {"name": "牛肉", "suggested_purchase": "250 g", "grocery_category": "Meat & Seafood"},
        "姜": {"name": "姜", "suggested_purchase": "10 g", "grocery_category": "Other"},
    }


@pytest.mark.parametrize("category", [None, "Unknown aisle", 42])
def test_invalid_model_category_is_reported_as_fallback(category):
    result = refine._parse_llm_refine_response(json.dumps({"purchase_items": [{
        "source_name": "carrot", "name": "carrot", "grocery_category": category,
    }]}), [{"name": "carrot", "quantity": "2"}])

    assert result["refinement_status"] == "fallback"
    assert result["purchase_items"][0] == {"name": "carrot", "suggested_purchase": "2", "grocery_category": "Other"}


def test_complete_refinement_preserves_all_rows_and_quantities_at_the_api_item_limit():
    inputs = [{"name": f"ingredient {i}", "quantity": f"{i + 1} g"} for i in range(200)]
    rows = [{
        "source_ids": [f"ingredient-{index + 1}"], "name": item["name"],
        "suggested_purchase": item["quantity"], "grocery_category": "Other",
    } for index, item in reversed(list(enumerate(inputs)))]

    result = refine._parse_llm_refine_response(json.dumps({"purchase_items": rows}), inputs)

    assert result["refinement_status"] == "refined"
    assert [(item["name"], item["suggested_purchase"]) for item in result["purchase_items"]] == [
        (item["name"], item["quantity"]) for item in inputs
    ]


def test_legacy_response_without_source_reference_remains_compatible():
    result = refine._parse_llm_refine_response(json.dumps({"purchase_items": [{
        "name": "Milk", "grocery_category": "Dairy",
    }]}), [{"name": "milk", "quantity": "600 ml"}])

    assert result["refinement_status"] == "fallback"
    assert result["purchase_items"] == [{"name": "Milk", "suggested_purchase": "600 ml", "grocery_category": "Dairy"}]
