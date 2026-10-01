from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.api import routes_shopping
from app.models import IngredientItem, Recipe


@pytest.mark.asyncio
async def test_batch_recipe_fetch_preserves_repeated_meals(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    plans = [SimpleNamespace(all_recipe_ids=lambda: ["eggs"]),
             SimpleNamespace(all_recipe_ids=lambda: ["eggs", "missing"])]
    monkeypatch.setattr(routes_shopping.repo_mealplan, "get_meal_plans_in_range", AsyncMock(return_value=plans))
    recipe = Recipe(id="eggs", title="Eggs", ingredients=[IngredientItem(name="egg", quantity="2")])
    batch = AsyncMock(return_value=[recipe])
    monkeypatch.setattr(routes_shopping.repo_recipes, "get_recipes_by_ids", batch)
    single = AsyncMock(side_effect=AssertionError("Shopping should use one recipe query"))
    monkeypatch.setattr(routes_shopping.repo_recipes, "get_recipe", single)
    session = object()
    result = await routes_shopping.shopping_list(date(2026, 9, 14), date(2026, 9, 20), session, user)
    assert len(result) == 1
    assert result[0].name == "egg"
    assert result[0].total_quantity == "4"
    assert batch.await_count == 1
    assert batch.call_args.args[2] == user.id


@pytest.mark.asyncio
async def test_metric_equivalents_are_counted_once_for_each_planned_meal(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    plans = [SimpleNamespace(all_recipe_ids=lambda: ["pancakes", "pancakes", "sauce"])]
    monkeypatch.setattr(routes_shopping.repo_mealplan, "get_meal_plans_in_range", AsyncMock(return_value=plans))
    recipes = [
        Recipe(id="pancakes", title="Pancakes", ingredients=[
            IngredientItem(name="flour", quantity="1 cup", metric_quantity="125 g"),
        ]),
        Recipe(id="sauce", title="Sauce", ingredients=[
            IngredientItem(name="flour", quantity="50 g"),
        ]),
    ]
    monkeypatch.setattr(routes_shopping.repo_recipes, "get_recipes_by_ids", AsyncMock(return_value=recipes))

    result = await routes_shopping.shopping_list(date(2026, 9, 14), date(2026, 9, 20), object(), user)

    assert [(item.name, item.total_quantity) for item in result] == [("flour", "300 g")]


@pytest.mark.asyncio
@pytest.mark.parametrize("metric_quantity", [None, "", "  ", "some", "125 g or 150 g", "2 bags", "0 g", "-125 g"])
async def test_unusable_metric_equivalent_preserves_original_quantity(monkeypatch, metric_quantity):
    user = SimpleNamespace(id=uuid4())
    plans = [SimpleNamespace(all_recipe_ids=lambda: ["recipe"])]
    recipe = Recipe(id="recipe", title="Recipe", ingredients=[
        IngredientItem(name="flour", quantity="2 scoops", metric_quantity=metric_quantity),
    ])
    monkeypatch.setattr(routes_shopping.repo_mealplan, "get_meal_plans_in_range", AsyncMock(return_value=plans))
    monkeypatch.setattr(routes_shopping.repo_recipes, "get_recipes_by_ids", AsyncMock(return_value=[recipe]))

    result = await routes_shopping.shopping_list(date(2026, 9, 14), date(2026, 9, 20), object(), user)

    assert [(item.name, item.total_quantity) for item in result] == [("flour", "2 scoops")]


@pytest.mark.asyncio
async def test_metric_equivalent_does_not_restore_a_cleared_original_quantity(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    plans = [SimpleNamespace(all_recipe_ids=lambda: ["recipe"])]
    recipe = Recipe(id="recipe", title="Recipe", ingredients=[
        IngredientItem(name="flour", quantity="", metric_quantity="125 g"),
    ])
    monkeypatch.setattr(routes_shopping.repo_mealplan, "get_meal_plans_in_range", AsyncMock(return_value=plans))
    monkeypatch.setattr(routes_shopping.repo_recipes, "get_recipes_by_ids", AsyncMock(return_value=[recipe]))

    result = await routes_shopping.shopping_list(date(2026, 9, 14), date(2026, 9, 20), object(), user)

    assert [(item.name, item.total_quantity) for item in result] == [("flour", "")]

@pytest.mark.asyncio
async def test_recorded_equivalent_survives_get_then_refine(monkeypatch):
    from app import refine
    user = SimpleNamespace(id=uuid4())
    plans = [SimpleNamespace(all_recipe_ids=lambda: ["recipe"])]
    recipe = Recipe(id="recipe", title="Recipe", ingredients=[
        IngredientItem(name="中筋面粉", quantity="半杯 160克"),
        IngredientItem(name="中筋面粉", quantity="1 杯"),
    ])
    monkeypatch.setattr(routes_shopping.repo_mealplan, "get_meal_plans_in_range", AsyncMock(return_value=plans))
    monkeypatch.setattr(routes_shopping.repo_recipes, "get_recipes_by_ids", AsyncMock(return_value=[recipe]))
    monkeypatch.setattr(refine, "get_openai_client", lambda: None)
    raw = await routes_shopping.shopping_list(date(2026, 9, 14), date(2026, 9, 20), object(), user)
    result = await refine.refine_shopping_list([{"name": item.name, "quantity": item.total_quantity} for item in raw])
    assert result["purchase_items"][0]["suggested_purchase"] == "约 280 g"


@pytest.mark.asyncio
async def test_raw_sources_preserve_aliases_repeated_meals_and_recorded_equivalents(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    plans = [SimpleNamespace(all_recipe_ids=lambda: ["dish", "dish"])]
    recipe = Recipe(id="dish", title="Dish", ingredients=[
        IngredientItem(name="食用盐", quantity="1 茶匙", metric_quantity="6 g"),
        IngredientItem(name="盐", quantity="5–10 g"),
        IngredientItem(name="大蒜", quantity="1 瓣"),
        IngredientItem(name="蒜", quantity="20 g"),
        IngredientItem(name="白糖", quantity="适量"),
    ])
    monkeypatch.setattr(routes_shopping.repo_mealplan, "get_meal_plans_in_range", AsyncMock(return_value=plans))
    monkeypatch.setattr(routes_shopping.repo_recipes, "get_recipes_by_ids", AsyncMock(return_value=[recipe]))

    result = await routes_shopping.shopping_list(date(2026, 9, 14), date(2026, 9, 20), object(), user)
    rows = {item.name: item.model_dump() for item in result}

    assert rows["盐"]["source_items"] == [
        {"name": "食用盐", "quantity": "6 g"}, {"name": "盐", "quantity": "5–10 g"},
        {"name": "食用盐", "quantity": "6 g"}, {"name": "盐", "quantity": "5–10 g"},
    ]
    assert rows["大蒜"]["source_items"] == [
        {"name": "大蒜", "quantity": "1 瓣"}, {"name": "蒜", "quantity": "20 g"},
    ] * 2
    assert "蒜" not in rows
    assert rows["白糖"]["source_items"] == [{"name": "白糖", "quantity": "适量"}] * 2
    assert sum(len(row["source_items"]) for row in rows.values()) == 10


def test_refine_request_accepts_raw_entries_beyond_the_aggregated_row_limit():
    from pydantic import ValidationError

    request = routes_shopping.RefineRequest(items=[
        {"name": f"ingredient {i}", "quantity": "1 g"} for i in range(1000)
    ])
    assert len(request.items) == 1000
    with pytest.raises(ValidationError):
        routes_shopping.RefineRequest(items=[{"name": "salt", "quantity": "1 g"}] * 1001)
