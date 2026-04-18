"""
Admin helpers.
"""
from __future__ import annotations

from typing import Any

ADMIN_EMAIL = "jerryxiang24@gmail.com"


def is_admin(user: Any) -> bool:
    if isinstance(user, str):
        email = user
    else:
        email = getattr(user, "email", "")
    return (email or "").strip().lower() == ADMIN_EMAIL
