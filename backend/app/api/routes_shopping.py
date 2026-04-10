"""
Shopping list aggregation and refine routes. Uses repo + shopping_service + refine_service. All require auth.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db.session import get_session
from app.db import repo_recipes, repo_mealplan
from app.db.models import UserModel
from app.models import Recipe, ShoppingListItem
from app.services.refine_service import refine_shopping_list
from app.services.shopping_service import aggregate_ingredients

router = APIRouter(tags=["shopping"])


class RefineItem(BaseModel):
    name: str
    quantity: str = ""


class RefineRequest(BaseModel):
    items: list[RefineItem]


class LikelyPantryItem(BaseModel):
    name: str
    reason: str


class PurchaseItem(BaseModel):
    name: str
    suggested_purchase: str
    category: str = "Other"


class RefineResponse(BaseModel):
    remove: list[str]
    likely_pantry: list[LikelyPantryItem]
    purchase_items: list[PurchaseItem]


@router.get("/shopping-list", response_model=list[ShoppingListItem])
async def shopping_list(
    start: str,
    end: str,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """
    Aggregated ingredients for meal plans in [start, end].
    Groups by ingredient name (case-insensitive). Quantities with same unit
    are summed when parseable; otherwise concatenated.
    """
    plans = await repo_mealplan.get_meal_plans_in_range(session, start, end, current_user.id)
    recipe_cache: dict[str, Recipe | None] = {}
    for p in plans:
        for rid in p.all_recipe_ids():
            if rid not in recipe_cache:
                recipe_cache[rid] = await repo_recipes.get_recipe(session, rid, current_user.id)
    all_ingredients: list[tuple[str, str]] = []
    for p in plans:
        for rid in p.all_recipe_ids():
            r = recipe_cache.get(rid)
            if r:
                for i in r.ingredients:
                    name = (i.name or "").strip()
                    qty = (i.quantity or "").strip()
                    all_ingredients.append((name, qty))
    return aggregate_ingredients(all_ingredients)


@router.post("/shopping-list/refine", response_model=RefineResponse)
async def shopping_list_refine(
    body: RefineRequest,
    current_user: UserModel = Depends(get_current_user),
):
    """Refine aggregated list: remove non-purchasables, flag pantry, suggest purchase quantities. Stateless."""
    raw = [{"name": i.name, "quantity": i.quantity} for i in body.items]
    result = await refine_shopping_list(raw, pantry_names=[])
    return RefineResponse(
        remove=result["remove"],
        likely_pantry=[
            LikelyPantryItem(name=p["name"], reason=p["reason"])
            for p in result["likely_pantry"]
        ],
        purchase_items=[
            PurchaseItem(
                name=p["name"],
                suggested_purchase=p["suggested_purchase"],
                category=p.get("grocery_category") or p.get("category") or "Other",
            )
            for p in result["purchase_items"]
        ],
    )
