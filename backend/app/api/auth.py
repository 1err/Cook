"""
Auth router: register, login, logout, me. JWT in HttpOnly cookie.
OAuth-ready: local provider now; add Google etc. by new provider identities.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.db.session import get_session
from app.db import repo_auth
from app.db.models import UserModel

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "access_token"
COOKIE_PATH = "/"
COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days


class RegisterBody(BaseModel):
    email: EmailStr
    password: str


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: str
    email: str

    @classmethod
    def from_model(cls, u: UserModel) -> "UserResponse":
        return cls(id=str(u.id), email=u.email)


class AuthResponse(UserResponse):
    access_token: str | None = None

    @classmethod
    def from_model_with_token(cls, u: UserModel, token: str | None) -> "AuthResponse":
        return cls(id=str(u.id), email=u.email, access_token=token)


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


async def get_current_user(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> UserModel:
    """Dependency: read JWT from bearer header or cookie, validate, return user."""
    token = None
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    if auth_header:
        scheme, _, value = auth_header.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            token = value.strip()
    if token is None:
        token = request.cookies.get(COOKIE_NAME)
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
    return user


@router.post("/register", response_model=AuthResponse)
async def register(
    body: RegisterBody,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    """Create user + local identity, set JWT cookie."""
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    existing = await repo_auth.get_user_by_email(session, body.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = await repo_auth.create_user(session, body.email)
    await repo_auth.create_identity(
        session,
        user.id,
        provider="local",
        provider_user_id=body.email.strip().lower(),
        password_hash=hash_password(body.password),
    )
    token = create_access_token(str(user.id))
    _set_cookie(response, token)
    return AuthResponse.from_model_with_token(user, token)


@router.post("/login", response_model=AuthResponse)
async def login(
    body: LoginBody,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    """Verify local identity, set JWT cookie."""
    identity = await repo_auth.get_identity(
        session, provider="local", provider_user_id=body.email.strip().lower()
    )
    if not identity or not identity.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(body.password, identity.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    user = await repo_auth.get_user_by_id(session, identity.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    token = create_access_token(str(user.id))
    _set_cookie(response, token)
    return AuthResponse.from_model_with_token(user, token)


@router.post("/logout")
async def logout(response: Response):
    """Clear JWT cookie."""
    _clear_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=UserResponse)
async def me(current_user: UserModel = Depends(get_current_user)):
    """Return current authenticated user."""
    return UserResponse.from_model(current_user)