"""Password boundaries, canonical accounts, and nonblocking auth regressions."""
from __future__ import annotations

import threading
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException, Response
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.api import auth
from app.core import security


def test_hash_rejects_passwords_above_bcrypt_utf8_limit():
    with pytest.raises(ValueError, match="72"):
        security.hash_password("界" * 25)


def test_legacy_overlength_passwords_remain_verifiable():
    # Older bcrypt hashes discarded bytes beyond the 72-byte boundary.
    hashed = security.hash_password("a" * 72)
    assert security.verify_password("a" * 72 + "legacy suffix", hashed)
    assert not security.verify_password("b" + "a" * 71 + "legacy suffix", hashed)


def test_malformed_stored_password_is_rejected_without_server_error():
    assert not security.verify_password("example-password", "not-a-bcrypt-hash")


def test_login_input_has_a_reasonable_upper_bound():
    with pytest.raises(ValidationError):
        auth.LoginBody(email="user@example.com", password="a" * 1025)


@pytest.fixture
def account(monkeypatch):
    user = SimpleNamespace(id=UUID(int=401), email="user@example.com", is_library_public=False)

    async def no_existing(*args):
        return None

    async def create_user(*args):
        return user

    async def create_identity(*args, **kwargs):
        return SimpleNamespace(user_id=user.id)

    monkeypatch.setattr(auth.repo_auth, "get_user_by_email", no_existing)
    monkeypatch.setattr(auth.repo_auth, "create_user", create_user)
    monkeypatch.setattr(auth.repo_auth, "create_identity", create_identity)
    monkeypatch.setattr(auth, "create_access_token", lambda subject: "test-token")
    return user


@pytest.mark.asyncio
async def test_registration_checks_utf8_limit_before_database_work(monkeypatch, account):
    with pytest.raises(HTTPException) as error:
        await auth.register(
            auth.RegisterBody(email=account.email, password="界" * 25), Response(), session=object()
        )
    assert error.value.status_code == 400
    assert "72" in error.value.detail


@pytest.mark.asyncio
async def test_registration_canonicalizes_email_before_duplicate_lookup(monkeypatch, account):
    async def existing_account(session, email):
        return account if email == account.email else None

    monkeypatch.setattr(auth.repo_auth, "get_user_by_email", existing_account)
    with pytest.raises(HTTPException) as error:
        await auth.register(
            auth.RegisterBody(email="User@example.com", password="valid-password"),
            Response(), session=object(),
        )
    assert error.value.status_code == 400
    assert error.value.detail == "Email already registered"


@pytest.mark.asyncio
async def test_registration_unique_race_returns_controlled_error(monkeypatch, account):
    class DuplicateEmail(Exception):
        sqlstate = "23505"

    async def concurrent_insert(*args):
        raise IntegrityError("INSERT", {}, DuplicateEmail())

    monkeypatch.setattr(auth.repo_auth, "create_user", concurrent_insert)
    with pytest.raises(HTTPException) as error:
        await auth.register(
            auth.RegisterBody(email=account.email, password="valid-password"),
            Response(), session=object(),
        )
    assert error.value.status_code == 400
    assert error.value.detail == "Email already registered"


@pytest.mark.asyncio
async def test_registration_password_hash_runs_outside_event_loop(monkeypatch, account):
    event_loop_thread = threading.get_ident()
    hash_threads = []

    def hash_password(password):
        hash_threads.append(threading.get_ident())
        return "test-hash"

    monkeypatch.setattr(auth, "hash_password", hash_password)
    response = await auth.register(
        auth.RegisterBody(email=account.email, password="valid-password"),
        Response(), session=object(),
    )
    assert response.id == str(account.id)
    assert hash_threads and hash_threads[0] != event_loop_thread


@pytest.mark.asyncio
async def test_login_password_check_runs_outside_event_loop(monkeypatch, account):
    event_loop_thread = threading.get_ident()
    verify_threads = []

    async def identity(*args, **kwargs):
        return SimpleNamespace(user_id=account.id, password_hash="test-hash")

    async def get_user(*args):
        return account

    def verify(password, hashed):
        verify_threads.append(threading.get_ident())
        return True

    monkeypatch.setattr(auth.repo_auth, "get_identity", identity)
    monkeypatch.setattr(auth.repo_auth, "get_user_by_id", get_user)
    monkeypatch.setattr(auth, "verify_password", verify)
    response = await auth.login(
        auth.LoginBody(email=account.email, password="valid-password"),
        Response(), session=object(),
    )
    assert response.id == str(account.id)
    assert verify_threads and verify_threads[0] != event_loop_thread


def test_user_responses_include_server_computed_admin_capability(monkeypatch):
    user = SimpleNamespace(id=UUID(int=401), email="user@example.com", is_library_public=False)
    monkeypatch.setattr(auth, "is_admin", lambda current: current.id == user.id, raising=False)
    assert auth.UserResponse.from_model(user).model_dump().get("is_admin") is True
    assert auth.AuthResponse.from_model_with_token(user, "test-token").model_dump().get("is_admin") is True
