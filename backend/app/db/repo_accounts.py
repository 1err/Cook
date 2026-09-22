"""Transactional account lifecycle; PostgreSQL locks serialize token/session mutations."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert

from app.db.account_models import AccountActionTokenModel, RevokedSessionModel
from app.db.models import AuthIdentityModel, UserModel


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def lock_user(session, user_id):
    return (await session.execute(select(UserModel).where(UserModel.id == user_id)
        .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()


async def issue_action_token(session, user_id, purpose: str, ttl_seconds: int) -> str | None:
    user = await lock_user(session, user_id)
    if user is None:
        return None
    # A new request replaces earlier links for this purpose; reset confirmation
    # deletes every remaining link under this same account lock.
    await session.execute(delete(AccountActionTokenModel).where(
        AccountActionTokenModel.user_id == user_id, AccountActionTokenModel.purpose == purpose))
    token = secrets.token_urlsafe(32)
    now = (await session.execute(select(func.clock_timestamp()))).scalar_one()
    session.add(AccountActionTokenModel(token_hash=token_digest(token), user_id=user_id,
        purpose=purpose, expires_at=now + timedelta(seconds=ttl_seconds)))
    await session.flush()
    return token


async def consume_action_token(session, token: str, purpose: str):
    digest = token_digest(token)
    user_id = (await session.execute(select(AccountActionTokenModel.user_id).where(
        AccountActionTokenModel.token_hash == digest, AccountActionTokenModel.purpose == purpose))).scalar_one_or_none()
    if user_id is None:
        return None
    user = await lock_user(session, user_id)
    if user is None:
        return None
    consumed = (await session.execute(delete(AccountActionTokenModel).where(
        AccountActionTokenModel.token_hash == digest, AccountActionTokenModel.purpose == purpose,
        AccountActionTokenModel.expires_at > func.clock_timestamp()).returning(AccountActionTokenModel.user_id))).scalar_one_or_none()
    return user if consumed is not None else None


async def reset_password(session, token: str, password_hash: str) -> bool:
    user = await consume_action_token(session, token, "reset")
    if user is None:
        return False
    identity = (await session.execute(select(AuthIdentityModel).where(
        AuthIdentityModel.user_id == user.id, AuthIdentityModel.provider == "local"))).scalar_one_or_none()
    if identity is None:
        return False
    identity.password_hash = password_hash
    user.auth_version += 1
    await session.execute(delete(AccountActionTokenModel).where(AccountActionTokenModel.user_id == user.id))
    await session.flush()
    return True


async def verify_email(session, token: str) -> bool:
    user = await consume_action_token(session, token, "verify")
    if user is None:
        return False
    user.email_verified = True
    await session.flush()
    return True


async def revoke_token(session, user_id, token: str, expiry: int) -> None:
    await session.execute(insert(RevokedSessionModel).values(
        token_hash=token_digest(token), user_id=user_id,
        expires_at=datetime.fromtimestamp(expiry, timezone.utc)).on_conflict_do_nothing())


async def is_token_revoked(session, token: str) -> bool:
    return (await session.get(RevokedSessionModel, token_digest(token))) is not None


async def prune_expired_auth(session) -> None:
    # Worker batches prevent unbounded deletion transactions after downtime.
    for model in (AccountActionTokenModel, RevokedSessionModel):
        expired = select(model.token_hash).where(model.expires_at <= func.clock_timestamp()).limit(500).with_for_update(skip_locked=True)
        await session.execute(delete(model).where(model.token_hash.in_(expired)))


async def lock_login_identity(session, email: str):
    # Lock the parent before reading the credential, matching reset/deletion.
    user_id = (await session.execute(select(UserModel.id).where(UserModel.email == email))).scalar_one_or_none()
    if user_id is None:
        return None, None
    user = await lock_user(session, user_id)
    if user is None:
        return None, None
    identity = (await session.execute(select(AuthIdentityModel).where(
        AuthIdentityModel.user_id == user_id, AuthIdentityModel.provider == "local")
        .execution_options(populate_existing=True))).scalar_one_or_none()
    return identity, user
