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
        await anext(ai_budget.enforce_ai_budget(session, SimpleNamespace(id=uuid4())))
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
    session = SimpleNamespace(commit=commit, rollback=AsyncMock(), close=AsyncMock())
    monkeypatch.setattr(ai_budget, "is_llm_enabled", lambda: True)
    monkeypatch.setattr(ai_budget, "reserve_ai_budget", reserve)
    monkeypatch.setattr(ai_budget, "acquire_lease", AsyncMock())
    monkeypatch.setattr(ai_budget, "cleanup_lease", AsyncMock())
    lifecycle = ai_budget.enforce_ai_budget(session, SimpleNamespace(id=uuid4()))
    await anext(lifecycle)
    await lifecycle.aclose()
    assert events == ["reserved", "committed"]


@pytest.mark.asyncio
async def test_disabled_provider_keeps_local_fallback_usable(monkeypatch):
    session = SimpleNamespace(close=AsyncMock(), commit=AsyncMock())
    monkeypatch.setattr(ai_budget, 'is_llm_enabled', lambda: False)
    reserve = AsyncMock()
    monkeypatch.setattr(ai_budget, 'reserve_ai_budget', reserve)
    lifecycle = ai_budget.enforce_ai_budget(session, SimpleNamespace(id=uuid4()))
    await anext(lifecycle)
    await lifecycle.aclose()
    session.close.assert_awaited_once()
    reserve.assert_not_awaited()


@pytest.mark.asyncio
async def test_operation_deadline_cancels_endpoint_and_cleans_context(monkeypatch):
    import asyncio
    from fastapi import HTTPException
    from app.core.ai_context import current_ai_request
    session = SimpleNamespace(close=AsyncMock(), commit=AsyncMock(), rollback=AsyncMock())
    monkeypatch.setattr(ai_budget, 'is_llm_enabled', lambda: True)
    monkeypatch.setattr(ai_budget, 'reserve_ai_budget', AsyncMock())
    monkeypatch.setattr(ai_budget, 'acquire_lease', AsyncMock())
    cleanup = AsyncMock()
    monkeypatch.setattr(ai_budget, 'cleanup_lease', cleanup)
    monkeypatch.setattr(ai_budget.settings, 'AI_OPERATION_TIMEOUT_SECONDS', .01)
    lifecycle = ai_budget.enforce_ai_budget(session, SimpleNamespace(id=uuid4()))
    await anext(lifecycle)
    assert current_ai_request.get() is not None
    try:
        await asyncio.Event().wait()
    except asyncio.CancelledError as exc:
        with pytest.raises(HTTPException) as error:
            await lifecycle.athrow(exc)
        assert error.value.status_code == 503
    assert current_ai_request.get() is None
    cleanup.assert_awaited_once()


@pytest.mark.asyncio
async def test_admin_summary_requires_admin(monkeypatch):
    from app.api import admin_usage
    from app.api.auth import get_current_user
    app = FastAPI()
    app.include_router(admin_usage.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=uuid4())
    app.dependency_overrides[get_session] = lambda: SimpleNamespace()
    monkeypatch.setattr(ai_budget.settings, 'ADMIN_USER_IDS', '')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://api') as client:
        response = await client.get('/admin/ai-usage')
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize('slow_stage', ['reserve', 'commit'])
async def test_deadline_includes_admission_and_commit(monkeypatch, slow_stage):
    import asyncio
    import time
    from fastapi import HTTPException
    from app.core.ai_context import current_ai_request
    async def slow(*args, **kwargs):
        await asyncio.sleep(.25)
    session = SimpleNamespace(close=AsyncMock(), commit=AsyncMock(), rollback=AsyncMock())
    monkeypatch.setattr(ai_budget, 'is_llm_enabled', lambda: True)
    monkeypatch.setattr(ai_budget, 'reserve_ai_budget', slow if slow_stage == 'reserve' else AsyncMock())
    monkeypatch.setattr(ai_budget, 'acquire_lease', AsyncMock())
    monkeypatch.setattr(ai_budget, 'cleanup_lease', AsyncMock())
    monkeypatch.setattr(ai_budget.settings, 'AI_OPERATION_TIMEOUT_SECONDS', .01)
    if slow_stage == 'commit':
        session.commit = slow
    lifecycle = ai_budget.enforce_ai_budget(session, SimpleNamespace(id=uuid4()))
    started = time.monotonic()
    try:
        with pytest.raises(HTTPException) as error:
            await anext(lifecycle)
        assert error.value.status_code == 503
        assert time.monotonic() - started < .20
        assert current_ai_request.get() is None
        session.rollback.assert_awaited_once()
    finally:
        await lifecycle.aclose()
