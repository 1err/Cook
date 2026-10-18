"""Verify Google ID tokens and signed, browser-bound login challenges."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import secrets

import jwt
from pydantic import EmailStr, TypeAdapter, ValidationError

from app.core.config import settings
from app.core.security import _get_secret

GOOGLE_CERTIFICATES_URL = "https://www.googleapis.com/oauth2/v3/certs"
CHALLENGE_COOKIE_NAME = "google_auth_challenge"
CHALLENGE_COOKIE_PATH = "/auth"
CHALLENGE_LIFETIME_SECONDS = 600
_email = TypeAdapter(EmailStr)


class InvalidGoogleCredential(ValueError):
    """The ID token or its browser challenge is not trustworthy."""


class GoogleUnavailable(RuntimeError):
    """Google's signing-key service is temporarily unavailable."""


@dataclass(frozen=True)
class GoogleIdentity:
    subject: str
    email: str
    email_authoritative: bool


@lru_cache(maxsize=1)
def _key_client() -> jwt.PyJWKClient:
    # This fixed URL ignores token-controlled jku/x5u URLs. Keep key rotation
    # working with a short-lived JWKS cache and a bounded network timeout.
    return jwt.PyJWKClient(GOOGLE_CERTIFICATES_URL, cache_jwk_set=True, lifespan=300, timeout=5)


def create_challenge() -> tuple[str, str]:
    nonce = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    cookie = jwt.encode({
        "nonce": nonce,
        "purpose": "google_sign_in",
        "iat": now,
        "exp": now + timedelta(seconds=CHALLENGE_LIFETIME_SECONDS),
    }, _get_secret(), algorithm="HS256")
    return nonce, cookie


def challenge_nonce(cookie: str | None) -> str:
    try:
        if not cookie or len(cookie) > 2048:
            raise InvalidGoogleCredential("Start Google sign-in again to continue.")
        claims = jwt.decode(cookie, _get_secret(), algorithms=["HS256"],
                            options={"require": ["iat", "exp", "nonce", "purpose"]})
        nonce = claims["nonce"]
        if (claims["purpose"] != "google_sign_in" or not isinstance(nonce, str)
                or not 32 <= len(nonce) <= 128):
            raise InvalidGoogleCredential("Start Google sign-in again to continue.")
        return nonce
    except (jwt.PyJWTError, ValueError) as exc:
        raise InvalidGoogleCredential("Start Google sign-in again to continue.") from exc


def verify_credential(credential: str, expected_nonce: str) -> GoogleIdentity:
    """Run in a threadpool: key retrieval and signature checking are synchronous."""
    try:
        header = jwt.get_unverified_header(credential)
        if (header.get("alg") != "RS256" or not isinstance(header.get("kid"), str)
                or not 1 <= len(header["kid"]) <= 256):
            raise InvalidGoogleCredential("Google sign-in could not be verified.")
        key = _key_client().get_signing_key_from_jwt(credential)
        claims = jwt.decode(
            credential, key.key, algorithms=["RS256"],
            audience=settings.GOOGLE_CLIENT_ID,
            issuer=["https://accounts.google.com", "accounts.google.com"],
            options={"strict_aud": True,
                     "require": ["iss", "aud", "exp", "iat", "sub", "email", "email_verified", "nonce"]},
        )
        subject, email, nonce = claims["sub"], claims["email"], claims["nonce"]
        if (not isinstance(subject, str) or not 1 <= len(subject) <= 255
                or not isinstance(email, str) or len(email) > 255
                or claims["email_verified"] is not True
                or not isinstance(nonce, str) or not secrets.compare_digest(nonce, expected_nonce)
                or ("azp" in claims and claims["azp"] != settings.GOOGLE_CLIENT_ID)):
            raise InvalidGoogleCredential("Google sign-in could not be verified.")
        normalized_email = str(_email.validate_python(email)).strip().lower()
        hosted_domain = claims.get("hd")
        # Google vouches for Gmail and hosted Workspace mailboxes. For other
        # email addresses, email_verified may reflect an old mailbox owner.
        authoritative = (normalized_email.endswith("@gmail.com")
                         or (isinstance(hosted_domain, str) and bool(hosted_domain.strip())))
        return GoogleIdentity(subject=subject, email=normalized_email, email_authoritative=authoritative)
    except jwt.PyJWKClientConnectionError as exc:
        raise GoogleUnavailable("Google sign-in is temporarily unavailable. Please try again.") from exc
    except (jwt.PyJWTError, ValidationError, ValueError, TypeError, KeyError) as exc:
        raise InvalidGoogleCredential("Google sign-in could not be verified.") from exc
