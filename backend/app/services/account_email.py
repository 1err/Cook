"""Configured SES delivery. No raw token, email or provider error is logged or persisted."""
import logging

import boto3
from botocore.config import Config

from app.core.config import settings

logger = logging.getLogger(__name__)


def email_available() -> bool:
    return bool(settings.EMAIL_PROVIDER == "ses" and settings.SES_IDENTITY_VERIFIED
                and settings.SES_REGION and settings.SES_SENDER_EMAIL and settings.PUBLIC_WEB_ORIGIN)


def account_link(purpose: str, token: str) -> str:
    path = "/reset-password" if purpose == "reset" else "/verify-email"
    return settings.PUBLIC_WEB_ORIGIN + path + "#token=" + token


def deliver_account_email(email: str, purpose: str, token: str) -> None:
    """Run after response admission. Provider failures have the same public response.

    There is deliberately no durable plaintext token outbox: if this process dies
    before delivery, the user requests another link; the original expires safely.
    """
    client = None
    try:
        if not email_available():
            return
        client = boto3.client("sesv2", region_name=settings.SES_REGION,
            config=Config(connect_timeout=5, read_timeout=10, retries={"total_max_attempts": 1}))
        action = "Reset your password" if purpose == "reset" else "Verify your email address"
        link = account_link(purpose, token)
        client.send_email(FromEmailAddress=str(settings.SES_SENDER_EMAIL),
            Destination={"ToAddresses": [email]}, Content={"Simple": {
                "Subject": {"Data": f"Chef World: {action}", "Charset": "UTF-8"},
                "Body": {"Text": {"Data": f"{action} using this single-use link:\n\n{link}\n\n"
                    "If you did not request this, you can ignore this email. Do not share this link.", "Charset": "UTF-8"}},
            }})
    except Exception:
        logger.warning("account_email_delivery_failed")
    finally:
        if client is not None:
            client.close()
