"""
Meal plan routes. Uses repo only. All require auth.
"""
from datetime import date as CalendarDate
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db.session import get_session
from app.db import repo_mealplan
from app.db.models import UserModel
from app.models import MealPlan, normalize_meal_plan_slots

router = APIRouter(prefix="/meal-plan", tags=["meal-plan"])


RecipeId = Annotated[str, Field(min_length=1, max_length=255)]


class MealPlanPutBody(BaseModel):
    expected_revision: int | None = Field(None, ge=0, description="Send the revision last read, or 0 for an absent day. Omission is deprecated legacy last-write-wins.")
    recipe_ids: list[RecipeId] | None = Field(None, max_length=100)
    breakfast: list[RecipeId] = Field(default_factory=list, max_length=100)
    lunch: list[RecipeId] = Field(default_factory=list, max_length=100)
    dinner: list[RecipeId] = Field(default_factory=list, max_length=100)


@router.get("", response_model=list[MealPlan])
async def meal_plan_list(
    start: CalendarDate,
    end: CalendarDate,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Get meal plans for dates in [start, end] (YYYY-MM-DD inclusive)."""
    try:
        repo_mealplan.validate_meal_plan_range(start.isoformat(), end.isoformat())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return await repo_mealplan.get_meal_plans_in_range(session, start.isoformat(), end.isoformat(), current_user.id)


@router.put("/{date}", response_model=MealPlan)
async def meal_plan_put(
    date: CalendarDate,
    body: MealPlanPutBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
    request: Request = None,
):
    """Create or update meal plan for the given date (YYYY-MM-DD)."""
    slots = normalize_meal_plan_slots(body.model_dump(exclude_none=True, exclude_unset=True))
    if request is not None and not any(slots.values()):
        request.state.analytics_skip = True
    try:
        return await repo_mealplan.put_meal_plan(session, date.isoformat(), slots, current_user.id, expected_revision=body.expected_revision)
    except repo_mealplan.MealPlanConflict as exc:
        raise HTTPException(409, {"code": "meal_plan_conflict", "message": str(exc)}) from exc
