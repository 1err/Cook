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
