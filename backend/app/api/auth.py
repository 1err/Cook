"""
Local and Google authentication, preserving verified email and revocable sessions.
"""
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.admin import is_admin
from app.core.config import settings
from app.api.abuse import account_limits, enforce_auth_limits, enforce_limits, private_scope
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
from app.services import google_auth_service as google_auth
from app.db.repo_request_limits import RequestLimit

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
    has_password: bool = True

    @classmethod
    def from_model(cls, u: UserModel, *, has_password: bool = True) -> "UserResponse":
        return cls(
            id=str(u.id), email=u.email, is_library_public=bool(u.is_library_public),
            is_admin=is_admin(u),
            email_verified=bool(getattr(u, "email_verified", False)),
            email_verification_required=bool(getattr(u, "email_verification_required", False)),
            has_password=has_password,
        )


class AuthResponse(UserResponse):
    access_token: str | None = None

    @classmethod
    def from_model_with_token(
        cls, u: UserModel, token: str | None, *, has_password: bool = True,
    ) -> "AuthResponse":
        return cls(
            id=str(u.id),
            email=u.email,
            is_library_public=bool(u.is_library_public),
            is_admin=is_admin(u),
            email_verified=bool(getattr(u, "email_verified", False)),
            email_verification_required=bool(getattr(u, "email_verification_required", False)),
            has_password=has_password,
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


class GoogleConfigResponse(BaseModel):
    client_id: str | None


class GoogleNonceResponse(BaseModel):
    nonce: str


class GoogleLoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credential: str = Field(min_length=1, max_length=16384, repr=False)
    password: str | None = Field(None, min_length=1, max_length=MAX_LOGIN_PASSWORD_CHARACTERS, repr=False)


async def _google_auth_limits(request: Request, *, email: str | None = None, registration: bool = False) -> None:
    """Share production login, registration, global and IP admission scopes."""
    if not settings.ABUSE_LIMITS_ENABLED:
        return
    peer = request.client.host if request.client else "unknown"
    if email is None:
        limits = [
            RequestLimit("auth-global", 60, settings.AUTH_GLOBAL_PER_MINUTE),
            RequestLimit(private_scope("login-ip", peer), 60, settings.AUTH_LOGIN_IP_PER_MINUTE),
        ]
    elif registration:
        limits = [
            RequestLimit(private_scope("register-ip", peer), 3600, settings.AUTH_REGISTER_IP_PER_HOUR),
            RequestLimit(private_scope("register-account", email.strip().lower()), 3600, settings.AUTH_REGISTER_ACCOUNT_PER_HOUR),
        ]
    else:
        limits = [RequestLimit(private_scope("login-account", email.strip().lower()), 60, settings.AUTH_LOGIN_ACCOUNT_PER_MINUTE)]
    await enforce_limits(limits)


def _require_google_enabled() -> None:
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google sign-in is not configured yet.")


def _clear_google_challenge(response: Response) -> None:
    response.delete_cookie(
        google_auth.CHALLENGE_COOKIE_NAME,
        path=google_auth.CHALLENGE_COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
    )


async def _verified_google_identity(
    credential: str, request: Request, *, invalid_status: int = 401,
) -> google_auth.GoogleIdentity:
    _require_google_enabled()
    try:
        nonce = google_auth.challenge_nonce(request.cookies.get(google_auth.CHALLENGE_COOKIE_NAME))
        return await run_in_threadpool(google_auth.verify_credential, credential, nonce)
    except google_auth.InvalidGoogleCredential as exc:
        raise HTTPException(invalid_status, str(exc)) from exc
    except google_auth.GoogleUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/google/config", response_model=GoogleConfigResponse)
async def google_config(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return GoogleConfigResponse(client_id=settings.GOOGLE_CLIENT_ID or None)


@router.post("/google/nonce", response_model=GoogleNonceResponse)
async def google_nonce(request: Request, response: Response):
    _require_google_enabled()
    # Creating a challenge mutates the browser's sign-in state. Require a
    # trusted Origin even before an access cookie exists.
    trusted_origins = {item.strip() for item in settings.CORS_ALLOW_ORIGINS.split(",") if item.strip()}
    if request.headers.get("origin") not in trusted_origins:
        raise HTTPException(403, "Untrusted request origin")
    nonce, cookie = google_auth.create_challenge()
    response.set_cookie(
        google_auth.CHALLENGE_COOKIE_NAME, cookie,
        max_age=google_auth.CHALLENGE_LIFETIME_SECONDS,
        path=google_auth.CHALLENGE_COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
    )
    response.headers["Cache-Control"] = "no-store"
    return GoogleNonceResponse(nonce=nonce)


async def _resolve_google_account(
    session: AsyncSession, identity: google_auth.GoogleIdentity, password: str | None, request: Request,
) -> tuple[UserModel, bool, bool]:
    linked = await repo_auth.get_identity(session, "google", identity.subject)
    if linked is not None:
        user = await repo_accounts.lock_user(session, linked.user_id)
        if user is None:
            raise HTTPException(401, "User not found")
        local = await repo_auth.get_local_identity_for_user(session, user.id)
        if identity.email_authoritative and user.email == identity.email:
            user.email_verified = True
        return user, bool(local and local.password_hash), False

    user = await repo_auth.get_user_by_email(session, identity.email)
    new_account = user is None
    if new_account:
        if not identity.email_authoritative and not email_available():
            raise HTTPException(503, "Email verification is temporarily unavailable. Please try creating your account again later.")
        await _google_auth_limits(request, email=identity.email, registration=True)
        user = await repo_auth.create_user(session, identity.email, email_verification_required=True)
        user.email_verified = identity.email_authoritative
        has_password = False
    else:
        user = await repo_accounts.lock_user(session, user.id)
        if user is None:
            raise HTTPException(401, "User not found")
        # A matching email alone cannot prove ownership of an existing local
        # account: local registrations historically did not verify email.
        local = await repo_auth.get_local_identity_for_user(session, user.id)
        if local is None or not local.password_hash:
            raise HTTPException(409, detail={
                "code": "google_account_conflict",
                "message": "This email belongs to another sign-in account. Use its existing sign-in method.",
            })
        if password is None:
            raise HTTPException(409, detail={
                "code": "google_password_required",
                "message": "Enter your existing Chef World password once to connect Google to this account.",
            })
        if not await run_in_threadpool(verify_password, password, local.password_hash):
            raise HTTPException(403, "Incorrect password")
        has_password = True
        if identity.email_authoritative:
            user.email_verified = True
    await repo_auth.create_identity(session, user.id, "google", identity.subject)
    return user, has_password, new_account


@router.post("/google", response_model=AuthResponse)
async def google_login(
    body: GoogleLoginBody,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    _require_google_enabled()
    await _google_auth_limits(request)
    identity = await _verified_google_identity(body.credential, request)
    await _google_auth_limits(request, email=identity.email)
    # Concurrent first sign-ins may race on either email or provider subject.
    # Roll back the whole tentative account before looking up the winner;
    # no failed transaction or orphan account escapes this bounded retry.
    for attempt in range(2):
        try:
            user, has_password, new_account = await _resolve_google_account(session, identity, body.password, request)
            verification_token = None
            if new_account and not user.email_verified:
                await account_limits(request, "verify", user.email)
                verification_token = await repo_accounts.issue_action_token(
                    session, user.id, "verify", settings.EMAIL_VERIFICATION_TTL_SECONDS)
                if verification_token is None:
                    raise HTTPException(503, "Account creation is temporarily unavailable. Please try again.")
            token = create_access_token(str(user.id), {"auth_version": user.auth_version})
            result = AuthResponse.from_model_with_token(user, token, has_password=has_password)
            await session.commit()
            break
        except IntegrityError as exc:
            await session.rollback()
            if attempt == 1:
                raise HTTPException(409, detail={
                    "code": "google_account_conflict",
                    "message": "The sign-in account changed. Start Google sign-in again.",
                }) from exc
    request.state.analytics_user_id = user.id
    if verification_token is not None:
        background.add_task(deliver_account_email, user.email, "verify", verification_token)
    _set_cookie(response, token)
    _clear_google_challenge(response)
    response.headers["Cache-Control"] = "no-store"
    return result


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
async def me(
    current_user: UserModel = Depends(get_authenticated_user),
    session: AsyncSession = Depends(get_session),
):
    """Return current authenticated user."""
    local = await repo_auth.get_local_identity_for_user(session, current_user.id)
    return UserResponse.from_model(current_user, has_password=bool(local and local.password_hash))


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
    password: str | None = Field(None, min_length=1, max_length=MAX_LOGIN_PASSWORD_CHARACTERS, repr=False)
    google_credential: str | None = Field(None, min_length=1, max_length=16384, repr=False)

    @model_validator(mode="after")
    def require_one_credential(self) -> "DeleteAccountBody":
        if (self.password is None) == (self.google_credential is None):
            raise ValueError("Provide either a password or Google reauthentication.")
        return self


@router.delete("/me")
async def delete_me(
    body: DeleteAccountBody,
    response: Response,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_authenticated_user),
):
    """Reauthenticate the current account, commit erasure, then clear its cookie."""
    google_identity = None
    if body.google_credential is not None:
        await _google_auth_limits(request)
        await _google_auth_limits(request, email=current_user.email)
        # Reauthentication failure does not revoke the existing app session.
        # Verify before taking the account-erasure barrier or account row lock.
        google_identity = await _verified_google_identity(body.google_credential, request, invalid_status=403)
    await repo_auth.lock_account_erasure_barrier(session)
    user = await repo_accounts.lock_user(session, current_user.id)
    payload = decode_access_token(presented_token(request) or "")
    if user is None or not payload or payload.get("auth_version", 0) != user.auth_version:
        raise HTTPException(401, "Session expired. Please sign in again.")
    if await repo_accounts.is_token_revoked(session, presented_token(request) or ""):
        raise HTTPException(401, "Session expired. Please sign in again.")
    if google_identity is not None:
        identity = await repo_auth.get_identity(session, "google", google_identity.subject)
        if identity is None or identity.user_id != user.id:
            raise HTTPException(403, "Use the Google account connected to this Chef World account.")
    else:
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
    if body.google_credential is not None:
        _clear_google_challenge(response)
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}
