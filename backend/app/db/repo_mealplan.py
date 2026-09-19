"""
Meal plan repository: async SQLAlchemy access. Maps DB rows to Pydantic MealPlan.
All queries filter by user_id (multi-tenant).
"""
import json
import uuid
from datetime import date as CalendarDate
from sqlalchemy import select, update, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MealPlan, normalize_meal_plan_slots
from app.db.models import MealPlanModel


MAX_MEAL_PLAN_RANGE_DAYS = 31
MAX_RECIPES_PER_SLOT = 100


class MealPlanConflict(ValueError):
    """The date has changed since the caller's last read."""


def validate_meal_plan_range(start_date: str, end_date: str) -> None:
    start, end = CalendarDate.fromisoformat(start_date), CalendarDate.fromisoformat(end_date)
    if start > end:
        raise ValueError("Start date must not be after end date")
    if (end - start).days >= MAX_MEAL_PLAN_RANGE_DAYS:
        raise ValueError("Choose a date range of 31 days or fewer")


async def get_meal_plans_in_range(
    session: AsyncSession, start_date: str, end_date: str, user_id: uuid.UUID
) -> list[MealPlan]:
    validate_meal_plan_range(start_date, end_date)
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
                revision=row.revision,
                breakfast=slots["breakfast"],
                lunch=slots["lunch"],
                dinner=slots["dinner"],
            )
        )
    return out


async def put_meal_plan(
    session: AsyncSession, date: str, slots: dict[str, list[str]], user_id: uuid.UUID,
    expected_revision: int | None = None,
) -> MealPlan:
    CalendarDate.fromisoformat(date)
    if expected_revision is not None and expected_revision < 0:
        raise ValueError("Revision cannot be negative")
    if any(len(ids) > MAX_RECIPES_PER_SLOT or any(not isinstance(id, str) or len(id) > 255 for id in ids) for ids in slots.values()):
        raise ValueError("A meal can contain at most 100 recipe IDs of 255 characters or fewer")
    normalized = normalize_meal_plan_slots(slots)
    payload = json.dumps(normalized)
    table = MealPlanModel
    if expected_revision is not None and expected_revision > 0:
        statement = update(table).where(table.user_id == user_id, table.date == date, table.revision == expected_revision).values(recipe_ids=payload, revision=table.revision + 1)
    else:
        statement = insert(table).values(user_id=user_id, date=date, recipe_ids=payload, revision=1)
        if expected_revision == 0:
            statement = statement.on_conflict_do_nothing(index_elements=[table.user_id, table.date])
        else:
            # Deprecated legacy writes remain last-write-wins but invalidate modern readers.
            statement = statement.on_conflict_do_update(index_elements=[table.user_id, table.date], set_={"recipe_ids": statement.excluded.recipe_ids, "revision": table.revision + 1})
    result = await session.execute(statement.returning(table.revision))
    revision = result.scalar_one_or_none()
    if revision is None:
        raise MealPlanConflict("Your plan changed on another device. Refresh and try your change again.")
    return MealPlan(id=date, date=date, revision=revision, **normalized)


async def remove_recipe_id_from_user_plans(
    session: AsyncSession, user_id: uuid.UUID, recipe_id: str
) -> None:
    """Strip a recipe ID out of every slot of every meal plan owned by user_id.

    Called after a recipe is deleted so the planner doesn't show stale chips
    that 404 on tap. Updates rows in place; only writes rows that actually
    referenced the recipe.
    """
    # A single UPDATE transforms the latest locked row, so concurrent edits are
    # never overwritten by a stale Python read/modify/write. Match only affected
    # dates; do not materialize an account's entire planner history.
    await session.execute(text("""
        UPDATE meal_plan
        SET recipe_ids = jsonb_build_object(
            'breakfast', CASE WHEN jsonb_typeof(recipe_ids::jsonb) = 'array' THEN '[]'::jsonb ELSE COALESCE(recipe_ids::jsonb->'breakfast', '[]'::jsonb) - :recipe_id END,
            'lunch', CASE WHEN jsonb_typeof(recipe_ids::jsonb) = 'array' THEN '[]'::jsonb ELSE COALESCE(recipe_ids::jsonb->'lunch', '[]'::jsonb) - :recipe_id END,
            'dinner', CASE WHEN jsonb_typeof(recipe_ids::jsonb) = 'array' THEN recipe_ids::jsonb - :recipe_id ELSE COALESCE(recipe_ids::jsonb->'dinner', recipe_ids::jsonb->'recipe_ids', '[]'::jsonb) - :recipe_id END
        )::text, revision = revision + 1
        WHERE user_id = :user_id AND (
            recipe_ids::jsonb @> CAST(:legacy AS jsonb) OR
            recipe_ids::jsonb @> CAST(:breakfast AS jsonb) OR
            recipe_ids::jsonb @> CAST(:lunch AS jsonb) OR
            recipe_ids::jsonb @> CAST(:dinner AS jsonb) OR
            recipe_ids::jsonb @> CAST(:old_object AS jsonb)
        )
    """), {"user_id": user_id, "recipe_id": recipe_id, "legacy": json.dumps([recipe_id]),
           "breakfast": json.dumps({"breakfast": [recipe_id]}), "lunch": json.dumps({"lunch": [recipe_id]}),
           "dinner": json.dumps({"dinner": [recipe_id]}), "old_object": json.dumps({"recipe_ids": [recipe_id]})})
