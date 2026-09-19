from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core import admin
from app.core.config import Settings


def configuration(**overrides):
    return Settings(_env_file=None, DATABASE_URL="postgresql+asyncpg://test:test@localhost/test", **overrides)


def test_postgres_driver_must_be_the_url_scheme():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, DATABASE_URL="sqlite:///postgresql+asyncpg.db")


def test_production_rejects_insecure_defaults():
    with pytest.raises(ValidationError):
        configuration(APP_ENV="production")


@pytest.mark.parametrize("value", ["invalid", "", "none"])
def test_cookie_configuration_is_validated(value):
    with pytest.raises(ValidationError):
        configuration(COOKIE_SAMESITE=value, COOKIE_SECURE=False)


def test_explicit_production_configuration_is_accepted():
    result = configuration(APP_ENV="production", AUTH_SECRET="a" * 64,
                           COOKIE_SECURE=True, COOKIE_SAMESITE="lax",
                           CORS_ALLOW_ORIGINS="https://chef-world.com", TRUSTED_PROXY_CIDRS="10.20.1.0/24")
    assert result.COOKIE_SECURE


def test_privileges_do_not_come_from_a_claimed_email():
    assert not admin.is_admin(SimpleNamespace(id=uuid4(), email="jerryxiang24@gmail.com"))


def test_explicit_admin_account_id_is_required(monkeypatch):
    account_id = uuid4()
    monkeypatch.setattr(admin.settings, "ADMIN_USER_IDS", str(account_id))
    assert admin.is_admin(SimpleNamespace(id=account_id, email="other@example.com"))
    assert not admin.is_admin(SimpleNamespace(id=uuid4(), email="other@example.com"))


def test_credentials_are_excluded_from_settings_repr():
    result = configuration(AUTH_SECRET="do-not-log-this-secret", OPENAI_API_KEY="test-only-key")
    assert "do-not-log-this-secret" not in repr(result)
    assert "test-only-key" not in repr(result)
    assert "test:test@" not in repr(result)
