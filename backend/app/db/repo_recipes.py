"""
Recipe repository: async SQLAlchemy access. Maps DB rows to Pydantic Recipe.
All queries filter by user_id (multi-tenant).
"""
import json
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Recipe, IngredientItem
from app.db.models import RecipeModel


def _row_to_recipe(row: RecipeModel) -> Recipe:
    ingredients_data = json.loads(row.ingredients or "[]")
    return Recipe(
        id=row.id,
        title=row.title,
        source_url=row.source_url,
        thumbnail_url=row.thumbnail_url,
        ingredients=[IngredientItem(**i) for i in ingredients_data],
        raw_extraction_text=row.raw_extraction_text,
    )


async def save_recipe(session: AsyncSession, recipe: Recipe, user_id: uuid.UUID) -> Recipe:
    ingredients_json = json.dumps(
        [i.model_dump() if hasattr(i, "model_dump") else i for i in recipe.ingredients]
    )
    model = RecipeModel(
        id=recipe.id,
        user_id=user_id,
        title=recipe.title,
        source_url=recipe.source_url,
        thumbnail_url=recipe.thumbnail_url,
        ingredients=ingredients_json,
        raw_extraction_text=recipe.raw_extraction_text,
    )
    await session.merge(model)
    await session.flush()
    return recipe


async def get_recipe(session: AsyncSession, recipe_id: str, user_id: uuid.UUID) -> Optional[Recipe]:
    result = await session.execute(
        select(RecipeModel).where(RecipeModel.id == recipe_id, RecipeModel.user_id == user_id)
    )
    row = result.scalars().one_or_none()
    if not row:
        return None
    return _row_to_recipe(row)


async def list_recipes(session: AsyncSession, user_id: uuid.UUID) -> list[Recipe]:
    result = await session.execute(
        select(RecipeModel).where(RecipeModel.user_id == user_id).order_by(RecipeModel.id)
    )
    rows = list(result.scalars().all())
    return [_row_to_recipe(r) for r in rows]


async def delete_recipe(session: AsyncSession, recipe_id: str, user_id: uuid.UUID) -> bool:
    result = await session.execute(
        select(RecipeModel).where(RecipeModel.id == recipe_id, RecipeModel.user_id == user_id)
    )
    row = result.scalars().one_or_none()
    if not row:
        return False
    await session.delete(row)
    await session.flush()
    return True
