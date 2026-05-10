"""User-scoped data access for friend library sharing.

Authorization (e.g., is_library_public gating, self-search exclusion) lives
in the route layer; these helpers just do the SQL.
"""
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import UserModel


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
