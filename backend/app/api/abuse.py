"""Admission for expensive authentication and storage operations."""
import hashlib
import hmac
import logging

from fastapi import HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.db.repo_request_limits import RequestLimit, RequestLimitExceeded, reserve_with_factory
from app.db.repo_upload_budget import UploadAllowanceExceeded, reserve_upload_allowance

logger = logging.getLogger(__name__)


def private_scope(kind: str, value: str) -> str:
    key = (settings.AUTH_SECRET or "local-development-only").encode()
    return kind + ":" + hmac.new(key, value.encode(), hashlib.sha256).hexdigest()


async def enforce_limits(limits: list[RequestLimit]) -> None:
    try:
        await reserve_with_factory(limits)
    except RequestLimitExceeded as exc:
        raise HTTPException(429, str(exc), headers={"Retry-After": str(exc.retry_after)}) from None
    except SQLAlchemyError:
        logger.warning("request_limit_admission_unavailable")
        raise HTTPException(503, "Service is temporarily unavailable.", headers={"Retry-After": "30"}) from None


async def enforce_auth_limits(request: Request | None, email: str, *, registration: bool) -> None:
    if not settings.ABUSE_LIMITS_ENABLED:
        return
    # Only the ASGI server's trusted client is used. Raw forwarded headers are
    # attacker controlled; trusted proxy configuration belongs to the server.
    peer = request.client.host if request is not None and request.client else "unknown"
    kind = "register" if registration else "login"
    window = 3600 if registration else 60
    ip_cap = settings.AUTH_REGISTER_IP_PER_HOUR if registration else settings.AUTH_LOGIN_IP_PER_MINUTE
    account_cap = (settings.AUTH_REGISTER_ACCOUNT_PER_HOUR if registration
                   else settings.AUTH_LOGIN_ACCOUNT_PER_MINUTE)
    await enforce_limits([
        RequestLimit("auth-global", 60, settings.AUTH_GLOBAL_PER_MINUTE),
        RequestLimit(private_scope(kind + "-ip", peer), window, ip_cap),
        RequestLimit(private_scope(kind + "-account", email.strip().lower()), window, account_cap),
    ])


async def enforce_upload_limits(account_id: str, byte_count: int) -> None:
    if not settings.ABUSE_LIMITS_ENABLED:
        return
    await enforce_limits([
        RequestLimit("upload-global", 60, settings.UPLOAD_GLOBAL_PER_MINUTE),
        RequestLimit(private_scope("upload-count", account_id), 3600, settings.UPLOAD_ACCOUNT_PER_HOUR),
        RequestLimit(private_scope("upload-bytes", account_id), 86400,
                     settings.UPLOAD_ACCOUNT_BYTES_PER_DAY, byte_count),
    ])
    try:
        await reserve_upload_allowance(account_id, byte_count)
    except UploadAllowanceExceeded:
        raise HTTPException(409, "Image storage allowance reached. Please contact support before uploading more images.") from None
    except SQLAlchemyError:
        logger.warning("upload_allowance_admission_unavailable")
        raise HTTPException(503, "Image upload is temporarily unavailable.", headers={"Retry-After": "30"}) from None
