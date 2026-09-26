"""Account-link configuration and strict storage cleanup boundaries."""
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.jobs.account_cleanup import delete_owned_object
from app.services.account_email import account_link, deliver_account_email


@pytest.mark.parametrize("origin", ["https://evil.example", "https://chef.example/path", "https://chef.example?x=1", "https://chef.example#secret", "https://user@chef.example"])
def test_recovery_origin_must_be_exact_first_party_origin(origin):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, DATABASE_URL="postgresql+asyncpg://test:test@localhost/test",
            CORS_ALLOW_ORIGINS="https://chef.example", PUBLIC_WEB_ORIGIN=origin)


def test_email_link_uses_fragment_and_only_configured_origin(monkeypatch):
    from app.services import account_email
    monkeypatch.setattr(account_email.settings, "PUBLIC_WEB_ORIGIN", "https://chef.example")
    assert account_link("reset", "opaque-token") == "https://chef.example/reset-password#token=opaque-token"
    assert account_link("verify", "opaque-token") == "https://chef.example/verify-email#token=opaque-token"


def test_ses_failure_does_not_log_email_or_token(monkeypatch, caplog):
    from app.services import account_email
    for key, value in dict(EMAIL_PROVIDER="ses", SES_REGION="us-east-1", SES_SENDER_EMAIL="support@example.com",
                           SES_IDENTITY_VERIFIED=True, PUBLIC_WEB_ORIGIN="https://chef.example").items():
        monkeypatch.setattr(account_email.settings, key, value)

    class SES:
        def send_email(self, **kwargs):
            raise RuntimeError("private@example.com opaque-token")
        def close(self):
            pass

    monkeypatch.setattr(account_email.boto3, "client", lambda *args, **kwargs: SES())
    deliver_account_email("private@example.com", "reset", "opaque-token")
    assert "account_email_delivery_failed" in caplog.text
    assert "private@example.com" not in caplog.text and "opaque-token" not in caplog.text


def test_cleanup_never_follows_local_symlinks_to_other_account_files(monkeypatch, tmp_path):
    from app.jobs import account_cleanup
    owner = uuid4()
    victim_owner = uuid4()
    filename = uuid4().hex + ".png"
    victim = tmp_path / "recipes" / str(victim_owner) / filename
    victim.parent.mkdir(parents=True)
    victim.write_bytes(b"keep")
    (tmp_path / "recipes" / str(owner)).symlink_to(victim.parent, target_is_directory=True)
    monkeypatch.setattr(account_cleanup.settings, "LOCAL_IMAGE_UPLOAD_DIR", str(tmp_path))
    with pytest.raises(ValueError):
        delete_owned_object({"owner_id": owner, "object_key": f"recipes/{owner}/{filename}", "storage_kind": "local"})
    assert victim.read_bytes() == b"keep"


@pytest.mark.parametrize("key", ["../../secret", "https://evil.example/image.png", "recipes/another-owner/image.png"])
def test_cleanup_rejects_arbitrary_targets(key):
    with pytest.raises(ValueError):
        delete_owned_object({"owner_id": uuid4(), "object_key": key, "storage_kind": "local"})


@pytest.mark.parametrize('namespace', ['recipes', 'menu-artwork'])
def test_cleanup_deletes_only_owned_image_namespace(monkeypatch, tmp_path, namespace):
    from app.jobs import account_cleanup
    owner = uuid4()
    key = f'{namespace}/{owner}/{uuid4().hex}.png'
    target = tmp_path / key
    target.parent.mkdir(parents=True)
    target.write_bytes(b'owned')
    monkeypatch.setattr(account_cleanup.settings, 'LOCAL_IMAGE_UPLOAD_DIR', str(tmp_path))
    delete_owned_object({'owner_id': owner, 'object_key': key, 'storage_kind': 'local'})
    assert not target.exists()
    with pytest.raises(ValueError):
        delete_owned_object({'owner_id': uuid4(), 'object_key': key, 'storage_kind': 'local'})
