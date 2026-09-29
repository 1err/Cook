"""
Shopping list aggregation and refine routes. All require auth.
"""
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.api.ai_budget import enforce_ai_budget
from app.db import repo_mealplan, repo_recipes
from app.db.models import UserModel
from app.db.session import get_session
from app.models import ShoppingListItem
from app.refine import refine_shopping_list
from app.services.shopping_service import aggregate_ingredients, preferred_shopping_quantity

router = APIRouter(tags=["shopping"])


class RefineItem(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    quantity: str = Field("", max_length=256)


class RefineRequest(BaseModel):
    items: list[RefineItem] = Field(max_length=1000)


class LikelyPantryItem(BaseModel):
    name: str
    reason: str


class PurchaseItem(BaseModel):
    name: str
    suggested_purchase: str
    category: str = "Other"


class RefineResponse(BaseModel):
    """Legacy shape: ``remove`` and ``likely_pantry`` are always empty.

    The model only emits ``purchase_items`` (with category ``Pantry & Dry Goods``
    for staples). The two empty arrays are kept for client-side compatibility.
    """
    remove: list[str]
    likely_pantry: list[LikelyPantryItem]
    purchase_items: list[PurchaseItem]
    refinement_status: Literal["refined", "fallback"] = "refined"


@router.get("/shopping-list", response_model=list[ShoppingListItem])
async def shopping_list(
    start: date,
    end: date,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Aggregated ingredients for meal plans in [start, end] (inclusive)."""
    try:
        repo_mealplan.validate_meal_plan_range(start.isoformat(), end.isoformat())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    plans = await repo_mealplan.get_meal_plans_in_range(session, start.isoformat(), end.isoformat(), current_user.id)
    recipes = await repo_recipes.get_recipes_by_ids(
        session, [rid for plan in plans for rid in plan.all_recipe_ids()], current_user.id,
    )
    recipe_cache = {recipe.id: recipe for recipe in recipes}
    all_ingredients: list[tuple[str, str]] = []
    for p in plans:
        for rid in p.all_recipe_ids():
            r = recipe_cache.get(rid)
            if r:
                for i in r.ingredients:
                    name = (i.name or "").strip()
                    qty = preferred_shopping_quantity(i.quantity, i.metric_quantity)
                    all_ingredients.append((name, qty))
    return aggregate_ingredients(all_ingredients, for_purchase=True, include_sources=True)


@router.post("/shopping-list/refine", response_model=RefineResponse, dependencies=[Depends(enforce_ai_budget)])
async def shopping_list_refine(
    body: RefineRequest,
    _user: UserModel = Depends(get_current_user),
):
    """Group recipe ingredient entries into purchase quantities. Stateless."""
    raw = [{"name": i.name, "quantity": i.quantity} for i in body.items]
    result = await refine_shopping_list(raw)
    return RefineResponse(
        remove=[],
        likely_pantry=[],
        refinement_status=result.get("refinement_status", "refined"),
        purchase_items=[
            PurchaseItem(
                name=p["name"],
                suggested_purchase=p["suggested_purchase"],
                category=p.get("grocery_category") or p.get("category") or "Other",
            )
            for p in result["purchase_items"]
        ],
    )
