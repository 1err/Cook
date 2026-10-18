"""Recovery, verification and account lifecycle endpoints."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.abuse import account_limits
from app.api.auth import _clear_cookie, get_authenticated_user, presented_token, DeleteAccountBody
from app.core.config import settings
from app.core.security import BCRYPT_MAX_PASSWORD_BYTES, MAX_LOGIN_PASSWORD_CHARACTERS, decode_access_token, hash_password, verify_password
from app.db import repo_accounts
from app.db.models import AuthIdentityModel, UserModel
from app.db.session import get_session
from app.services.account_email import deliver_account_email, email_available

router = APIRouter(prefix="/auth", tags=["auth"])


class EmailBody(BaseModel):
    email: EmailStr


class TokenBody(BaseModel):
    token: str = Field(max_length=256)


class PasswordBody(BaseModel):
    password: str = Field(max_length=MAX_LOGIN_PASSWORD_CHARACTERS)


class ResetBody(TokenBody, PasswordBody):
    pass


def require_email():
    if not email_available():
        raise HTTPException(503, "Email delivery is not available yet. Please contact support.")


async def current_locked_user(request, session, current_user):
    user = await repo_accounts.lock_user(session, current_user.id)
    payload = decode_access_token(presented_token(request) or "")
    if user is None or not payload or payload.get("auth_version", 0) != user.auth_version:
        raise HTTPException(401, "Session expired. Please sign in again.")
    if await repo_accounts.is_token_revoked(session, presented_token(request) or ""):
        raise HTTPException(401, "Session expired. Please sign in again.")
    return user


@router.get("/capabilities")
async def capabilities():
    available = email_available()
    return {"password_recovery": available, "email_verification": available}


@router.post("/password-reset/request")
async def request_reset(body: EmailBody, request: Request, background: BackgroundTasks,
                        session: AsyncSession = Depends(get_session)):
    await account_limits(request, "reset", str(body.email))
    require_email()
    email = str(body.email).strip().lower()
    user = (await session.execute(select(UserModel).join(AuthIdentityModel).where(
        UserModel.email == email, AuthIdentityModel.provider == "local"))).scalar_one_or_none()
    if user is not None:
        token = await repo_accounts.issue_action_token(session, user.id, "reset", settings.PASSWORD_RESET_TTL_SECONDS)
        # Commit the hashed token before dispatching a background delivery.
        await session.commit()
        if token:
            background.add_task(deliver_account_email, email, "reset", token)
    return {"ok": True}


@router.post("/password-reset/confirm")
async def confirm_reset(body: ResetBody, request: Request, session: AsyncSession = Depends(get_session)):
    await account_limits(request, "confirm")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if len(body.password.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        raise HTTPException(400, "Password must be at most 72 UTF-8 bytes")
    password_hash = await run_in_threadpool(hash_password, body.password)
    if not await repo_accounts.reset_password(session, body.token, password_hash):
        raise HTTPException(400, "This link is invalid or has expired. Request a new link.")
    return {"ok": True}


@router.post("/email-verification/request")
async def request_verification(request: Request, background: BackgroundTasks,
                               session: AsyncSession = Depends(get_session),
                               current_user: UserModel = Depends(get_authenticated_user)):
    await account_limits(request, "verify", current_user.email)
    require_email()
    user = await current_locked_user(request, session, current_user)
    if not user.email_verified:
        token = await repo_accounts.issue_action_token(session, user.id, "verify", settings.EMAIL_VERIFICATION_TTL_SECONDS)
        email = user.email
        await session.commit()
        if token:
            background.add_task(deliver_account_email, email, "verify", token)
    return {"ok": True}


@router.post("/email-verification/confirm")
async def confirm_verification(body: TokenBody, request: Request, session: AsyncSession = Depends(get_session)):
    await account_limits(request, "confirm")
    if not await repo_accounts.verify_email(session, body.token):
        raise HTTPException(400, "This link is invalid or has expired. Request a new link.")
    return {"ok": True}


@router.post("/logout-all")
async def logout_all(request: Request, response: Response, session: AsyncSession = Depends(get_session),
                     current_user: UserModel = Depends(get_authenticated_user)):
    await account_limits(request, "confirm")
    user = await current_locked_user(request, session, current_user)
    user.auth_version += 1
    await session.flush()
    if request.headers.get("X-Chef-World-Account-ID") is None:
        _clear_cookie(response)
    return {"ok": True}


@router.delete("/account")
async def delete_account(body: DeleteAccountBody, request: Request, response: Response,
                         session: AsyncSession = Depends(get_session),
                         current_user: UserModel = Depends(get_authenticated_user)):
    await account_limits(request, "confirm")
    from app.api.auth import delete_me
    # The shared path verifies Google before taking the erasure barrier, then
    # locks and rechecks the current session before either credential can erase.
    return await delete_me(body, response, request, session, current_user)
