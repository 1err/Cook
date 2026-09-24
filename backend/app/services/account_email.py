"""Configured SES delivery. No raw token, email or provider error is logged or persisted."""
import logging
from email.utils import formataddr
from html import escape

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


def _duration(seconds: int) -> str:
    parts = []
    for unit, length in (("hour", 3600), ("minute", 60), ("second", 1)):
        count, seconds = divmod(seconds, length)
        if count:
            parts.append(f"{count} {unit}{'s' if count != 1 else ''}")
    return ", ".join(parts[:-1]) + " and " + parts[-1] if len(parts) > 1 else parts[0]


def _email_content(purpose: str, link: str) -> dict:
    reset = purpose == "reset"
    action = "Reset your password" if reset else "Verify your email address"
    button = "Reset password" if reset else "Verify email"
    introduction = ("Choose a new password for your Chef World account." if reset
                    else "Confirm this email address for your Chef World account.")
    ttl = settings.PASSWORD_RESET_TTL_SECONDS if reset else settings.EMAIL_VERIFICATION_TTL_SECONDS
    expiry = f"This link expires {_duration(ttl)} after it was requested and can be used once."
    replacement = "If you request a newer link, older links for this action will stop working."
    mobile = ("Using the mobile app? Finish in your browser, then return to the app and sign in."
              if reset else "Using the mobile app? Finish in your browser, then return to Settings in the app and check your verification status.")
    safety = "If you did not request this, you can ignore this email. Do not share this link."
    text = f"Chef World\n\n{action}\n\n{introduction}\n\n{link}\n\n{expiry}\n{replacement}\n\n{mobile}\n\n{safety}"
    # Escape both attribute and text contexts. The decoded destination retains
    # the original fragment token; no tracking redirect or query token is added.
    safe_link = escape(link, quote=True)
    html = f"""<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{escape(action)} · Chef World</title></head>
<body style="margin:0;padding:0;background-color:#FBF8F2;color:#2F2621;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">{escape(introduction)} {escape(expiry)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF8F2;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
<tr><td style="padding:0 0 24px;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Chef World<span style="color:#A64B34;">.</span></td></tr>
<tr><td style="padding:28px 24px;background-color:#FFFFFF;border:1px solid #E6DED6;border-top:4px solid #A64B34;border-radius:12px;">
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;letter-spacing:-0.5px;">{escape(action)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;">{escape(introduction)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#A64B34" style="border-radius:8px;">
<a href="{safe_link}" style="display:block;padding:16px 20px;border:1px solid #A64B34;border-radius:8px;background-color:#A64B34;color:#FFFFFF;font-size:16px;font-weight:700;line-height:24px;text-align:center;text-decoration:none;mso-padding-alt:16px 20px;">{escape(button)}</a>
</td></tr></table>
<p style="margin:24px 0 8px;font-size:14px;line-height:1.6;color:#6F6259;">{escape(expiry)}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6F6259;">{escape(replacement)}</p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.6;">If the button does not work, copy and paste this link into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;overflow-wrap:anywhere;"><a href="{safe_link}" style="color:#A64B34;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">{safe_link}</a></p>
<p style="margin:0;padding-top:20px;border-top:1px solid #E6DED6;font-size:14px;line-height:1.6;color:#6F6259;">{escape(mobile)}</p>
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:13px;line-height:1.6;color:#6F6259;">{escape(safety)}</td></tr>
</table>
</td></tr></table>
</body></html>"""
    return {"Simple": {
        "Subject": {"Data": f"Chef World: {action}", "Charset": "UTF-8"},
        "Body": {"Text": {"Data": text, "Charset": "UTF-8"},
                 "Html": {"Data": html, "Charset": "UTF-8"}},
    }}


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
        link = account_link(purpose, token)
        client.send_email(FromEmailAddress=formataddr(("Chef World", str(settings.SES_SENDER_EMAIL))),
            Destination={"ToAddresses": [email]}, Content=_email_content(purpose, link))
    except Exception:
        logger.warning("account_email_delivery_failed")
    finally:
        if client is not None:
            client.close()
