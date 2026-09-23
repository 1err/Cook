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
async def test_model_gets_exact_aggregated_input_and_cannot_replace_it_with_guess(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", object)
    complete = AsyncMock(return_value=json.dumps({"purchase_items": [
        {"source_name": "Sugar", "name": "Granulated sugar", "suggested_purchase": "1 kg bag", "grocery_category": "Pantry & Dry Goods"},
        {"source_name": "盐", "name": "盐 (salt)", "suggested_purchase": "2 tbsp", "grocery_category": "Pantry & Dry Goods"},
    ]}))
    monkeypatch.setattr(refine, "complete_chat", complete)

    result = by_name(await refine.refine_shopping_list(INGREDIENTS))

    messages = complete.await_args.kwargs["messages"]
    payload = json.loads(messages[1]["content"].split("Input ingredients JSON:\n", 1)[1])
    assert payload == [{"name": "Sugar", "quantity": "15 g"}, {"name": "盐", "quantity": "适量"}]
    assert result["granulated sugar"]["suggested_purchase"] == "15 g"
    assert result["granulated sugar"]["grocery_category"] == "Pantry & Dry Goods"
    assert result["盐"]["suggested_purchase"] == "适量"
    assert "Do not invent" in messages[0]["content"]


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

    assert await refine.refine_shopping_list([]) == {"purchase_items": []}
    assert await refine.refine_shopping_list([{"name": " ", "quantity": "1 g"}]) == {"purchase_items": []}
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
