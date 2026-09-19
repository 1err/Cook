from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError


@pytest.mark.asyncio
async def test_cumulative_quota_reserved_before_upload(monkeypatch):
    from app.api import abuse
    monkeypatch.setattr(abuse.settings, "ABUSE_LIMITS_ENABLED", True)
    order = []
    async def timed(*args):
        order.append("timed")
    async def stored(account_id, byte_count):
        assert (account_id, byte_count) == ("test-account", 100)
        order.append("cumulative")
    monkeypatch.setattr(abuse, "enforce_limits", timed)
    monkeypatch.setattr(abuse, "reserve_upload_allowance", stored)
    await abuse.enforce_upload_limits("test-account", 100)
    assert order == ["timed", "cumulative"]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure,status", [("quota", 409), ("database", 503)])
async def test_storage_allowance_denial_is_actionable_and_private(monkeypatch, failure, status):
    from app.api import abuse
    from app.db.repo_upload_budget import UploadAllowanceExceeded
    monkeypatch.setattr(abuse.settings, "ABUSE_LIMITS_ENABLED", True)
    monkeypatch.setattr(abuse, "enforce_limits", AsyncMock())
    error = UploadAllowanceExceeded() if failure == "quota" else SQLAlchemyError("secret DSN")
    monkeypatch.setattr(abuse, "reserve_upload_allowance", AsyncMock(side_effect=error))
    with pytest.raises(HTTPException) as caught:
        await abuse.enforce_upload_limits("test-account", 100)
    assert caught.value.status_code == status
    assert "secret" not in str(caught.value.detail)
