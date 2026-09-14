from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.exc import OperationalError

from app.api import ai_budget, routes_recipes
from app.api.auth import get_current_user
from app.db.repo_ai_usage import AIUsageLimitExceeded
from app.db.session import get_session


@pytest.mark.asyncio
async def test_limited_requests_never_call_extraction(monkeypatch):
    app = FastAPI()
    app.include_router(routes_recipes.router)
    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=uuid4())
    monkeypatch.setattr(ai_budget, "is_llm_enabled", lambda: True)
    monkeypatch.setattr(ai_budget, "reserve_ai_budget", AsyncMock(side_effect=AIUsageLimitExceeded(60)))
    extract = AsyncMock()
    monkeypatch.setattr(routes_recipes, "extract_recipe_from_text", extract)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api") as client:
        response = await client.post("/recipes/parse/transcript", json={"transcript": "Whisk eggs"})
    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"
    extract.assert_not_called()
    session.rollback.assert_awaited_once()
    session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_budget_storage_failure_fails_closed(monkeypatch):
    session = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
    monkeypatch.setattr(ai_budget, "is_llm_enabled", lambda: True)
    monkeypatch.setattr(ai_budget, "reserve_ai_budget", AsyncMock(side_effect=OperationalError(
        "private SQL", {}, RuntimeError("private connection details"))))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:
        await ai_budget.enforce_ai_budget(session, SimpleNamespace(id=uuid4()))
    assert error.value.status_code == 503
    assert "private" not in str(error.value.detail)
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_budget_reservation_commits_before_provider_admission(monkeypatch):
    events = []
    async def reserve(session, user):
        events.append("reserved")
    async def commit():
        events.append("committed")
    session = SimpleNamespace(commit=commit, rollback=AsyncMock())
    monkeypatch.setattr(ai_budget, "is_llm_enabled", lambda: True)
    monkeypatch.setattr(ai_budget, "reserve_ai_budget", reserve)
    await ai_budget.enforce_ai_budget(session, SimpleNamespace(id=uuid4()))
    assert events == ["reserved", "committed"]
