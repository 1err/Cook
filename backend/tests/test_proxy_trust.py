"""Trusted ALB peers supply client identity; direct peers cannot spoof it."""
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import Request
from pydantic import ValidationError

from app.core.config import Settings


def settings(**overrides):
    return Settings(_env_file=None, DATABASE_URL="postgresql+asyncpg://test:test@localhost/test", **overrides)


@pytest.mark.parametrize("value", ["*", "0.0.0.0/0", "::/0", "10.0.0.0/8", "example.com", "10.0.1.1/24", "10.0.1.0/24,*"])
def test_proxy_trust_rejects_wildcards_broad_or_invalid_networks(value):
    with pytest.raises(ValidationError):
        settings(TRUSTED_PROXY_CIDRS=value)


def test_production_requires_explicit_trusted_proxy_networks():
    config = dict(APP_ENV="production", AUTH_SECRET="x" * 40, COOKIE_SECURE=True,
                  CORS_ALLOW_ORIGINS="https://example.com")
    with pytest.raises(ValidationError, match="TRUSTED_PROXY_CIDRS"):
        settings(**config, TRUSTED_PROXY_CIDRS="")
    assert settings(**config, TRUSTED_PROXY_CIDRS="10.20.1.0/24,10.20.2.0/24").TRUSTED_PROXY_CIDRS


def test_runtime_middleware_uses_explicit_trust_before_auth(monkeypatch):
    from app import main
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
    configured = [m for m in main.app.user_middleware if m.cls is ProxyHeadersMiddleware]
    assert len(configured) == 1
    assert main.app.user_middleware[0].cls is ProxyHeadersMiddleware
    assert configured[0].kwargs["trusted_hosts"] == main.settings.TRUSTED_PROXY_CIDRS


@pytest.mark.asyncio
async def test_distinct_clients_through_trusted_alb_get_distinct_auth_scopes(monkeypatch):
    from app.api import abuse
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
    monkeypatch.setattr(abuse.settings, "ABUSE_LIMITS_ENABLED", True)
    reserve = AsyncMock()
    monkeypatch.setattr(abuse, "enforce_limits", reserve)
    captured = []
    async def app(scope, receive, send):
        await abuse.enforce_auth_limits(Request(scope), "same@example.com", registration=False)
        captured.append(reserve.call_args.args[0])
    wrapped = ProxyHeadersMiddleware(app, trusted_hosts="10.20.1.0/24,10.20.2.0/24")
    for client in ("198.51.100.10", "198.51.100.11"):
        scope = {"type":"http", "method":"POST", "path":"/auth/login", "scheme":"http",
                 "client":("10.20.1.5", 1234), "headers":[(b"x-forwarded-for", f"attacker-spoof, {client}".encode())]}
        await wrapped(scope, AsyncMock(), AsyncMock())
    assert any(limit.scope == abuse.private_scope("login-ip", "198.51.100.10") for limit in captured[0])
    assert any(limit.scope == abuse.private_scope("login-ip", "198.51.100.11") for limit in captured[1])
    assert not any(limit.scope == abuse.private_scope("login-ip", "attacker-spoof") for limits in captured for limit in limits)


@pytest.mark.asyncio
async def test_untrusted_peer_cannot_select_auth_ip_scope(monkeypatch):
    from app.api import abuse
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
    monkeypatch.setattr(abuse.settings, "ABUSE_LIMITS_ENABLED", True)
    reserve = AsyncMock()
    monkeypatch.setattr(abuse, "enforce_limits", reserve)
    async def app(scope, receive, send):
        await abuse.enforce_auth_limits(Request(scope), "same@example.com", registration=False)
    wrapped = ProxyHeadersMiddleware(app, trusted_hosts="10.20.1.0/24")
    scope = {"type":"http", "method":"POST", "path":"/auth/login", "scheme":"http",
             "client":("192.0.2.55", 1234), "headers":[(b"x-forwarded-for", b"198.51.100.10"), (b"x-forwarded-proto", b"https")]}
    await wrapped(scope, AsyncMock(), AsyncMock())
    assert scope["scheme"] == "http"
    assert any(limit.scope == abuse.private_scope("login-ip", "192.0.2.55") for limit in reserve.call_args.args[0])


def test_container_command_disables_uvicorn_automatic_proxy_parsing():
    dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text()
    assert "--no-proxy-headers" in next(line for line in dockerfile.splitlines() if line.startswith("CMD "))
