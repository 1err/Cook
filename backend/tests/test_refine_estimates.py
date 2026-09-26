import json
from unittest.mock import AsyncMock
import pytest
from app import refine


@pytest.mark.asyncio
async def test_refinement_normalizes_provider_input_and_preserves_total(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", lambda: object())
    complete = AsyncMock(return_value=json.dumps({"purchase_items": [{
        "name": "Milk", "suggested_purchase": "1 bottle", "grocery_category": "Dairy",
    }]}))
    monkeypatch.setattr(refine, "complete_chat", complete)
    result = await refine.refine_shopping_list([{"name": "Milk", "quantity": "100 ml, 0.5 l"}])
    assert result["purchase_items"][0]["suggested_purchase"] == "600 ml"
    assert '"quantity": "600 ml"' in complete.call_args.kwargs["messages"][1]["content"]

@pytest.mark.asyncio
async def test_provider_failure_still_returns_consolidated_quantities(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", lambda: object())
    monkeypatch.setattr(refine, "complete_chat", AsyncMock(side_effect=RuntimeError("unavailable")))
    result = await refine.refine_shopping_list([{"name": "Milk", "quantity": "100 ml, 0.5 l"}])
    assert result["purchase_items"][0]["suggested_purchase"] == "600 ml"

@pytest.mark.asyncio
async def test_screenshot_estimates_survive_successful_renaming(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", object)
    monkeypatch.setattr(refine, "complete_chat", AsyncMock(return_value=json.dumps({"purchase_items": [
        {"source_name": "盐", "name": "食盐", "suggested_purchase": "1 jar", "grocery_category": "Pantry & Dry Goods"}
    ]})))
    result = await refine.refine_shopping_list([{"name": "盐", "quantity": "1 茶勺; 7 g; 少许; 适量"}])
    assert result["purchase_items"][0]["suggested_purchase"] == "约 13 g"
    assert result["purchase_items"][0]["name"] == "食盐"

@pytest.mark.asyncio
async def test_missing_flour_unit_remains_visible_in_provider_fallback(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", lambda: None)
    result = await refine.refine_shopping_list([{"name": "中筋面粉", "quantity": "2; 0.25 杯"}])
    assert result["purchase_items"][0]["suggested_purchase"] == "约 30 g；2（单位待确认）"

@pytest.mark.asyncio
async def test_recorded_mass_survives_refine_before_other_cup_estimates(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", lambda: None)
    result = await refine.refine_shopping_list([{"name": "中筋面粉", "quantity": "半杯 160克; 1 杯"}])
    assert result["purchase_items"][0]["suggested_purchase"] == "约 280 g"
