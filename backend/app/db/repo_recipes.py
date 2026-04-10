"""
Recipe repository: async SQLAlchemy access. Maps DB rows to Pydantic Recipe.
All queries filter by user_id (multi-tenant).
"""
import json
import uuid
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Recipe, IngredientItem, coerce_library_tags
from app.db.models import RecipeModel


def _row_to_recipe(row: RecipeModel) -> Recipe:
    ingredients_data = json.loads(row.ingredients or "[]")
    raw_tags = json.loads(row.library_tags or "[]") if getattr(row, "library_tags", None) else []
    normalized_tags = coerce_library_tags(raw_tags or row.library_category)
    return Recipe(
        id=row.id,
        title=row.title,
        source_url=row.source_url,
        thumbnail_url=row.thumbnail_url,
        ingredients=[IngredientItem(**i) for i in ingredients_data],
        raw_extraction_text=row.raw_extraction_text,
        library_tags=normalized_tags,
        library_category=normalized_tags[0] if normalized_tags else None,
        is_public_catalog=row.is_public_catalog,
        catalog_source_recipe_id=row.catalog_source_recipe_id,
    )


async def save_recipe(session: AsyncSession, recipe: Recipe, user_id: uuid.UUID) -> Recipe:
    ingredients_json = json.dumps(
        [i.model_dump() if hasattr(i, "model_dump") else i for i in recipe.ingredients]
    )
    tags = coerce_library_tags(getattr(recipe, "library_tags", None) or recipe.library_category)
    model = RecipeModel(
        id=recipe.id,
        user_id=user_id,
        title=recipe.title,
        source_url=recipe.source_url,
        thumbnail_url=recipe.thumbnail_url,
        ingredients=ingredients_json,
        raw_extraction_text=recipe.raw_extraction_text,
        library_tags=json.dumps(tags),
        library_category=tags[0] if tags else None,
        is_public_catalog=recipe.is_public_catalog,
        catalog_source_recipe_id=recipe.catalog_source_recipe_id,
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
        select(RecipeModel)
        .where(RecipeModel.user_id == user_id)
        .order_by(func.lower(RecipeModel.title), RecipeModel.id)
    )
    rows = list(result.scalars().all())
    return [_row_to_recipe(r) for r in rows]


async def list_public_recipes(session: AsyncSession) -> list[Recipe]:
    result = await session.execute(
        select(RecipeModel)
        .where(RecipeModel.is_public_catalog.is_(True))
        .order_by(func.lower(RecipeModel.title), RecipeModel.id)
    )
    rows = list(result.scalars().all())
    return [_row_to_recipe(r) for r in rows]


async def get_public_recipe(session: AsyncSession, recipe_id: str) -> Optional[Recipe]:
    result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.id == recipe_id,
            RecipeModel.is_public_catalog.is_(True),
        )
    )
    row = result.scalars().one_or_none()
    if not row:
        return None
    return _row_to_recipe(row)


async def set_recipe_public_catalog(
    session: AsyncSession, recipe_id: str, user_id: uuid.UUID, is_public: bool
) -> Optional[Recipe]:
    result = await session.execute(
        select(RecipeModel).where(RecipeModel.id == recipe_id, RecipeModel.user_id == user_id)
    )
    row = result.scalars().one_or_none()
    if not row:
        return None
    row.is_public_catalog = bool(is_public)
    await session.flush()
    return _row_to_recipe(row)


async def copy_public_recipe_to_user(
    session: AsyncSession, recipe_id: str, user_id: uuid.UUID
) -> Optional[Recipe]:
    result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.id == recipe_id,
            RecipeModel.is_public_catalog.is_(True),
        )
    )
    source = result.scalars().one_or_none()
    if not source:
        return None

    if source.user_id == user_id:
        return _row_to_recipe(source)

    existing_result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.user_id == user_id,
            RecipeModel.catalog_source_recipe_id == recipe_id,
        )
    )
    existing = existing_result.scalars().one_or_none()
    if existing:
        return _row_to_recipe(existing)

    clone = RecipeModel(
        id=str(uuid.uuid4()),
        user_id=user_id,
        title=source.title,
        source_url=source.source_url,
        thumbnail_url=source.thumbnail_url,
        ingredients=source.ingredients,
        raw_extraction_text=source.raw_extraction_text,
        library_tags=source.library_tags,
        library_category=source.library_category,
        is_public_catalog=False,
        catalog_source_recipe_id=source.id,
    )
    session.add(clone)
    await session.flush()
    return _row_to_recipe(clone)


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
