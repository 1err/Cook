"""Inspect the actual SES payload without contacting an email provider."""
from html.parser import HTMLParser

import pytest

from app.core.config import Settings
from app.services import account_email


class EmailHTML(HTMLParser):
    def __init__(self, value):
        super().__init__()
        self.elements = []
        self.words = []
        self.feed(value)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

    def handle_data(self, value):
        self.words.append(value)


@pytest.fixture
def email_delivery(monkeypatch):
    config = Settings(_env_file=None, APP_ENV="test",
        DATABASE_URL="postgresql+asyncpg://test:test@localhost/test",
        EMAIL_PROVIDER="ses", SES_REGION="us-east-1",
        SES_SENDER_EMAIL="accounts@example.com", SES_IDENTITY_VERIFIED=True,
        CORS_ALLOW_ORIGINS="https://chef.example.com", PUBLIC_WEB_ORIGIN="https://chef.example.com")
    monkeypatch.setattr(account_email, "settings", config)
    messages = []

    class SES:
        def send_email(self, **message):
            messages.append(message)
            return {"MessageId": "local-test-only"}

        def close(self):
            pass

    monkeypatch.setattr(account_email.boto3, "client", lambda *args, **kwargs: SES())
    return config, messages


@pytest.mark.parametrize(("purpose", "path", "action"), [
    ("reset", "reset-password", "Reset your password"),
    ("verify", "verify-email", "Verify your email address"),
])
def test_both_formats_keep_the_exact_single_use_link(email_delivery, purpose, path, action):
    _, messages = email_delivery
    account_email.deliver_account_email("reader@example.com", purpose, "opaque_URLsafe-token")
    message = messages[0]
    body = message["Content"]["Simple"]["Body"]
    assert set(body) == {"Text", "Html"}
    assert all(part["Charset"] == "UTF-8" for part in body.values())
    link = f"https://chef.example.com/{path}#token=opaque_URLsafe-token"
    assert link in body["Text"]["Data"]
    html = EmailHTML(body["Html"]["Data"])
    anchors = [attrs for tag, attrs in html.elements if tag == "a"]
    assert len(anchors) >= 2  # A clear action plus the copyable fallback URL.
    assert all(attrs["href"] == link for attrs in anchors)
    assert action in " ".join(html.words)
    assert not any(tag in {"img", "script", "link", "iframe", "form"} for tag, _ in html.elements)
    assert all(not any(key.startswith("on") for key in attrs) for _, attrs in html.elements)


@pytest.mark.parametrize(("purpose", "setting", "seconds", "duration"), [
    ("reset", "PASSWORD_RESET_TTL_SECONDS", 1800, "30 minutes"),
    ("reset", "PASSWORD_RESET_TTL_SECONDS", 301, "5 minutes and 1 second"),
    ("verify", "EMAIL_VERIFICATION_TTL_SECONDS", 86400, "24 hours"),
    ("verify", "EMAIL_VERIFICATION_TTL_SECONDS", 3661, "1 hour, 1 minute and 1 second"),
])
def test_expiry_uses_the_configured_purpose_duration(email_delivery, purpose, setting, seconds, duration):
    config, messages = email_delivery
    setattr(config, setting, seconds)
    account_email.deliver_account_email("reader@example.com", purpose, "opaque-token")
    body = messages[0]["Content"]["Simple"]["Body"]
    for part in body.values():
        text = " ".join(EmailHTML(part["Data"]).words)
        assert duration in text
        assert "after it was requested" in text  # Delivery time does not extend the token lifetime.
        assert "newer link" in text.lower() and "older links" in text.lower()


def test_html_escapes_the_link_without_changing_its_decoded_destination(email_delivery):
    _, messages = email_delivery
    token = 'opaque"><img src=x onerror="bad">&suffix'
    account_email.deliver_account_email("reader@example.com", "verify", token)
    body = messages[0]["Content"]["Simple"]["Body"]
    expected = 'https://chef.example.com/verify-email#token=opaque"><img src=x onerror="bad">&suffix'
    assert expected in body["Text"]["Data"]
    html = EmailHTML(body["Html"]["Data"])
    assert not any(tag == "img" for tag, _ in html.elements)
    anchors = [attrs for tag, attrs in html.elements if tag == "a"]
    assert anchors and all(attrs["href"] == expected for attrs in anchors)
    assert all(not any(key.startswith("on") for key in attrs) for _, attrs in html.elements)


def test_sender_is_branded_without_changing_the_configured_identity(email_delivery):
    _, messages = email_delivery
    account_email.deliver_account_email("reader@example.com", "verify", "opaque-token")
    message = messages[0]
    assert message["FromEmailAddress"] == "Chef World <accounts@example.com>"
    assert message["Destination"] == {"ToAddresses": ["reader@example.com"]}
    assert "ReplyToAddresses" not in message
    assert message["Content"]["Simple"]["Subject"]["Data"] == "Chef World: Verify your email address"
