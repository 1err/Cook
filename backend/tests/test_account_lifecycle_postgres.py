"""Account lifecycle behavior against an explicitly disposable local PostgreSQL DB."""
import asyncio
import os
import re
from datetime import timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update, func, delete, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import main
from app.api import auth
from app.db import session as db
from app.db.models import UserModel


@pytest_asyncio.fixture
async def account_db(monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("Explicit disposable PostgreSQL database required")
    parsed = make_url(url)
    assert parsed.database in {"chef_beta_accounts_20260922", "cooking_audit_test"}
    assert parsed.host in {"127.0.0.1", "localhost", "::1"}
    engine = create_async_engine(url, pool_size=12)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db, "async_session_maker", maker)
    from app.db.account_models import OwnedImageModel, DeletedAccountModel
    async with maker.begin() as session:
        await session.execute(delete(OwnedImageModel))
        await session.execute(delete(DeletedAccountModel))
    try:
        yield maker
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def account_client(account_db, monkeypatch):
    monkeypatch.setattr(auth.settings, "AUTH_SECRET", "account-test-secret-" * 3)
    monkeypatch.setattr(auth.settings, "ABUSE_LIMITS_ENABLED", False)
    config = dict(EMAIL_PROVIDER="ses", SES_REGION="us-east-1", SES_SENDER_EMAIL="support@example.com",
                  SES_IDENTITY_VERIFIED=True, PUBLIC_WEB_ORIGIN="https://chef.example.com")
    for key, value in config.items():
        monkeypatch.setitem(auth.settings.__dict__, key, value)
    sent = []

    class SES:
        def send_email(self, **kwargs):
            sent.append(kwargs)
            return {"MessageId": "test-delivery"}
        def close(self):
            pass

    import boto3
    monkeypatch.setattr(boto3, "client", lambda *args, **kwargs: SES())

    async def get_session():
        async with account_db() as session:
            try:
                yield session
                await session.commit()
            except BaseException:
                await session.rollback()
                raise

    main.app.dependency_overrides[db.get_session] = get_session
    async with AsyncClient(transport=ASGITransport(app=main.app), base_url="https://api.example.com", headers={"Origin": "http://localhost:3000"}) as client:
        client.test_email_messages = sent
        yield client, sent
    main.app.dependency_overrides.pop(db.get_session, None)


async def register(client, *, verify=True):
    email = f"account-{uuid4()}@example.com"
    response = await client.post("/auth/register", json={"email": email, "password": "initial-password"})
    assert response.status_code == 200, response.text
    if verify:
        confirmation = await client.post("/auth/email-verification/confirm", json={
            "token": sent_token(client.test_email_messages),
        })
        assert confirmation.status_code == 200, confirmation.text
    # Existing lifecycle tests capture emails requested by that scenario. New
    # onboarding tests exercise automatic registration delivery independently.
    client.test_email_messages.clear()
    return email, response.json()


def headers(user):
    return {"Authorization": "Bearer " + user["access_token"]}


def sent_token(sent):
    body = sent[-1]["Content"]["Simple"]["Body"]["Text"]["Data"]
    return re.search(r"#token=([A-Za-z0-9_-]+)", body).group(1)


@pytest.mark.asyncio
async def test_capabilities_disabled_and_uniform_unavailable(account_client, monkeypatch):
    client, sent = account_client
    email, user = await register(client)
    monkeypatch.setitem(auth.settings.__dict__, "SES_IDENTITY_VERIFIED", False)
    response = await client.get("/auth/capabilities")
    assert response.status_code == 200
    assert response.json() == {"password_recovery": False, "email_verification": False}
    known, unknown = [await client.post("/auth/password-reset/request", json={"email": value})
                      for value in (email, "missing@example.com")]
    assert known.status_code == unknown.status_code == 503
    assert known.json() == unknown.json()
    assert sent == []


@pytest.mark.asyncio
async def test_reset_is_hashed_single_use_and_revokes_sessions(account_client, account_db):
    client, sent = account_client
    email, user = await register(client)
    existing = await client.post("/auth/password-reset/request", json={"email": email})
    missing = await client.post("/auth/password-reset/request", json={"email": "missing@example.com"})
    assert existing.status_code == missing.status_code == 200
    assert existing.json() == missing.json() == {"ok": True}
    assert len(sent) == 1
    token = sent_token(sent)
    assert "https://chef.example.com/reset-password#token=" in str(sent)
    from app.db.account_models import AccountActionTokenModel
    async with account_db() as session:
        row = (await session.execute(select(AccountActionTokenModel).where(
            AccountActionTokenModel.user_id == user["id"]))).scalar_one()
        assert row.token_hash != token and len(row.token_hash) == 64
    response = await client.post("/auth/password-reset/confirm", json={"token": token, "password": "new-password"})
    assert response.status_code == 200, response.text
    assert (await client.get("/auth/me", headers=headers(user))).status_code == 401
    assert (await client.post("/auth/password-reset/confirm", json={"token": token, "password": "third-password"})).status_code == 400
    assert (await client.post("/auth/login", json={"email": email, "password": "initial-password"})).status_code == 401
    logged_in = await client.post("/auth/login", json={"email": email, "password": "new-password"})
    assert logged_in.status_code == 200
    assert (await client.get("/auth/me", headers=headers(logged_in.json()))).status_code == 200


@pytest.mark.asyncio
async def test_concurrent_reset_consumes_token_once(account_client):
    client, sent = account_client
    email, user = await register(client)
    assert (await client.post("/auth/password-reset/request", json={"email": email})).status_code == 200
    token = sent_token(sent)
    results = await asyncio.gather(*(client.post("/auth/password-reset/confirm", json={
        "token": token, "password": f"new-password-{index}"}) for index in range(6)))
    assert sorted(result.status_code for result in results) == [200, 400, 400, 400, 400, 400]


@pytest.mark.asyncio
async def test_expired_and_cross_purpose_tokens_cannot_reset(account_client, account_db):
    client, sent = account_client
    email, user = await register(client, verify=False)
    assert (await client.post("/auth/email-verification/request", headers=headers(user))).status_code == 200
    verification = sent_token(sent)
    assert (await client.post("/auth/password-reset/confirm", json={"token": verification, "password": "new-password"})).status_code == 400
    assert (await client.post("/auth/password-reset/request", json={"email": email})).status_code == 200
    token = sent_token(sent)
    from app.db.account_models import AccountActionTokenModel
    async with account_db.begin() as session:
        await session.execute(update(AccountActionTokenModel).where(AccountActionTokenModel.user_id == user["id"]).values(
            expires_at=func.now() - timedelta(seconds=1)))
    assert (await client.post("/auth/password-reset/confirm", json={"token": token, "password": "new-password"})).status_code == 400


@pytest.mark.asyncio
async def test_verification_replay_and_logout_scopes(account_client):
    client, sent = account_client
    email, first = await register(client, verify=False)
    assert first.get("email_verified") is False
    second = (await client.post("/auth/login", json={"email": email, "password": "initial-password"})).json()
    assert first["access_token"] != second["access_token"]
    assert (await client.post("/auth/email-verification/request", headers=headers(first))).status_code == 200
    token = sent_token(sent)
    assert "https://chef.example.com/verify-email#token=" in str(sent)
    assert (await client.post("/auth/email-verification/confirm", json={"token": token})).status_code == 200
    assert (await client.post("/auth/email-verification/confirm", json={"token": token})).status_code == 400
    assert (await client.get("/auth/me", headers=headers(first))).json()["email_verified"] is True
    assert (await client.post("/auth/logout", headers=headers(first))).status_code == 200
    assert (await client.get("/auth/me", headers=headers(first))).status_code == 401
    assert (await client.get("/auth/me", headers=headers(second))).status_code == 200
    assert (await client.post("/auth/logout-all", headers=headers(second))).status_code == 200
    assert (await client.get("/auth/me", headers=headers(second))).status_code == 401


@pytest.mark.asyncio
async def test_delete_requires_password_and_cannot_be_replayed(account_client, account_db):
    client, sent = account_client
    email, user = await register(client)
    bad = await client.request("DELETE", "/auth/account", headers=headers(user), json={"password": "incorrect-password"})
    assert bad.status_code == 403
    assert (await client.get("/auth/me", headers=headers(user))).status_code == 200
    async with account_db() as session:
        assert (await session.execute(text(
            "SELECT count(*) FROM analytics_events WHERE user_id=:id AND name='registered'"
        ), {"id": user["id"]})).scalar() == 1
        assert (await session.execute(text(
            "SELECT count(*) FROM analytics_profiles WHERE user_id=:id"
        ), {"id": user["id"]})).scalar() == 1
    deleted = await client.request("DELETE", "/auth/account", headers=headers(user), json={"password": "initial-password"})
    assert deleted.status_code == 200, deleted.text
    assert (await client.get("/auth/me", headers=headers(user))).status_code == 401
    assert (await client.post("/auth/login", json={"email": email, "password": "initial-password"})).status_code == 401
    async with account_db() as session:
        assert (await session.execute(select(UserModel).where(UserModel.email == email))).scalar_one_or_none() is None
        for table in ("analytics_events", "analytics_profiles"):
            assert (await session.execute(text(
                f"SELECT count(*) FROM {table} WHERE user_id=:id"
            ), {"id": user["id"]})).scalar() == 0


@pytest.mark.asyncio
async def test_revoked_session_cannot_attribute_client_analytics_to_account(account_client, account_db):
    client, _ = account_client
    _, user = await register(client)
    assert (await client.post("/auth/logout", headers=headers(user))).status_code == 200
    assert (await client.get("/auth/me", headers=headers(user))).status_code == 401
    visitor_id = uuid4()
    result = await client.post("/analytics/events", headers=headers(user), json={
        "name": "page_view", "event_id": str(uuid4()), "visitor_id": str(visitor_id),
        "session_id": str(uuid4()), "path": "/library",
    })
    assert result.status_code == 204
    async with account_db() as session:
        rows = (await session.execute(text(
            "SELECT user_id FROM analytics_events WHERE visitor_id=:visitor"
        ), {"visitor": visitor_id})).scalars().all()
        assert rows == [None]


@pytest.mark.asyncio
async def test_owned_upload_is_durable_before_write_and_account_delete_removes_it(account_client, account_db, tmp_path, monkeypatch):
    from app.db.account_models import OwnedImageModel
    client, sent = account_client
    email, user = await register(client)
    monkeypatch.setattr(auth.settings, "S3_BUCKET_NAME", "")
    monkeypatch.setattr(auth.settings, "AWS_REGION", "")
    monkeypatch.setattr(auth.settings, "LOCAL_IMAGE_UPLOAD_DIR", str(tmp_path))
    uploaded = await client.post("/recipes/upload-image", headers=headers(user), files={
        "file": ("image.png", b"\x89PNG\r\n\x1a\ntest", "image/png")})
    assert uploaded.status_code == 200, uploaded.text
    url = uploaded.json()["file_url"]
    async with account_db() as session:
        row = (await session.execute(select(OwnedImageModel).where(OwnedImageModel.file_url == url))).scalar_one_or_none()
        assert row is not None, "Successful uploads need durable ownership before account deletion"
        assert str(row.owner_id) == user["id"]
        key = row.object_key
    assert (tmp_path / key).exists()
    assert (await client.request("DELETE", "/auth/account", headers=headers(user), json={"password": "initial-password"})).status_code == 200
    async with account_db.begin() as session:
        await session.execute(update(OwnedImageModel).where(OwnedImageModel.file_url == url).values(next_attempt_at=func.now()))
    from app.jobs import account_cleanup
    assert await account_cleanup.process_one(account_db)
    assert not (tmp_path / key).exists()
    async with account_db() as session:
        row = (await session.execute(select(OwnedImageModel).where(OwnedImageModel.file_url == url))).scalar_one()
        assert row.state == "deleted"


@pytest.mark.asyncio
async def test_delete_preserves_copied_assets_and_global_spend(account_client, account_db):
    from app.db.account_models import OwnedImageModel
    from app.db.ai_cost_models import AIMonthlyBudgetModel
    from app.db.models import RecipeModel, AIUsageCounterModel
    from app.db.upload_budget_models import UploadBudgetModel
    from app.db.repo_account_cleanup import claim_cleanup
    from datetime import date
    from uuid import UUID
    client, sent = account_client
    email, user = await register(client)
    email2, other = await register(client)
    object_id = uuid4()
    url = f"https://bucket.s3.us-east-1.amazonaws.com/recipes/{user['id']}/{object_id.hex}.png"
    money_scope = f"global:{uuid4()}"
    async with account_db.begin() as session:
        session.add(OwnedImageModel(id=object_id, owner_id=UUID(user["id"]), storage_kind="s3", bucket="bucket", region="us-east-1",
            object_key=f"recipes/{user['id']}/{object_id.hex}.png", file_url=url, state="active"))
        await session.flush()
        for owner in (user, other):
            session.add(RecipeModel(id=str(uuid4()), user_id=UUID(owner["id"]), title="Shared", ingredients="[]", thumbnail_url=url))
        session.add(AIMonthlyBudgetModel(scope=money_scope, month=date.today().replace(day=1), reserved_nano=42, spent_nano=99))
        session.add(AIUsageCounterModel(scope=f"user:{user['id']}", window_seconds=60, window_start=1, request_count=1))
        session.add(UploadBudgetModel(scope=f"user:{user['id']}", object_count=1, byte_count=9))
    assert (await client.request("DELETE", "/auth/account", headers=headers(user), json={"password": "initial-password"})).status_code == 200
    async with account_db.begin() as session:
        image = await session.get(OwnedImageModel, object_id)
        assert image.cleanup_requested
        assert (await session.execute(select(RecipeModel).where(RecipeModel.user_id == user["id"]))).first() is None
        assert (await session.execute(select(RecipeModel).where(RecipeModel.user_id == other["id"]))).scalar_one().thumbnail_url == url
        assert await claim_cleanup(session) is None
        money = await session.get(AIMonthlyBudgetModel, (money_scope, date.today().replace(day=1)))
        assert (money.reserved_nano, money.spent_nano) == (42, 99)
        assert await session.get(UploadBudgetModel, f"user:{user['id']}") is None
        assert await session.get(AIUsageCounterModel, (f"user:{user['id']}", 60)) is None


@pytest.mark.asyncio
async def test_deleting_image_cannot_gain_a_late_copy_reference(account_client, account_db):
    from app.db.account_models import OwnedImageModel
    from app.db.models import RecipeModel
    from uuid import UUID
    client, sent = account_client
    _, user = await register(client)
    image_id, recipe_id = uuid4(), str(uuid4())
    url = f"https://api.example.com/uploads/recipes/{user['id']}/{image_id.hex}.png"
    async with account_db.begin() as session:
        session.add(OwnedImageModel(id=image_id, owner_id=UUID(user['id']), storage_kind="local", bucket="", region="",
            object_key=f"recipes/{user['id']}/{image_id.hex}.png", file_url=url, state="deleting", cleanup_requested=True))
    async with account_db.begin() as session:
        session.add(RecipeModel(id=recipe_id, user_id=UUID(user['id']), title="Late copy", ingredients="[]", thumbnail_url=url))
    async with account_db() as session:
        assert (await session.get(RecipeModel, recipe_id)).thumbnail_url is None


@pytest.mark.asyncio
async def test_invalid_short_link_is_a_controlled_error(account_client):
    client, _ = account_client
    reset = await client.post("/auth/password-reset/confirm", json={"token": "bad-link", "password": "new-password"})
    verify = await client.post("/auth/email-verification/confirm", json={"token": "bad-link"})
    assert reset.status_code == verify.status_code == 400


@pytest.mark.asyncio
async def test_legacy_session_only_works_until_account_generation_changes(account_client):
    from app.core.security import create_access_token
    client, _ = account_client
    email, user = await register(client)
    legacy = {"access_token": create_access_token(user["id"])}
    assert (await client.get("/auth/me", headers=headers(legacy))).status_code == 200
    assert (await client.post("/auth/logout-all", headers=headers(user))).status_code == 200
    assert (await client.get("/auth/me", headers=headers(legacy))).status_code == 401


@pytest.mark.asyncio
async def test_deletion_and_reset_race_cannot_revive_account(account_client):
    client, sent = account_client
    email, user = await register(client)
    assert (await client.post("/auth/password-reset/request", json={"email": email})).status_code == 200
    token = sent_token(sent)
    results = await asyncio.gather(
        client.request("DELETE", "/auth/account", headers=headers(user), json={"password": "initial-password"}),
        client.post("/auth/password-reset/confirm", json={"token": token, "password": "new-password"}),
    )
    statuses = [result.status_code for result in results]
    assert statuses in ([200, 400], [401, 200])
    assert (await client.get("/auth/me", headers=headers(user))).status_code == 401
    if statuses[0] == 200:
        assert (await client.post("/auth/login", json={"email": email, "password": "new-password"})).status_code == 401


@pytest.mark.asyncio
async def test_cleanup_failure_is_durable_and_retries(account_client, account_db, monkeypatch):
    from app.db.account_models import OwnedImageModel
    from app.jobs.account_cleanup import process_one
    from uuid import UUID
    client, _ = account_client
    _, user = await register(client)
    monkeypatch.setattr(auth.settings, "S3_BUCKET_NAME", "test-bucket")
    monkeypatch.setattr(auth.settings, "AWS_REGION", "us-east-1")
    image_id = uuid4()
    key = f"recipes/{user['id']}/{image_id.hex}.png"
    attempts = []

    class S3:
        def delete_object(self, **kwargs):
            attempts.append(kwargs)
            if len(attempts) == 1:
                raise OSError("simulated unavailable external storage")
        def close(self):
            pass

    import boto3
    monkeypatch.setattr(boto3, "client", lambda *args, **kwargs: S3())
    async with account_db.begin() as session:
        session.add(OwnedImageModel(id=image_id, owner_id=UUID(user['id']), storage_kind="s3", bucket="test-bucket", region="us-east-1",
            object_key=key, file_url=f"https://test-bucket.s3.us-east-1.amazonaws.com/{key}", state="active", cleanup_requested=True))
    assert await process_one(account_db)
    async with account_db.begin() as session:
        row = await session.get(OwnedImageModel, image_id)
        assert row.state == "deleting" and row.attempts == 1
        row.next_attempt_at = func.now()
    assert await process_one(account_db)
    async with account_db() as session:
        row = await session.get(OwnedImageModel, image_id)
        assert row.state == "deleted" and row.attempts == 2
    assert attempts == [{"Bucket": "test-bucket", "Key": key}] * 2


@pytest.mark.asyncio
async def test_recovery_rate_limits_are_shared_and_account_neutral(account_client, account_db, monkeypatch):
    from app.db.request_limit_models import RequestLimitModel
    client, sent = account_client
    email, user = await register(client)
    async with account_db.begin() as session:
        await session.execute(delete(RequestLimitModel))
    monkeypatch.setattr(auth.settings, "ABUSE_LIMITS_ENABLED", True)
    monkeypatch.setattr(auth.settings, "ACCOUNT_EMAIL_ADDRESS_PER_HOUR", 1)
    for address in (email, f"missing-{uuid4()}@example.com"):
        first = await client.post("/auth/password-reset/request", json={"email": address})
        second = await client.post("/auth/password-reset/request", json={"email": address})
        assert first.status_code == 200 and first.json() == {"ok": True}
        assert second.status_code == 429 and int(second.headers["retry-after"]) > 0
    assert len(sent) == 1


@pytest.mark.asyncio
async def test_pending_upload_and_account_delete_leave_durable_cleanup(account_client, account_db, monkeypatch):
    from app.db.account_models import OwnedImageModel
    from app.jobs.account_cleanup import process_one
    import threading
    import boto3
    client, sent = account_client
    email, user = await register(client)
    monkeypatch.setattr(auth.settings, "S3_BUCKET_NAME", "test-bucket")
    monkeypatch.setattr(auth.settings, "AWS_REGION", "us-east-1")
    started, release = threading.Event(), threading.Event()
    deleted_keys = []

    class S3:
        def put_object(self, **kwargs):
            started.set()
            assert release.wait(10), "test upload release timed out"
        def delete_object(self, **kwargs):
            deleted_keys.append(kwargs["Key"])
        def close(self):
            pass

    monkeypatch.setattr(boto3, "client", lambda *args, **kwargs: S3())
    uploading = asyncio.create_task(client.post("/recipes/upload-image", headers=headers(user), files={
        "file": ("image.png", b"\x89PNG\r\n\x1a\ntest", "image/png")}))
    try:
        assert await asyncio.to_thread(started.wait, 3)
        deleted = await client.request("DELETE", "/auth/account", headers=headers(user), json={"password": "initial-password"})
        assert deleted.status_code == 200
        async with account_db() as session:
            image = (await session.execute(select(OwnedImageModel).where(OwnedImageModel.owner_id == user["id"]))).scalar_one()
            assert image.cleanup_requested and image.state == "pending_upload"
        assert not await process_one(account_db), "A pending storage call cannot be cleaned immediately"
    finally:
        release.set()
    uploaded = await uploading
    assert uploaded.status_code == 200
    async with account_db.begin() as session:
        row = await session.get(OwnedImageModel, image.id)
        assert row.cleanup_requested
        row.next_attempt_at = func.now()
    assert await process_one(account_db)
    assert deleted_keys == [image.object_key]


@pytest.mark.asyncio
async def test_cleanup_waits_for_concurrent_copy_to_commit(account_client, account_db, monkeypatch):
    from app.db.account_models import OwnedImageModel
    from app.db.models import RecipeModel
    from app.jobs.account_cleanup import process_one
    from uuid import UUID
    client, sent = account_client
    _, owner = await register(client)
    _, recipient = await register(client)
    image_id = uuid4()
    url = f"https://test-bucket.s3.us-east-1.amazonaws.com/recipes/{owner['id']}/{image_id.hex}.png"
    async with account_db.begin() as session:
        session.add(OwnedImageModel(id=image_id, owner_id=UUID(owner['id']), storage_kind="s3", bucket="test-bucket", region="us-east-1",
            object_key=f"recipes/{owner['id']}/{image_id.hex}.png", file_url=url, state="active", cleanup_requested=True))
    async with account_db.begin() as writer:
        writer.add(RecipeModel(id=str(uuid4()), user_id=UUID(recipient['id']), title="Concurrent copy", ingredients="[]", thumbnail_url=url))
        await writer.flush()
        assert not await process_one(account_db)
    assert not await process_one(account_db)
    async with account_db() as session:
        image = await session.get(OwnedImageModel, image_id)
        assert image.state == "active"


@pytest.mark.asyncio
async def test_cleanup_preserves_references_with_url_query_or_fragment(account_client, account_db):
    from app.db.account_models import OwnedImageModel
    from app.db.models import RecipeModel
    from app.jobs.account_cleanup import process_one
    from uuid import UUID
    client, _ = account_client
    _, user = await register(client)
    image_id = uuid4()
    url = f"https://test-bucket.s3.us-east-1.amazonaws.com/recipes/{user['id']}/{image_id.hex}.png"
    async with account_db.begin() as session:
        session.add(OwnedImageModel(id=image_id, owner_id=UUID(user['id']), storage_kind="s3", bucket="test-bucket", region="us-east-1",
            object_key=f"recipes/{user['id']}/{image_id.hex}.png", file_url=url, state="active", cleanup_requested=True))
        await session.flush()
        session.add(RecipeModel(id=str(uuid4()), user_id=UUID(user['id']), title="Query alias", ingredients="[]", thumbnail_url=url + "?v=1#image"))
    assert not await process_one(account_db)
    async with account_db() as session:
        assert (await session.get(OwnedImageModel, image_id)).state == "active"


@pytest.mark.asyncio
async def test_deleted_account_sweep_does_not_clear_reregistered_email_limits(account_client, account_db):
    from app.api.abuse import private_scope
    from app.db.request_limit_models import RequestLimitModel
    from app.db.repo_account_cleanup import sweep_deleted_counters
    client, _ = account_client
    email, old = await register(client)
    assert (await client.request("DELETE", "/auth/account", headers=headers(old), json={"password": "initial-password"})).status_code == 200
    recreated = await client.post("/auth/register", json={"email": email, "password": "new-password"})
    assert recreated.status_code == 200
    scopes = [private_scope(kind, email) for kind in ("login-account", "register-account", "account-email-address")]
    async with account_db.begin() as session:
        for scope in scopes:
            session.add(RequestLimitModel(scope=scope, window_seconds=3600, window_start=1, amount=1))
    async with account_db.begin() as session:
        await sweep_deleted_counters(session)
    async with account_db() as session:
        rows = (await session.execute(select(RequestLimitModel).where(RequestLimitModel.scope.in_(scopes)))).scalars().all()
        assert len(rows) == 3, "An old UUID's cleanup must not erase a new account's email admission counters"


@pytest.mark.asyncio
async def test_late_upload_completion_cannot_reopen_image_reference_admission(account_client, account_db):
    from uuid import UUID
    from app.db.account_models import OwnedImageModel
    from app.db.models import RecipeModel
    from app.db.repo_account_cleanup import claim_cleanup, finish_cleanup
    from app.services.owned_images import finish_owned_upload
    client, _ = account_client
    _, user = await register(client)
    image_id, recipe_id = uuid4(), str(uuid4())
    key = f"recipes/{user['id']}/{image_id.hex}.png"
    url = f"https://api.example.com/uploads/{key}"
    async with account_db.begin() as session:
        session.add(OwnedImageModel(id=image_id, owner_id=UUID(user['id']), storage_kind="local", bucket="", region="",
            object_key=key, file_url=url, state="pending_upload", cleanup_requested=True))
    async with account_db.begin() as session:
        previous_claim = await claim_cleanup(session)
        assert previous_claim is not None
    # Simulate an external upload completing after a cleanup lease was admitted.
    await finish_owned_upload(image_id)
    async with account_db.begin() as session:
        image = await session.get(OwnedImageModel, image_id)
        assert image.state == "deleting"
        session.add(RecipeModel(id=recipe_id, user_id=UUID(user['id']), title="Late copy", ingredients="[]", thumbnail_url=url))
        await finish_cleanup(session, previous_claim, True)
    async with account_db.begin() as session:
        assert (await session.get(RecipeModel, recipe_id)).thumbnail_url is None
        image = await session.get(OwnedImageModel, image_id)
        assert image.state == "deleting", "An old cleanup completion cannot finish a newly queued upload"
        image.next_attempt_at = func.now()
    async with account_db.begin() as session:
        fresh_claim = await claim_cleanup(session)
        assert fresh_claim is not None and fresh_claim['lease_id'] != previous_claim['lease_id']
    async with account_db.begin() as session:
        await finish_cleanup(session, fresh_claim, True)
    async with account_db() as session:
        assert (await session.get(OwnedImageModel, image_id)).state == "deleted"
