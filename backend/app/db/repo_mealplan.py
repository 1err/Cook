"""
Meal plan repository: async SQLAlchemy access. Maps DB rows to Pydantic MealPlan.
All queries filter by user_id (multi-tenant).
"""
import json
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MealPlan, normalize_meal_plan_slots
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
    out: list[MealPlan] = []
    for row in rows:
        slots = normalize_meal_plan_slots(json.loads(row.recipe_ids or "[]"))
        out.append(
            MealPlan(
                id=row.date,
                date=row.date,
                breakfast=slots["breakfast"],
                lunch=slots["lunch"],
                dinner=slots["dinner"],
            )
        )
    return out


async def put_meal_plan(
    session: AsyncSession, date: str, slots: dict[str, list[str]], user_id: uuid.UUID
) -> MealPlan:
    normalized = normalize_meal_plan_slots(slots)
    model = MealPlanModel(date=date, user_id=user_id, recipe_ids=json.dumps(normalized))
    await session.merge(model)
    await session.flush()
    return MealPlan(id=date, date=date, **normalized)


async def remove_recipe_id_from_user_plans(
    session: AsyncSession, user_id: uuid.UUID, recipe_id: str
) -> None:
    """Strip a recipe ID out of every slot of every meal plan owned by user_id.

    Called after a recipe is deleted so the planner doesn't show stale chips
    that 404 on tap. Updates rows in place; only writes rows that actually
    referenced the recipe.
    """
    result = await session.execute(
        select(MealPlanModel).where(MealPlanModel.user_id == user_id)
    )
    for row in result.scalars().all():
        slots = normalize_meal_plan_slots(json.loads(row.recipe_ids or "[]"))
        changed = False
        for key in ("breakfast", "lunch", "dinner"):
            ids = slots.get(key, [])
            if recipe_id in ids:
                slots[key] = [rid for rid in ids if rid != recipe_id]
                changed = True
        if changed:
            row.recipe_ids = json.dumps(slots)
    await session.flush()
