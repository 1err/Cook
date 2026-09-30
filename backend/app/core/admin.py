"""
Admin helpers.
"""
from __future__ import annotations

from typing import Any
from app.core.config import settings


def is_admin_account_id(account_id: str) -> bool:
    return bool(account_id) and account_id in settings.ADMIN_USER_IDS.split(",")


def is_admin(user: Any) -> bool:
    return is_admin_account_id(str(getattr(user, "id", "")))


def can_manage_public_catalog(user: Any) -> bool:
    account_id = str(getattr(user, "id", ""))
    return is_admin(user) or (bool(account_id) and account_id in settings.PUBLIC_LIBRARY_EDITOR_USER_IDS.split(","))
