"""Shopping remains consolidated and categorized without a model response."""
import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from app import refine


def rows(result):
    return {
        row["name"]: (row["suggested_purchase"], row["grocery_category"])
        for row in result["purchase_items"]
    }


def test_tomato_aliases_share_one_identity_before_quantity_recovery():
    result = refine.deterministic_shopping_list([
        {"name": "番茄", "quantity": "200 g"}, {"name": "西红柿", "quantity": "100 g"},
    ])
    assert result == {"purchase_items": [{
        "name": "番茄", "suggested_purchase": "300 g", "grocery_category": "Produce",
    }], "refinement_status": "refined"}


@pytest.mark.parametrize("name,quantity,status", [
    ("milk", "2 xyz", "partial"),
    ("milk", "2", "partial"),
    ("大蒜", "2 瓣", "refined"),
    ("胡萝卜", "1 小段", "refined"),
    ("鸡蛋", "2 个", "refined"),
])
def test_unknown_measurements_remain_partial_without_rejecting_known_count_units(name, quantity, status):
    result = refine.deterministic_shopping_list([{"name": name, "quantity": quantity}])
    assert result["refinement_status"] == status
    assert result["purchase_items"][0]["suggested_purchase"] == quantity


@pytest.mark.parametrize("name,known,expected", [
    ("milk", "100 ml", "100 ml + amount unspecified"),
    ("牛奶", "100 ml", "100 ml + 用量未注明"),
    ("milk", "", "amount unspecified"),
])
def test_missing_recipe_contribution_stays_visible_in_local_and_model_totals(name, known, expected):
    sources = [{"name": name, "quantity": known}, {"name": name, "quantity": ""}]
    local = refine.deterministic_shopping_list(sources)
    enhanced = refine._parse_llm_refine_response(json.dumps({"purchase_items": [{
        "source_ids": ["ingredient-1", "ingredient-2"], "name": name,
        "suggested_purchase": known or "100 ml", "grocery_category": "Dairy",
    }]}), sources)
    for result in [local, enhanced]:
        assert result["refinement_status"] == "partial"
        assert rows(result) == {name: (expected, "Dairy")}


@pytest.mark.asyncio
async def test_known_aliases_totals_and_ranges_need_no_provider(monkeypatch):
    complete = AsyncMock(side_effect=TimeoutError)
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", complete)
    result = await refine.refine_shopping_list([
        {"name": "大蒜", "quantity": "20 g"}, {"name": "蒜", "quantity": "2 瓣"},
        {"name": "盐", "quantity": "13 g"}, {"name": "食用盐", "quantity": "5–10 g"},
        {"name": "生抽", "quantity": "10 g"}, {"name": "生抽酱油", "quantity": "20 g"},
        {"name": "Milk", "quantity": "100 ml"}, {"name": "Milk", "quantity": "0.5 l"},
    ])
    assert result["refinement_status"] == "refined"
    assert rows(result) == {
        "大蒜": ("约 26 g", "Produce"), "盐": ("18–23 g", "Pantry & Dry Goods"),
        "生抽": ("30 g", "Pantry & Dry Goods"), "Milk": ("600 ml", "Dairy"),
    }
    complete.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "invalid-json", "missing-source"])
async def test_failed_enhancement_preserves_local_categories_ranges_and_uncertainty(monkeypatch, failure):
    complete = AsyncMock()
    if failure == "timeout":
        complete.side_effect = TimeoutError
    elif failure == "invalid-json":
        complete.return_value = "not json"
    else:
        complete.return_value = json.dumps({"purchase_items": [{
            "source_ids": ["ingredient-1"], "name": "盐",
            "suggested_purchase": "13 g", "grocery_category": "Pantry & Dry Goods",
        }]})
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", complete)
    result = await refine.refine_shopping_list([
        {"name": "盐", "quantity": "13 g"}, {"name": "食用盐", "quantity": "5–10 g"},
        {"name": "胡萝卜", "quantity": "200 g"}, {"name": "胡萝卜", "quantity": "1 小段"},
        {"name": "中筋面粉", "quantity": "2"}, {"name": "中筋面粉", "quantity": "0.25 杯"},
    ])
    assert result["refinement_status"] == "partial"
    assert rows(result) == {
        "盐": ("18–23 g", "Pantry & Dry Goods"),
        "胡萝卜": ("200 g + 1 小段", "Produce"),
        "中筋面粉": ("约 30 g；2（单位待确认）", "Pantry & Dry Goods"),
    }
    complete.assert_awaited_once()


@pytest.mark.asyncio
async def test_unknown_names_keep_original_identity_and_require_enhancement(monkeypatch):
    complete = AsyncMock(side_effect=TimeoutError)
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", complete)
    result = await refine.refine_shopping_list([
        {"name": "garlic-flavored butter chicken", "quantity": "200 g"},
        {"name": "低钠生抽", "quantity": "10 ml"},
        {"name": "生抽", "quantity": "20 ml"},
    ])
    assert result["refinement_status"] == "partial"
    assert rows(result) == {
        "garlic-flavored butter chicken": ("200 g", "Other"),
        "低钠生抽": ("10 ml", "Other"),
        "生抽": ("约 20 g", "Pantry & Dry Goods"),
    }
    complete.assert_awaited_once()


@pytest.mark.asyncio
async def test_model_echoing_an_unknown_unit_does_not_resolve_it(monkeypatch):
    complete = AsyncMock(return_value=json.dumps({"purchase_items": [{
        "source_ids": ["ingredient-1"], "name": "milk",
        "suggested_purchase": "2 xyz", "grocery_category": "Dairy",
    }]}))
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", complete)
    result = await refine.refine_shopping_list([{"name": "milk", "quantity": "2 xyz"}])
    assert result["refinement_status"] == "partial"
    assert rows(result) == {"milk": ("2 xyz", "Dairy")}
    complete.assert_awaited_once()


@pytest.mark.asyncio
async def test_exact_bilingual_categories_distinguish_fresh_dried_and_dairy(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", lambda: None)
    result = await refine.refine_shopping_list([
        {"name": name, "quantity": quantity}
        for name, quantity in [
            ("辣椒", "20 g"), ("干辣椒", "5 g"), ("大蒜", "2 瓣"), ("蒜粉", "3 g"),
            ("chicken", "200 g"), ("milk", "100 ml"), ("鸡蛋", "2 个"),
            ("coconut milk", "100 ml"), ("unknown seasoning", "1 g"),
        ]
    ])
    assert rows(result) == {
        "辣椒": ("20 g", "Produce"), "干辣椒": ("5 g", "Pantry & Dry Goods"),
        "大蒜": ("2 瓣", "Produce"), "蒜粉": ("3 g", "Pantry & Dry Goods"),
        "chicken": ("200 g", "Meat & Seafood"), "milk": ("100 ml", "Dairy"),
        "鸡蛋": ("2 个", "Dairy"), "coconut milk": ("100 ml", "Pantry & Dry Goods"),
        "unknown seasoning": ("1 g", "Other"),
    }
    assert result["refinement_status"] == "partial"


@pytest.mark.asyncio
async def test_optional_model_still_estimates_unresolved_portions(monkeypatch):
    complete = AsyncMock(return_value=json.dumps({"purchase_items": [{
        "source_ids": ["ingredient-1", "ingredient-2"], "name": "胡萝卜",
        "suggested_purchase": "约 220–240 g", "grocery_category": "Produce",
    }]}))
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", complete)
    result = await refine.refine_shopping_list([
        {"name": "胡萝卜", "quantity": "200 g"}, {"name": "胡萝卜", "quantity": "1 小段"},
    ])
    assert result["refinement_status"] == "refined"
    assert rows(result) == {"胡萝卜": ("约 220–240 g", "Produce")}
    complete.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancelled_enhancement_is_not_swallowed(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", AsyncMock(side_effect=asyncio.CancelledError))
    with pytest.raises(asyncio.CancelledError):
        await refine.refine_shopping_list([{"name": "unknown ingredient", "quantity": "1 g"}])
