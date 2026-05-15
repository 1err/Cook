"""User-scoped data access for friend library sharing.

Authorization (e.g., is_library_public gating, self-search exclusion) lives
in the route layer; these helpers just do the SQL.
"""
import uuid
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import RecipeModel, UserModel


async def search_public_library_user(
    session: AsyncSession,
    email: str,
    exclude_user_id: uuid.UUID,
) -> Optional[UserModel]:
    """Exact-email lookup that only returns users with a public library and not the caller.

    Returns None for: no match, library private, or self-match. The route turns
    None into a 404 — same response for all three cases to avoid enumeration leaks.
    """
    normalized = email.strip().lower()
    if not normalized:
        return None
    result = await session.execute(
        select(UserModel).where(UserModel.email == normalized)
    )
    user = result.scalars().one_or_none()
    if user is None:
        return None
    if user.id == exclude_user_id:
        return None
    if not bool(user.is_library_public):
        return None
    return user


async def get_user_by_id(
    session: AsyncSession, user_id: uuid.UUID
) -> Optional[UserModel]:
    """Lookup helper local to friend-library routes (avoids importing repo_auth)."""
    result = await session.execute(select(UserModel).where(UserModel.id == user_id))
    return result.scalars().one_or_none()


async def list_friend_library_recipes(
    session: AsyncSession, owner_user_id: uuid.UUID
) -> list[RecipeModel]:
    """All RecipeModel rows owned by owner_user_id, alphabetical by title.

    Authorization (owner.is_library_public) is enforced in the route layer,
    not here.
    """
    result = await session.execute(
        select(RecipeModel)
        .where(RecipeModel.user_id == owner_user_id)
        .order_by(func.lower(RecipeModel.title), RecipeModel.id)
    )
    return list(result.scalars().all())


async def copy_friend_recipe_to_user(
    session: AsyncSession,
    source_user_id: uuid.UUID,
    recipe_id: str,
    caller_user_id: uuid.UUID,
) -> Optional[RecipeModel]:
    """Clone a recipe from a public-library user into the caller's library.

    Returns None when:
      - source user doesn't exist or library isn't public
      - caller IS the source user (no self-copy)
      - source recipe doesn't exist or isn't owned by source_user_id

    Idempotent: if caller already has a row with catalog_source_recipe_id == recipe_id,
    that row is returned instead of inserting a duplicate.
    """
    if source_user_id == caller_user_id:
        return None

    owner = await get_user_by_id(session, source_user_id)
    if owner is None or not bool(owner.is_library_public):
        return None

    source_result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.id == recipe_id,
            RecipeModel.user_id == source_user_id,
        )
    )
    source = source_result.scalars().one_or_none()
    if source is None:
        return None

    existing_result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.user_id == caller_user_id,
            RecipeModel.catalog_source_recipe_id == recipe_id,
        )
    )
    existing = existing_result.scalars().one_or_none()
    if existing is not None:
        return existing

    clone = RecipeModel(
        id=uuid.uuid4().hex,
        user_id=caller_user_id,
        title=source.title,
        source_url=source.source_url,
        thumbnail_url=source.thumbnail_url,
        ingredients=source.ingredients,
        raw_extraction_text=source.raw_extraction_text,
        library_tags=source.library_tags,
        library_category=source.library_category,
        is_public_catalog=False,
        catalog_source_recipe_id=source.id,
        description=source.description,
        total_time_minutes=source.total_time_minutes,
        steps=source.steps,
        tips=source.tips,
        equipment=source.equipment,
    )
    session.add(clone)
    await session.flush()
    return clone
