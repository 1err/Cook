"""
Meal plan routes. Uses repo only. All require auth.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db.session import get_session
from app.db import repo_mealplan
from app.db.models import UserModel
from app.models import MealPlan, normalize_meal_plan_slots

router = APIRouter(prefix="/meal-plan", tags=["meal-plan"])


class MealPlanPutBody(BaseModel):
    recipe_ids: list[str] | None = None
    breakfast: list[str] = Field(default_factory=list)
    lunch: list[str] = Field(default_factory=list)
    dinner: list[str] = Field(default_factory=list)


@router.get("", response_model=list[MealPlan])
async def meal_plan_list(
    start: str,
    end: str,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Get meal plans for dates in [start, end] (YYYY-MM-DD inclusive)."""
    return await repo_mealplan.get_meal_plans_in_range(session, start, end, current_user.id)


@router.put("/{date}", response_model=MealPlan)
async def meal_plan_put(
    date: str,
    body: MealPlanPutBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Create or update meal plan for the given date (YYYY-MM-DD)."""
    slots = normalize_meal_plan_slots(body.model_dump(exclude_none=True))
    return await repo_mealplan.put_meal_plan(session, date, slots, current_user.id)
