"""
User and auth_identity repository. Used by auth router.
"""
import uuid
from typing import Optional

from sqlalchemy import func, select
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

async def create_user(session: AsyncSession, email: str, *, email_verification_required: bool = False) -> UserModel:
    user = UserModel(email=email.strip().lower(), email_verification_required=email_verification_required)
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

async def lock_account_erasure_barrier(session: AsyncSession) -> None:
    """Serialize rare erasures and shared-copy snapshots before user/child locks.

    Copies can reference another account's images, so taking individual account
    locks alone permits cross-account erasure deadlocks and late copied links.
    The transaction-scoped PostgreSQL advisory lock is shared across replicas.
    """
    if session.get_bind().dialect.name == "postgresql":
        await session.execute(select(func.pg_advisory_xact_lock(1128810054)))

async def lock_user_for_media_write(session: AsyncSession, user_id: uuid.UUID) -> bool:
    """Serialize the bounded storage write with account erasure across replicas."""
    result = await session.execute(select(UserModel.id).where(UserModel.id == user_id).with_for_update())
    return result.scalar_one_or_none() is not None

async def get_local_identity_for_user(session: AsyncSession, user_id: uuid.UUID) -> Optional[AuthIdentityModel]:
    result = await session.execute(select(AuthIdentityModel).where(
        AuthIdentityModel.user_id == user_id, AuthIdentityModel.provider == "local",
    ))
    return result.scalars().one_or_none()

async def ensure_account_not_erased(session: AsyncSession, account_id: str) -> None:
    """Serialize new paid/admission work with account erasure across replicas."""
    from fastapi import HTTPException
    from app.db.account_models import DeletedAccountModel
    try:
        owner_id = uuid.UUID(account_id)
    except (ValueError, TypeError, AttributeError):
        # Internal aggregate/accounting tests and legacy non-user scopes exist;
        # authenticated application account identities are always UUIDs.
        return
    await lock_account_erasure_barrier(session)
    erased = await session.execute(select(DeletedAccountModel.user_id).where(DeletedAccountModel.user_id == owner_id))
    if erased.scalar_one_or_none() is not None:
        raise HTTPException(401, "User not found")
