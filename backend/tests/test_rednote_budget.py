from contextlib import asynccontextmanager
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.api import ai_budget
from app.core.ai_context import current_ai_request


@pytest.mark.asyncio
@pytest.mark.parametrize('budget,seconds', [(ai_budget.enforce_ai_budget,85), (ai_budget.enforce_rednote_import_budget,420)])
async def test_public_video_preparation_has_scoped_bounded_admission(monkeypatch,budget,seconds):
    session=SimpleNamespace(commit=AsyncMock(),close=AsyncMock(),rollback=AsyncMock())
    reserve=AsyncMock();acquire=AsyncMock();cleanup=AsyncMock()
    monkeypatch.setattr(ai_budget,'is_llm_enabled',lambda:True)
    monkeypatch.setattr(ai_budget,'reserve_ai_budget',reserve)
    monkeypatch.setattr(ai_budget,'acquire_lease',acquire)
    monkeypatch.setattr(ai_budget,'cleanup_lease',cleanup)
    monkeypatch.setattr(ai_budget.settings,'AI_OPERATION_TIMEOUT_SECONDS',85)
    monkeypatch.setattr(ai_budget.settings,'REDNOTE_IMPORT_TIMEOUT_SECONDS',420)
    async with asynccontextmanager(budget)(session=session,user=SimpleNamespace(id='owner')):
        context=current_ai_request.get()
        assert context.account_id=='owner'
        assert seconds-1 < context.deadline-time.monotonic() <= seconds
        assert acquire.await_args.kwargs['ttl']==seconds+10
        assert acquire.await_args.kwargs['global_limit']==ai_budget.settings.AI_GLOBAL_MAX_INFLIGHT
        reserve.assert_awaited_once_with(session,'owner')
    assert current_ai_request.get() is None
    cleanup.assert_awaited_once()
