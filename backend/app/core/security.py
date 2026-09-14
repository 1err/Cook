"""
JWT and password hashing for auth. Secret from AUTH_SECRET env.
OAuth-ready: local provider now; Google etc. can add more identities later.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import settings

# 7 days
ACCESS_TOKEN_EXPIRE_DAYS = 7
ALGORITHM = "HS256"
BCRYPT_MAX_PASSWORD_BYTES = 72
MAX_LOGIN_PASSWORD_CHARACTERS = 1024


def _get_secret() -> str:
    secret = getattr(settings, "AUTH_SECRET", None) or os.environ.get("AUTH_SECRET", "")
    if not secret or len(secret) < 16:
        raise ValueError("AUTH_SECRET must be set and at least 16 characters (use a long random string).")
    return secret


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")
    if len(encoded) > BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError("Password must be at most 72 UTF-8 bytes")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed: str) -> bool:
    if len(plain_password) > MAX_LOGIN_PASSWORD_CHARACTERS:
        return False
    # Existing bcrypt 4 hashes silently truncated long passwords. Preserve
    # that legacy login behavior; new registrations reject truncation above.
    encoded = plain_password.encode("utf-8")[:BCRYPT_MAX_PASSWORD_BYTES]
    try:
        return bcrypt.checkpw(encoded, hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(subject: str, extra_claims: dict[str, Any] | None = None) -> str:
    """subject should be str(user_id) for the user.id (UUID)."""
    secret = _get_secret()
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": subject,
        "exp": expire,
        "iat": now,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Returns payload dict if valid, else None."""
    try:
        secret = _get_secret()
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM])
        return payload
    except (jwt.PyJWTError, ValueError):
        return None
