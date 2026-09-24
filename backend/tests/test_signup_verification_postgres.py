"""New accounts prove email ownership before app use; legacy accounts keep access."""
import asyncio
import hashlib
import os
import re
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.api import auth
from app.core.security import hash_password
from app.db.models import AuthIdentityModel, UserModel
from test_account_lifecycle_postgres import account_db, account_client, headers, sent_token


def credentials():
    return {"email": f"onboarding-{uuid4()}@example.com", "password": "onboarding-password"}


@pytest.mark.asyncio
async def test_signup_commits_verification_before_dispatch_and_gates_cookie_and_bearer(account_client, monkeypatch):
    client, sent = account_client
    body = credentials()

    async def committed_token(token):
        engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
        try:
            async with engine.connect() as connection:
                row = (await connection.execute(text(
                    "SELECT u.email,t.purpose FROM users u JOIN account_action_tokens t ON t.user_id=u.id "
                    "WHERE t.token_hash=:hash"
                ), {"hash": hashlib.sha256(token.encode()).hexdigest()})).one_or_none()
                return row is not None and tuple(row) == (body["email"], "verify")
        finally:
            await engine.dispose()

    class SES:
        def send_email(self, **kwargs):
            token = re.search(r"#token=([A-Za-z0-9_-]+)", kwargs["Content"]["Simple"]["Body"]["Text"]["Data"]).group(1)
            assert asyncio.run(committed_token(token)), "Email must never precede committed account/token state"
            sent.append(kwargs)
            return {"MessageId": "test-delivery"}

        def close(self):
            pass

    import boto3
    monkeypatch.setattr(boto3, "client", lambda *args, **kwargs: SES())
    response = await client.post("/auth/register", json=body)
    assert response.status_code == 200, response.text
    user = response.json()
    assert user.get("email_verification_required") is True
    assert user["email_verified"] is False
    assert len(sent) == 1
    token = sent_token(sent)
    me = await client.get("/auth/me")
    assert me.status_code == 200 and me.json()["email_verification_required"] is True
    for credential_headers in ({}, headers(user)):
        for method, path, payload in (
            ("GET", "/recipes", None),
            ("GET", "/cooking-session/active", None),
            ("POST", "/recipes", {"id": str(uuid4()), "title": "Blocked", "ingredients": [], "steps": []}),
            ("POST", "/auth/library-visibility", {"is_public": True}),
        ):
            blocked = await client.request(method, path, headers=credential_headers, json=payload)
            assert blocked.status_code == 403, (method, path, blocked.text)
            assert blocked.json()["detail"]["code"] == "email_verification_required"
    assert (await client.get("/recipes", headers={"Authorization": "Bearer invalid"})).status_code == 401
    assert (await client.post("/auth/email-verification/confirm", json={"token": token})).status_code == 200
    for credential_headers in ({}, headers(user)):
        assert (await client.get("/recipes", headers=credential_headers)).status_code == 200
    assert (await client.get("/auth/me")).json()["email_verified"] is True


@pytest.mark.asyncio
async def test_pending_account_can_resend_sign_out_and_delete(account_client):
    client, sent = account_client
    body = credentials()
    user = (await client.post("/auth/register", json=body)).json()
    assert user.get("email_verification_required") is True
    initial = sent_token(sent)
    assert (await client.post("/auth/email-verification/request", headers=headers(user))).status_code == 200
    replacement = sent_token(sent)
    assert replacement != initial
    assert (await client.post("/auth/email-verification/confirm", json={"token": initial})).status_code == 400
    assert (await client.post("/auth/logout-all", headers=headers(user))).status_code == 200
    assert (await client.get("/auth/me", headers=headers(user))).status_code == 401
    login = await client.post("/auth/login", json=body)
    assert login.status_code == 200 and login.json()["email_verification_required"] is True
    assert (await client.get("/recipes", headers=headers(login.json()))).status_code == 403
    assert (await client.request("DELETE", "/auth/account", headers=headers(login.json()), json={"password": body["password"]})).status_code == 200
    assert (await client.post("/auth/email-verification/confirm", json={"token": replacement})).status_code == 400


@pytest.mark.asyncio
async def test_unavailable_email_refuses_signup_without_creating_account(account_client, account_db, monkeypatch):
    client, sent = account_client
    body = credentials()
    monkeypatch.setitem(auth.settings.__dict__, "SES_IDENTITY_VERIFIED", False)
    response = await client.post("/auth/register", json=body)
    assert response.status_code == 503
    assert "set-cookie" not in response.headers
    assert sent == []
    async with account_db() as session:
        assert (await session.execute(select(UserModel).where(UserModel.email == body["email"]))).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_email_provider_failure_leaves_recoverable_pending_account(account_client, monkeypatch, caplog):
    client, sent = account_client
    import boto3
    working_client = boto3.client

    class BrokenSES:
        def send_email(self, **kwargs):
            raise RuntimeError("private-provider-error")

        def close(self):
            pass

    monkeypatch.setattr(boto3, "client", lambda *args, **kwargs: BrokenSES())
    response = await client.post("/auth/register", json=credentials())
    assert response.status_code == 200
    user = response.json()
    assert user.get("email_verification_required") is True and user["email_verified"] is False
    assert sent == []
    assert "account_email_delivery_failed" in caplog.text and "private-provider-error" not in caplog.text
    assert (await client.get("/recipes", headers=headers(user))).status_code == 403
    monkeypatch.setattr(boto3, "client", working_client)
    assert (await client.post("/auth/email-verification/request", headers=headers(user))).status_code == 200
    assert len(sent) == 1
    assert (await client.post("/auth/email-verification/confirm", json={"token": sent_token(sent)})).status_code == 200
    assert (await client.get("/recipes", headers=headers(user))).status_code == 200


@pytest.mark.asyncio
async def test_legacy_unverified_account_keeps_access_without_faking_verification(account_client, account_db):
    client, sent = account_client
    body = credentials()
    user_id = uuid4()
    async with account_db.begin() as session:
        session.add(UserModel(id=user_id, email=body["email"]))
        await session.flush()
        session.add(AuthIdentityModel(user_id=user_id, provider="local", provider_user_id=body["email"], password_hash=hash_password(body["password"])))
    response = await client.post("/auth/login", json=body)
    assert response.status_code == 200
    user = response.json()
    assert user.get("email_verification_required") is False and user["email_verified"] is False
    assert (await client.get("/recipes", headers=headers(user))).status_code == 200
    assert sent == []


@pytest.mark.asyncio
async def test_signup_email_admission_limits_apply_before_account_creation(account_client, account_db, monkeypatch):
    from app.db.request_limit_models import RequestLimitModel
    client, sent = account_client
    async with account_db.begin() as session:
        await session.execute(delete(RequestLimitModel))
    monkeypatch.setattr(auth.settings, "ABUSE_LIMITS_ENABLED", True)
    monkeypatch.setattr(auth.settings, "ACCOUNT_EMAIL_IP_PER_HOUR", 1)
    assert (await client.post("/auth/register", json=credentials())).status_code == 200
    denied = credentials()
    response = await client.post("/auth/register", json=denied)
    assert response.status_code == 429 and int(response.headers["retry-after"]) > 0
    assert len(sent) == 1
    async with account_db() as session:
        assert (await session.execute(select(UserModel).where(UserModel.email == denied["email"]))).scalar_one_or_none() is None
