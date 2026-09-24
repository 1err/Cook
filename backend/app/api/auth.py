"""
Auth router: register, login, logout, me. JWT in HttpOnly cookie.
OAuth-ready: local provider now; add Google etc. by new provider identities.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.admin import is_admin
from app.core.config import settings
from app.api.abuse import enforce_auth_limits
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

    @classmethod
    def from_model(cls, u: UserModel) -> "UserResponse":
        return cls(
            id=str(u.id), email=u.email, is_library_public=bool(u.is_library_public),
            is_admin=is_admin(u),
            email_verified=bool(getattr(u, "email_verified", False)),
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


async def get_current_user(
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
    version = payload.get("auth_version", 0)
    if (not isinstance(version, int) or isinstance(version, bool)
            or version != user.auth_version or await repo_accounts.is_token_revoked(session, token)):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    request.state.analytics_user_id = user.id
    return user


@router.post("/register", response_model=AuthResponse)
async def register(
    body: RegisterBody,
    response: Response,
    session: AsyncSession = Depends(get_session),
    request: Request = None,
):
    """Create user + local identity, set JWT cookie."""
    await enforce_auth_limits(request, str(body.email), registration=True)
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if len(body.password.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        raise HTTPException(status_code=400, detail="Password must be at most 72 UTF-8 bytes")
    email = body.email.strip().lower()
    existing = await repo_auth.get_user_by_email(session, email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    password_hash = await run_in_threadpool(hash_password, body.password)
    try:
        user = await repo_auth.create_user(session, email)
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
    token = create_access_token(str(user.id), {"auth_version": user.auth_version})
    _set_cookie(response, token)
    if request is not None:
        request.state.analytics_user_id = user.id
    return AuthResponse.from_model_with_token(user, token)


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
    if payload and "sub" in payload and isinstance(payload.get("exp"), (int, float)):
        try:
            user_id = uuid.UUID(payload["sub"])
        except (TypeError, ValueError):
            user_id = None
        if user_id is not None and await repo_accounts.lock_user(session, user_id) is not None:
            await repo_accounts.revoke_token(session, user_id, token, payload["exp"])
    _clear_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=UserResponse)
async def me(current_user: UserModel = Depends(get_current_user)):
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
    current_user.is_library_public = bool(body.is_public)
    await session.flush()
    return LibraryVisibilityResponse(is_library_public=current_user.is_library_public)
