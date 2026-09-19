from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from starlette.requests import Request


def request():
    return Request({"type": "http", "method": "POST", "path": "/auth/login",
                    "headers": [(b"x-forwarded-for", b"attacker-selected-address")],
                    "client": ("192.0.2.10", 1234), "scheme": "http", "server": ("test", 80)})


@pytest.mark.asyncio
async def test_auth_limits_use_peer_and_normalized_opaque_account(monkeypatch):
    from app.api import abuse
    monkeypatch.setattr(abuse.settings, "ABUSE_LIMITS_ENABLED", True)
    reserve = AsyncMock()
    monkeypatch.setattr(abuse, "enforce_limits", reserve)
    await abuse.enforce_auth_limits(request(), "User@Example.com", registration=False)
    limits = reserve.call_args.args[0]
    assert len(limits) == 3
    assert all("example.com" not in item.scope and "192.0.2.10" not in item.scope for item in limits)
    assert any(item.scope == abuse.private_scope("login-ip", "192.0.2.10") for item in limits)
    assert any(item.scope == abuse.private_scope("login-account", "user@example.com") for item in limits)


@pytest.mark.asyncio
async def test_storage_byte_allowance_reserved_before_external_write(monkeypatch):
    from app.api import abuse
    monkeypatch.setattr(abuse.settings, "ABUSE_LIMITS_ENABLED", True)
    reserve = AsyncMock()
    monkeypatch.setattr(abuse, "enforce_limits", reserve)
    monkeypatch.setattr(abuse, "reserve_upload_allowance", AsyncMock())
    await abuse.enforce_upload_limits("account-id", 10485760)
    limits = reserve.call_args.args[0]
    assert any(item.amount == 10485760 and item.window_seconds == 86400 for item in limits)
    assert any(item.amount == 1 and item.window_seconds == 3600 for item in limits)


@pytest.mark.asyncio
async def test_limiter_database_failure_is_safe_retryable_response(monkeypatch):
    from app.api import abuse
    from app.db.repo_request_limits import RequestLimit
    monkeypatch.setattr(abuse, "reserve_with_factory", AsyncMock(side_effect=SQLAlchemyError("private DSN")))
    with pytest.raises(HTTPException) as caught:
        await abuse.enforce_limits([RequestLimit("synthetic", 60, 2)])
    assert caught.value.status_code == 503
    assert "private" not in caught.value.detail
    assert caught.value.headers["Retry-After"] == "30"


@pytest.mark.asyncio
async def test_login_denial_precedes_password_work(monkeypatch):
    from app.api import auth
    limiter = AsyncMock(side_effect=HTTPException(429, "Try later"))
    monkeypatch.setattr(auth, "enforce_auth_limits", limiter)
    lookup = AsyncMock()
    monkeypatch.setattr(auth.repo_auth, "get_identity", lookup)
    with pytest.raises(HTTPException) as caught:
        await auth.login(auth.LoginBody(email="test@example.com", password="valid-password"),
                         SimpleNamespace(), session=SimpleNamespace(), request=request())
    assert caught.value.status_code == 429
    lookup.assert_not_awaited()
