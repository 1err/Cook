"""
Meal plan repository: async SQLAlchemy access. Maps DB rows to Pydantic MealPlan.
All queries filter by user_id (multi-tenant).
"""
import json
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MealPlan
from app.db.models import MealPlanModel


async def get_meal_plans_in_range(
    session: AsyncSession, start_date: str, end_date: str, user_id: uuid.UUID
) -> list[MealPlan]:
    result = await session.execute(
        select(MealPlanModel)
        .where(
            MealPlanModel.user_id == user_id,
            MealPlanModel.date >= start_date,
            MealPlanModel.date <= end_date,
        )
        .order_by(MealPlanModel.date)
    )
    rows = result.scalars().all()
    return [
        MealPlan(
            id=row.date,
            date=row.date,
            recipe_ids=json.loads(row.recipe_ids or "[]"),
        )
        for row in rows
    ]


async def put_meal_plan(
    session: AsyncSession, date: str, recipe_ids: list[str], user_id: uuid.UUID
) -> MealPlan:
    model = MealPlanModel(date=date, user_id=user_id, recipe_ids=json.dumps(recipe_ids))
    await session.merge(model)
    await session.flush()
    return MealPlan(id=date, date=date, recipe_ids=recipe_ids)
