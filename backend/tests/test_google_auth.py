"""Google credentials must prove identity and browser intent before creating sessions."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import JSON, DateTime, MetaData, Uuid, create_engine, event, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.api import auth, account_routes
from app.core.security import hash_password
from app.db.models import AuthIdentityModel, Base, UserModel
from app.db.account_models import AccountActionTokenModel
from app.db.session import get_session


class SqlSession:
    def __init__(self, sync):
        self.sync = sync

    def get_bind(self):
        return self.sync.get_bind()

    async def execute(self, statement, params=None):
        return self.sync.execute(statement, params)

    async def get(self, model, key):
        return self.sync.get(model, key)

    async def commit(self):
        self.sync.commit()

    async def rollback(self):
        self.sync.rollback()

    async def flush(self):
        self.sync.flush()

    def add(self, row):
        self.sync.add(row)

    async def delete(self, row):
        self.sync.delete(row)


@pytest.fixture(scope="module")
def google_keys():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def google_app(monkeypatch, tmp_path, google_keys):
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        copied = table.to_metadata(metadata)
        for column in copied.columns:
            if isinstance(column.type, postgresql.JSONB):
                column.type = JSON()
            elif isinstance(column.type, postgresql.UUID):
                column.type = Uuid()
    engine = create_engine("sqlite://")
    event.listen(engine, "connect", lambda dbapi, _: dbapi.execute("PRAGMA foreign_keys=ON"))
    metadata.create_all(engine)
    monkeypatch.setitem(auth.settings.__dict__, "GOOGLE_CLIENT_ID", "chef-web.apps.googleusercontent.com")
    monkeypatch.setattr(auth.settings, "CORS_ALLOW_ORIGINS", "https://chef-world.com")
    monkeypatch.setattr(auth.settings, "AUTH_SECRET", "test-google-challenge-secret-at-least-32-characters")
    monkeypatch.setattr(auth.settings, "COOKIE_SECURE", True)
    monkeypatch.setattr(auth.settings, "COOKIE_SAMESITE", "lax")
    monkeypatch.setattr(auth.settings, "LOCAL_IMAGE_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(auth.settings, "AWS_REGION", "")
    monkeypatch.setattr(auth.settings, "S3_BUCKET_NAME", "")
    monkeypatch.setattr(auth.settings, "PUBLIC_API_ORIGIN", "https://api")

    # The network boundary is mocked; JWT signatures, claims, repository and
    # cookies all exercise the real application path with a local RSA key.
    def signing_key(self, credential):
        return SimpleNamespace(key=google_keys.public_key())
    monkeypatch.setattr(jwt.PyJWKClient, "get_signing_key_from_jwt", signing_key)
    # Keep action-token persistence real; adapt only PostgreSQL's clock
    # expression to SQLite and capture the external email-delivery boundary.
    monkeypatch.setattr(auth.repo_accounts.func, "clock_timestamp",
                        lambda: func.current_timestamp(type_=DateTime(timezone=True)))
    monkeypatch.setattr(auth, "email_available", lambda: True)
    sent_email = []
    monkeypatch.setattr(auth, "deliver_account_email", lambda *args: sent_email.append(args))
    app = FastAPI()
    app.sent_email = sent_email
    app.include_router(auth.router)
    app.include_router(account_routes.router)

    @app.get("/protected")
    async def protected(user=Depends(auth.get_current_user)):
        return {"id": str(user.id)}

    async def local_session():
        with Session(engine, expire_on_commit=False, autoflush=False) as sync:
            session = SqlSession(sync)
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
    app.dependency_overrides[get_session] = local_session
    app.engine = engine
    yield app
    engine.dispose()


def api_client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://api", headers={"Origin": "https://chef-world.com"})


def google_token(key, challenge_nonce, **overrides):
    now = datetime.now(timezone.utc)
    claims = {
        "iss": "https://accounts.google.com", "aud": "chef-web.apps.googleusercontent.com",
        "sub": "google-person-123", "email": "chef@example.com", "email_verified": True, "hd": "example.com",
        "iat": now, "exp": now + timedelta(minutes=5), "nonce": challenge_nonce,
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-google-key"})


def seed_account(app, email="chef@example.com", *, password="owner-password", subject=None,
                 verified=False, verification_required=False, auth_version=0):
    account_id = uuid4()
    with Session(app.engine) as session:
        session.add(UserModel(id=account_id, email=email, email_verified=verified,
                              email_verification_required=verification_required, auth_version=auth_version))
        session.flush()
        if password:
            session.add(AuthIdentityModel(user_id=account_id, provider="local", provider_user_id=email,
                                          password_hash=hash_password(password)))
        if subject:
            session.add(AuthIdentityModel(user_id=account_id, provider="google", provider_user_id=subject))
        session.commit()
    return account_id


@pytest.mark.asyncio
async def test_disabled_google_does_not_offer_sign_in_or_issue_a_challenge(google_app, monkeypatch):
    monkeypatch.setitem(auth.settings.__dict__, "GOOGLE_CLIENT_ID", "")
    async with api_client(google_app) as api:
        config = await api.get("/auth/google/config")
        challenge = await api.post("/auth/google/nonce")
        login = await api.post("/auth/google", json={"credential": "untrusted"})
    assert config.status_code == 200
    assert config.json() == {"client_id": None}
    assert config.headers["cache-control"] == "no-store"
    assert challenge.status_code == login.status_code == 503
    assert "set-cookie" not in challenge.headers


@pytest.mark.asyncio
async def test_google_challenge_is_signed_expiring_and_httponly(google_app):
    async with api_client(google_app) as api:
        config = await api.get("/auth/google/config")
        challenge = await api.post("/auth/google/nonce")
    assert config.json() == {"client_id": "chef-web.apps.googleusercontent.com"}
    assert challenge.status_code == 200
    assert len(challenge.json()["nonce"]) >= 32
    cookie = challenge.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=lax" in cookie
    assert "Max-Age=600" in cookie
    assert challenge.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_google_creates_passwordless_account_and_committed_session(google_app, google_keys):
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        response = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
        me = await api.get("/auth/me")
        replay = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
    assert response.status_code == 200
    result = response.json()
    assert result["email"] == "chef@example.com" and result["has_password"] is False
    assert result["email_verified"] is True and result["email_verification_required"] is True
    assert result["access_token"] and me.status_code == 200
    assert me.json()["id"] == result["id"] and me.json()["has_password"] is False
    assert replay.status_code == 401
    with Session(google_app.engine) as session:
        identity = session.scalars(select(AuthIdentityModel)).one()
        assert identity.provider == "google" and identity.provider_user_id == "google-person-123"
        assert identity.password_hash is None
        assert str(identity.user_id) == result["id"]


@pytest.mark.parametrize("claims", [
    {"aud": "attacker.apps.googleusercontent.com"}, {"iss": "https://evil.example"},
    {"exp": datetime(2000, 1, 1, tzinfo=timezone.utc)}, {"email_verified": False},
    {"email_verified": "true"}, {"sub": ""}, {"email": "invalid"}, {"nonce": "another-browser"},
    {"azp": "another-client.apps.googleusercontent.com"},
    {"exp": None}, {"iat": None}, {"sub": None}, {"email": None}, {"nonce": None},
    {"email_verified": None}, {"aud": ["chef-web.apps.googleusercontent.com", "another-client"]},
])
@pytest.mark.asyncio
async def test_google_rejects_untrusted_or_incomplete_claims_without_creating_accounts(google_app, google_keys, claims):
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        response = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce, **claims)})
    assert response.status_code == 401
    assert "access_token=" not in response.headers.get("set-cookie", "")
    with Session(google_app.engine) as session:
        assert session.scalars(select(UserModel)).all() == []


@pytest.mark.asyncio
async def test_google_rejects_invalid_signature_and_missing_browser_challenge(google_app, google_keys):
    attacker = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    async with api_client(google_app) as api:
        no_challenge = await api.post("/auth/google", json={"credential": google_token(google_keys, "unknown")})
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        bad_signature = await api.post("/auth/google", json={"credential": google_token(attacker, nonce)})
    assert no_challenge.status_code == bad_signature.status_code == 401


@pytest.mark.asyncio
async def test_existing_google_subject_wins_without_changing_account_email(google_app, google_keys):
    owner = seed_account(google_app, email="original@example.com", password=None, subject="google-person-123", verification_required=True)
    seed_account(google_app, email="chef@example.com")
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        response = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
    assert response.status_code == 200
    assert response.json()["id"] == str(owner)
    assert response.json()["email"] == "original@example.com"
    assert response.json()["email_verified"] is False
    assert response.json()["email_verification_required"] is True
    assert response.json()["has_password"] is False


@pytest.mark.asyncio
async def test_email_collision_requires_password_and_preserves_challenge_for_retry(google_app, google_keys):
    owner = seed_account(google_app, verification_required=True)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        credential = google_token(google_keys, nonce)
        missing = await api.post("/auth/google", json={"credential": credential})
        wrong = await api.post("/auth/google", json={"credential": credential, "password": "wrong-password"})
        with Session(google_app.engine) as session:
            assert session.scalars(select(AuthIdentityModel).where(AuthIdentityModel.provider == "google")).all() == []
        linked = await api.post("/auth/google", json={"credential": credential, "password": "owner-password"})
        me = await api.get("/auth/me")
    assert missing.status_code == 409
    assert missing.json()["detail"]["code"] == "google_password_required"
    assert wrong.status_code == 403
    assert "set-cookie" not in missing.headers and "set-cookie" not in wrong.headers
    assert linked.status_code == 200 and linked.json()["id"] == str(owner)
    assert linked.json()["has_password"] is True and me.json()["has_password"] is True
    assert linked.json()["email_verified"] is True
    assert linked.json()["email_verification_required"] is True


@pytest.mark.asyncio
async def test_email_collision_with_non_local_identity_does_not_merge_accounts(google_app, google_keys):
    seed_account(google_app, password=None, subject="different-google-person")
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        response = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "google_account_conflict"
    with Session(google_app.engine) as session:
        assert len(session.scalars(select(UserModel)).all()) == 1
        assert len(session.scalars(select(AuthIdentityModel)).all()) == 1


@pytest.mark.parametrize("deletion_path", ["/auth/me", "/auth/account"])
@pytest.mark.asyncio
async def test_google_deletion_requires_own_subject_and_valid_challenge(google_app, google_keys, deletion_path):
    owner = seed_account(google_app, password=None, subject="google-person-123")
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
        me = await api.get("/auth/me")
        headers = {"X-Chef-World-Account-ID": me.json()["id"]}
        missing = await api.request("DELETE", deletion_path, headers=headers,
                                    json={"google_credential": google_token(google_keys, nonce)})
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        wrong = await api.request("DELETE", deletion_path, headers=headers,
                                  json={"google_credential": google_token(google_keys, nonce, sub="another-person")})
        deleted = await api.request("DELETE", deletion_path, headers=headers,
                                    json={"google_credential": google_token(google_keys, nonce)})
        stale = await api.get("/auth/me")
    assert missing.status_code == wrong.status_code == 403
    assert deleted.status_code == 200 and stale.status_code == 401
    assert "access_token=" not in deleted.headers.get("set-cookie", "")
    assert "Max-Age=0" in deleted.headers.get("set-cookie", "")
    with Session(google_app.engine) as session:
        assert session.get(UserModel, owner) is None
        assert session.scalars(select(AuthIdentityModel)).all() == []


@pytest.mark.parametrize("deletion_path", ["/auth/me", "/auth/account"])
@pytest.mark.asyncio
async def test_google_reauthentication_can_delete_linked_password_account(google_app, google_keys, deletion_path):
    seed_account(google_app, subject="google-person-123")
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        response = await api.request("DELETE", deletion_path, json={"google_credential": google_token(google_keys, nonce)})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_challenge_reset_requires_trusted_browser_origin(google_app):
    async with api_client(google_app) as api:
        response = await api.post("/auth/google/nonce", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert "set-cookie" not in response.headers


@pytest.mark.asyncio
async def test_google_rejects_tampered_and_expired_challenge_cookies(google_app, google_keys):
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        credential = google_token(google_keys, nonce)
        api.cookies.clear()
        api.cookies.set("google_auth_challenge", "tampered-challenge", domain="api.local", path="/auth")
        tampered = await api.post("/auth/google", json={"credential": credential})
        api.cookies.clear()
        expired = jwt.encode({"nonce": nonce, "purpose": "google_sign_in", "iat": 1, "exp": 2},
                             "test-google-challenge-secret-at-least-32-characters", algorithm="HS256")
        api.cookies.set("google_auth_challenge", expired, domain="api.local", path="/auth")
        stale = await api.post("/auth/google", json={"credential": credential})
    assert tampered.status_code == stale.status_code == 401


@pytest.mark.asyncio
async def test_google_key_provider_outage_returns_retryable_error_without_account(google_app, google_keys, monkeypatch):
    def unavailable(*args):
        raise jwt.PyJWKClientConnectionError("unavailable")
    monkeypatch.setattr(jwt.PyJWKClient, "get_signing_key_from_jwt", unavailable)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        response = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
    assert response.status_code == 503
    with Session(google_app.engine) as session:
        assert session.scalars(select(UserModel)).all() == []


@pytest.mark.asyncio
async def test_concurrent_account_creation_recovers_unique_failure_without_orphan(google_app, google_keys, monkeypatch):
    winner = uuid4()
    original_create = auth.repo_auth.create_user
    first = True

    async def competing_account(session, email, **kwargs):
        nonlocal first
        if first:
            first = False
            # Another request commits between our lookup and insert. The next
            # real INSERT raises the database's unique constraint violation.
            with Session(google_app.engine) as other:
                other.add(UserModel(id=winner, email=email))
                other.flush()
                other.add(AuthIdentityModel(user_id=winner, provider="google", provider_user_id="google-person-123"))
                other.commit()
        return await original_create(session, email, **kwargs)

    monkeypatch.setattr(auth.repo_auth, "create_user", competing_account)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        response = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
        me = await api.get("/auth/me")
    assert response.status_code == me.status_code == 200
    assert response.json()["id"] == str(winner)
    with Session(google_app.engine) as session:
        assert len(session.scalars(select(UserModel)).all()) == 1
        assert len(session.scalars(select(AuthIdentityModel)).all()) == 1


@pytest.mark.asyncio
async def test_concurrent_local_registration_still_requires_local_password(google_app, google_keys, monkeypatch):
    original_create = auth.repo_auth.create_user
    first = True

    async def competing_account(session, email, **kwargs):
        nonlocal first
        if first:
            first = False
            seed_account(google_app, email=email)
        return await original_create(session, email, **kwargs)

    monkeypatch.setattr(auth.repo_auth, "create_user", competing_account)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        credential = google_token(google_keys, nonce)
        blocked = await api.post("/auth/google", json={"credential": credential})
        linked = await api.post("/auth/google", json={"credential": credential, "password": "owner-password"})
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "google_password_required"
    assert linked.status_code == 200 and linked.json()["has_password"] is True
    with Session(google_app.engine) as session:
        assert len(session.scalars(select(UserModel)).all()) == 1
        assert len(session.scalars(select(AuthIdentityModel)).all()) == 2


@pytest.mark.asyncio
async def test_failed_commit_never_sets_login_cookie_or_clears_challenge(google_app, google_keys, monkeypatch):
    from sqlalchemy.exc import IntegrityError
    async def unavailable_commit(self):
        raise IntegrityError("COMMIT", {}, Exception("unique conflict"))
    monkeypatch.setattr(SqlSession, "commit", unavailable_commit)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        response = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
    assert response.status_code == 409
    assert "set-cookie" not in response.headers
    with Session(google_app.engine) as session:
        assert session.scalars(select(UserModel)).all() == []


@pytest.mark.asyncio
async def test_signature_key_retrieval_runs_outside_the_event_loop(google_app, google_keys, monkeypatch):
    import threading
    event_loop_thread = threading.get_ident()
    def signing_key(*args):
        assert threading.get_ident() != event_loop_thread
        return SimpleNamespace(key=google_keys.public_key())
    monkeypatch.setattr(jwt.PyJWKClient, "get_signing_key_from_jwt", signing_key)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        response = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_google_rejects_algorithm_confusion(google_app):
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        token = jwt.encode({"nonce": nonce}, "attacker-secret-that-is-long-enough", algorithm="HS256", headers={"kid": "test-key"})
        response = await api.post("/auth/google", json={"credential": token})
    assert response.status_code == 401


@pytest.mark.parametrize("challenge", ["missing", "expired"])
@pytest.mark.parametrize("deletion_path", ["/auth/me", "/auth/account"])
@pytest.mark.asyncio
async def test_expired_google_reauthentication_keeps_valid_app_session(google_app, google_keys, challenge, deletion_path):
    owner = seed_account(google_app, password=None, subject="google-person-123")
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        signed_in = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
        assert signed_in.status_code == 200
        if challenge == "expired":
            expired = jwt.encode({"nonce": nonce, "purpose": "google_sign_in", "iat": 1, "exp": 2},
                                 "test-google-challenge-secret-at-least-32-characters", algorithm="HS256")
            api.cookies.set("google_auth_challenge", expired, domain="api.local", path="/auth")
        headers = {"X-Chef-World-Account-ID": str(owner)}
        missing = await api.request("DELETE", deletion_path, headers=headers,
                                    json={"google_credential": google_token(google_keys, nonce)})
        me = await api.get("/auth/me")
    assert missing.status_code == 403
    assert "set-cookie" not in missing.headers
    assert me.status_code == 200 and me.json()["id"] == str(owner)
    with Session(google_app.engine) as session:
        assert session.get(UserModel, owner) is not None
        assert len(session.scalars(select(AuthIdentityModel)).all()) == 1


@pytest.mark.asyncio
async def test_google_sessions_use_current_generation_and_respect_logout_revocation(google_app, google_keys):
    owner = seed_account(google_app, password=None, subject="google-person-123", verified=True,
                         verification_required=True, auth_version=7)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        login = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
        assert login.status_code == 200
        claims = auth.decode_access_token(login.json()["access_token"])
        assert claims["auth_version"] == 7
        assert (await api.get("/protected")).status_code == 200
        logged_out = await api.post("/auth/logout")
        assert logged_out.status_code == 200
        revoked = await api.get("/auth/me", headers={"Authorization": "Bearer " + login.json()["access_token"]})
        assert revoked.status_code == 401
        with Session(google_app.engine) as session:
            user = session.get(UserModel, owner)
            user.auth_version = 8
            session.commit()
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        new_login = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
        assert new_login.status_code == 200
        assert auth.decode_access_token(new_login.json()["access_token"])["auth_version"] == 8
        assert (await api.get("/auth/me")).status_code == 200


@pytest.mark.asyncio
async def test_google_login_admission_rejects_before_signing_key_lookup(google_app, google_keys, monkeypatch):
    async def limited(*args):
        raise HTTPException(429, "Too many sign-in attempts", headers={"Retry-After": "60"})
    def must_not_fetch(*args):
        pytest.fail("Rejected sign-in must not contact Google signing-key service")
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        monkeypatch.setattr(auth.settings, "ABUSE_LIMITS_ENABLED", True)
        monkeypatch.setattr(auth, "enforce_limits", limited, raising=False)
        monkeypatch.setattr(jwt.PyJWKClient, "get_signing_key_from_jwt", must_not_fetch)
        response = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"
    with Session(google_app.engine) as session:
        assert session.scalars(select(UserModel)).all() == []


@pytest.mark.asyncio
async def test_current_account_deletion_verifies_google_before_erasure_barrier(google_app, google_keys, monkeypatch):
    seed_account(google_app, password=None, subject="google-person-123")
    locked = False
    original_lock = auth.repo_auth.lock_account_erasure_barrier

    async def lock_account(session):
        nonlocal locked
        locked = True
        await original_lock(session)

    def signing_key(*args):
        assert not locked, "Google key retrieval must not hold the global account erasure barrier"
        return SimpleNamespace(key=google_keys.public_key())

    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        assert (await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})).status_code == 200
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        monkeypatch.setattr(auth.repo_auth, "lock_account_erasure_barrier", lock_account)
        monkeypatch.setattr(jwt.PyJWKClient, "get_signing_key_from_jwt", signing_key)
        deleted = await api.request("DELETE", "/auth/account", json={"google_credential": google_token(google_keys, nonce)})
    assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_google_success_records_login_for_the_authenticated_account(google_app, google_keys, monkeypatch):
    from app.analytics import middleware
    recorded = []
    async def record(event):
        recorded.append(event)
    monkeypatch.setattr(middleware, "safe_record", record)
    google_app.add_middleware(middleware.AnalyticsMiddleware)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        login = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce)})
        assert login.status_code == 200
        # Invalid subsequent credentials must not generate successful activity.
        assert (await api.post("/auth/google", json={"credential": "untrusted"})).status_code == 401
    assert len(recorded) == 1
    assert recorded[0]["name"] == "login"
    assert str(recorded[0]["user_id"]) == login.json()["id"]
    assert recorded[0]["is_client"] is False and recorded[0]["platform"] == "web"


@pytest.mark.asyncio
async def test_non_authoritative_external_google_email_requires_its_own_verification(google_app, google_keys):
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        login = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce, hd=None)})
        protected = await api.get("/protected")
        me = await api.get("/auth/me")
    assert login.status_code == me.status_code == 200
    assert login.json()["email_verified"] is False
    assert login.json()["email_verification_required"] is True
    assert protected.status_code == 403
    assert protected.json()["detail"]["code"] == "email_verification_required"
    assert len(google_app.sent_email) == 1
    email, purpose, token = google_app.sent_email[0]
    assert email == "chef@example.com" and purpose == "verify"
    with Session(google_app.engine) as session:
        action = session.scalars(select(AccountActionTokenModel)).one()
        assert str(action.user_id) == login.json()["id"]
        assert action.token_hash == auth.repo_accounts.token_digest(token)
        assert action.purpose == "verify"
        assert token not in action.token_hash


@pytest.mark.asyncio
async def test_non_authoritative_google_email_cannot_verify_password_linked_account(google_app, google_keys):
    owner = seed_account(google_app, verification_required=True)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        linked = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce, hd=None),
                                                     "password": "owner-password"})
        protected = await api.get("/protected")
    assert linked.status_code == 200 and linked.json()["id"] == str(owner)
    assert linked.json()["email_verified"] is False and linked.json()["email_verification_required"] is True
    assert protected.status_code == 403
    with Session(google_app.engine) as session:
        assert session.get(UserModel, owner).email_verified is False


@pytest.mark.asyncio
async def test_previously_verified_email_stays_verified_when_google_is_not_authoritative(google_app, google_keys):
    seed_account(google_app, password=None, subject="google-person-123", verified=True, verification_required=True)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        login = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce, hd=None)})
    assert login.status_code == 200 and login.json()["email_verified"] is True
    assert google_app.sent_email == []


@pytest.mark.asyncio
async def test_gmail_without_hosted_domain_is_authoritative_and_does_not_send_email(google_app, google_keys):
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        login = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce, email="chef@gmail.com", hd=None)})
        protected = await api.get("/protected")
    assert login.status_code == protected.status_code == 200
    assert login.json()["email_verified"] is True
    assert google_app.sent_email == []


@pytest.mark.asyncio
async def test_external_google_signup_does_not_create_unverifiable_account_when_email_is_down(google_app, google_keys, monkeypatch):
    monkeypatch.setattr(auth, "email_available", lambda: False)
    async with api_client(google_app) as api:
        nonce = (await api.post("/auth/google/nonce")).json()["nonce"]
        login = await api.post("/auth/google", json={"credential": google_token(google_keys, nonce, hd=None)})
    assert login.status_code == 503
    assert "set-cookie" not in login.headers
    with Session(google_app.engine) as session:
        assert session.scalars(select(UserModel)).all() == []
        assert session.scalars(select(AuthIdentityModel)).all() == []
