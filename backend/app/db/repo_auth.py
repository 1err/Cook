"""
User and auth_identity repository. Used by auth router.
"""
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import UserModel, AuthIdentityModel


async def get_user_by_id(session: AsyncSession, user_id: uuid.UUID) -> Optional[UserModel]:
    result = await session.execute(select(UserModel).where(UserModel.id == user_id))
    return result.scalars().one_or_none()


async def get_user_by_email(session: AsyncSession, email: str) -> Optional[UserModel]:
    result = await session.execute(select(UserModel).where(UserModel.email == email))
    return result.scalars().one_or_none()


async def get_identity(
    session: AsyncSession, provider: str, provider_user_id: str
) -> Optional[AuthIdentityModel]:
    result = await session.execute(
        select(AuthIdentityModel).where(
            AuthIdentityModel.provider == provider,
            AuthIdentityModel.provider_user_id == provider_user_id,
        )
    )
    return result.scalars().one_or_none()


async def create_user(session: AsyncSession, email: str) -> UserModel:
    user = UserModel(email=email.strip().lower())
    session.add(user)
    await session.flush()
    return user


async def create_identity(
    session: AsyncSession,
    user_id: uuid.UUID,
    provider: str,
    provider_user_id: str,
    password_hash: Optional[str] = None,
) -> AuthIdentityModel:
    identity = AuthIdentityModel(
        user_id=user_id,
        provider=provider,
        provider_user_id=provider_user_id,
        password_hash=password_hash,
    )
    session.add(identity)
    await session.flush()
    return identity
