"""
Auth router: register, login, logout, me. JWT in HttpOnly cookie.
OAuth-ready: local provider now; add Google etc. by new provider identities.
"""
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.admin import is_admin
from app.core.config import settings
from app.api.abuse import account_limits, enforce_auth_limits
from app.core.security import (
    BCRYPT_MAX_PASSWORD_BYTES,
    MAX_LOGIN_PASSWORD_CHARACTERS,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.db.session import get_session
from app.db import repo_auth, repo_accounts
from app.db.models import UserModel
from app.db.repo_account_deletion import delete_account
from app.services.account_email import deliver_account_email, email_available

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "access_token"
COOKIE_PATH = "/"
COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days


class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(max_length=MAX_LOGIN_PASSWORD_CHARACTERS)


class LoginBody(BaseModel):
    email: EmailStr
    password: str = Field(max_length=MAX_LOGIN_PASSWORD_CHARACTERS)


class UserResponse(BaseModel):
    id: str
    email: str
    is_library_public: bool
    is_admin: bool = False
    email_verified: bool = False
    email_verification_required: bool = False

    @classmethod
    def from_model(cls, u: UserModel) -> "UserResponse":
        return cls(
            id=str(u.id), email=u.email, is_library_public=bool(u.is_library_public),
            is_admin=is_admin(u),
            email_verified=bool(getattr(u, "email_verified", False)),
            email_verification_required=bool(getattr(u, "email_verification_required", False)),
        )


class AuthResponse(UserResponse):
    access_token: str | None = None

    @classmethod
    def from_model_with_token(cls, u: UserModel, token: str | None) -> "AuthResponse":
        return cls(
            id=str(u.id),
            email=u.email,
            is_library_public=bool(u.is_library_public),
            is_admin=is_admin(u),
            email_verified=bool(getattr(u, "email_verified", False)),
            email_verification_required=bool(getattr(u, "email_verification_required", False)),
            access_token=token,
        )


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path=COOKIE_PATH,
    )


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(
        key=COOKIE_NAME,
        path=COOKIE_PATH,
        httponly=True,
        samesite=settings.COOKIE_SAMESITE,
        secure=settings.COOKIE_SECURE,
    )


def presented_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization")
    if auth_header:
        scheme, _, value = auth_header.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
    return request.cookies.get(COOKIE_NAME)


async def get_authenticated_user(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> UserModel:
    """Accept unrevoked JWTs of this account's current generation only."""
    token = presented_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    try:
        user_id = uuid.UUID(payload["sub"])
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await repo_auth.get_user_by_id(session, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    expected_account_id = request.headers.get("X-Chef-World-Account-ID")
    if expected_account_id is not None and expected_account_id != str(user.id):
        raise HTTPException(409, "The signed-in account changed. Review the current account before continuing.")
    version = payload.get("auth_version", 0)
    if (not isinstance(version, int) or isinstance(version, bool)
            or version != user.auth_version or await repo_accounts.is_token_revoked(session, token)):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    request.state.analytics_user_id = user.id
    return user


async def get_current_user(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> UserModel:
    """App access requires verified email for accounts enrolled at registration."""
    user = await get_authenticated_user(request, session)
    if user.email_verification_required and not user.email_verified:
        raise HTTPException(status_code=403, detail={
            "code": "email_verification_required",
            "message": "Verify your email address before using the app.",
        })
    return user


@router.post("/register", response_model=AuthResponse)
async def register(
    body: RegisterBody,
    response: Response,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    request: Request = None,
):
    """Create a restricted account and queue verification after durable commit."""
    await enforce_auth_limits(request, str(body.email), registration=True)
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if len(body.password.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        raise HTTPException(status_code=400, detail="Password must be at most 72 UTF-8 bytes")
    email = body.email.strip().lower()
    existing = await repo_auth.get_user_by_email(session, email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    if not email_available():
        raise HTTPException(503, "Email verification is temporarily unavailable. Please try creating your account again later.")
    await account_limits(request, "verify", email)
    password_hash = await run_in_threadpool(hash_password, body.password)
    try:
        user = await repo_auth.create_user(session, email, email_verification_required=True)
        await repo_auth.create_identity(
            session,
            user.id,
            provider="local",
            provider_user_id=email,
            password_hash=password_hash,
        )
    except IntegrityError as exc:
        if getattr(exc.orig, "sqlstate", None) == "23505":
            raise HTTPException(status_code=400, detail="Email already registered") from exc
        raise
    verification_token = await repo_accounts.issue_action_token(
        session, user.id, "verify", settings.EMAIL_VERIFICATION_TTL_SECONDS)
    if verification_token is None:
        raise HTTPException(503, "Account creation is temporarily unavailable. Please try again.")
    token = create_access_token(str(user.id), {"auth_version": user.auth_version})
    result = AuthResponse.from_model_with_token(user, token)
    # Background dispatch can run before dependency teardown: commit explicitly.
    await session.commit()
    background.add_task(deliver_account_email, email, "verify", verification_token)
    _set_cookie(response, token)
    if request is not None:
        request.state.analytics_user_id = user.id
    return result


@router.post("/login", response_model=AuthResponse)
async def login(
    body: LoginBody,
    response: Response,
    session: AsyncSession = Depends(get_session),
    request: Request = None,
):
    """Verify local identity, set JWT cookie."""
    await enforce_auth_limits(request, str(body.email), registration=False)
    identity, user = await repo_accounts.lock_login_identity(session, body.email.strip().lower())
    if (identity is None or user is None or not identity.password_hash
            or not await run_in_threadpool(verify_password, body.password, identity.password_hash)):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(str(user.id), {"auth_version": user.auth_version})
    _set_cookie(response, token)
    if request is not None:
        request.state.analytics_user_id = user.id
    return AuthResponse.from_model_with_token(user, token)


@router.post("/logout")
async def logout(response: Response, request: Request, session: AsyncSession = Depends(get_session)):
    """Revoke the presented session as well as clearing its browser cookie."""
    token = presented_token(request)
    payload = decode_access_token(token) if token else None
    expected_account_id = request.headers.get("X-Chef-World-Account-ID")
    if expected_account_id is not None and payload and "sub" in payload and expected_account_id != str(payload["sub"]):
        raise HTTPException(409, "The signed-in account changed. Review the current account before continuing.")
    if payload and "sub" in payload and isinstance(payload.get("exp"), (int, float)):
        try:
            user_id = uuid.UUID(payload["sub"])
        except (TypeError, ValueError):
            user_id = None
        if user_id is not None and await repo_accounts.lock_user(session, user_id) is not None:
            await repo_accounts.revoke_token(session, user_id, token, payload["exp"])
    if request.headers.get("X-Chef-World-Account-ID") is None:
        _clear_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=UserResponse)
async def me(current_user: UserModel = Depends(get_authenticated_user)):
    """Return current authenticated user."""
    return UserResponse.from_model(current_user)


class LibraryVisibilityBody(BaseModel):
    is_public: bool


class LibraryVisibilityResponse(BaseModel):
    is_library_public: bool


@router.post("/library-visibility", response_model=LibraryVisibilityResponse)
async def set_library_visibility(
    body: LibraryVisibilityBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Flip the current user's library-public flag."""
    # Use the current locked row so a concurrent account erasure cannot be
    # bypassed by the authentication dependency's earlier snapshot.
    user = (await session.execute(select(UserModel).where(UserModel.id == current_user.id)
                                  .with_for_update().execution_options(populate_existing=True))).scalars().one_or_none()
    if user is None:
        raise HTTPException(401, "User not found")
    user.is_library_public = bool(body.is_public)
    await session.flush()
    return LibraryVisibilityResponse(is_library_public=user.is_library_public)



class DeleteAccountBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=MAX_LOGIN_PASSWORD_CHARACTERS)


@router.delete("/me")
async def delete_me(
    body: DeleteAccountBody,
    response: Response,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_authenticated_user),
):
    """Reauthenticate the current account, commit erasure, then clear its cookie."""
    await repo_auth.lock_account_erasure_barrier(session)
    user = await repo_accounts.lock_user(session, current_user.id)
    payload = decode_access_token(presented_token(request) or "")
    if user is None or not payload or payload.get("auth_version", 0) != user.auth_version:
        raise HTTPException(401, "Session expired. Please sign in again.")
    if await repo_accounts.is_token_revoked(session, presented_token(request) or ""):
        raise HTTPException(401, "Session expired. Please sign in again.")
    identity = await repo_auth.get_local_identity_for_user(session, user.id)
    if not identity or not identity.password_hash:
        raise HTTPException(403, "Password verification is unavailable for this account")
    if not await run_in_threadpool(verify_password, body.password, identity.password_hash):
        raise HTTPException(403, "Incorrect password")
    if not await delete_account(session, current_user.id):
        raise HTTPException(401, "User not found")
    # The response cannot report success while the account or cleanup intent is
    # uncommitted. Storage failures later never restore the deleted account.
    await session.commit()
    # A header-bound browser may have logged another account in while deletion
    # ran. Its newer cookie must not be overwritten by this older response.
    # The deleted account's existing cookie is unusable through user lookup.
    if request.headers.get("X-Chef-World-Account-ID") is None:
        _clear_cookie(response)
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}
