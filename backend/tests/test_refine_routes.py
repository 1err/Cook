"""Refinement remains honest and lossless across the HTTP/provider boundary."""
import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.exc import OperationalError

from app import refine
from app.api import ai_budget, routes_shopping
from app.api.auth import get_current_user
from app.core import llm
from app.db.repo_ai_usage import AIUsageLimitExceeded
from app.db.session import get_session


def completion(content, finish_reason="stop"):
    return SimpleNamespace(choices=[SimpleNamespace(
        message=SimpleNamespace(content=content), finish_reason=finish_reason,
    )], usage=None)


@pytest.fixture
def refinement_app(monkeypatch):
    app = FastAPI()
    app.include_router(routes_shopping.router)
    session = SimpleNamespace(close=AsyncMock(), rollback=AsyncMock(), commit=AsyncMock())
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=uuid4())
    app.dependency_overrides[get_session] = lambda: session
    monkeypatch.setattr(ai_budget, "is_llm_enabled", lambda: False)
    monkeypatch.setattr(ai_budget, "video_analysis_available", lambda: False)
    provider = AsyncMock(return_value=completion(json.dumps({"purchase_items": [{
        "source_ids": ["ingredient-1", "ingredient-2"], "name": "盐",
        "suggested_purchase": "约 13 g", "grocery_category": "Pantry & Dry Goods",
    }]})))
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=provider)))
    monkeypatch.setattr(refine, "get_openai_client", lambda: fake_client)
    return app, provider, session


async def post_refine(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/shopping-list/refine", json={"items": [
            {"name": "食用盐", "quantity": "1 茶匙"},
            {"name": "盐", "quantity": "7 g"},
        ]})


@pytest.mark.asyncio
async def test_refine_route_accepts_complete_source_group_and_consolidated_model_quantity(refinement_app):
    app, provider, session = refinement_app
    response = await post_refine(app)

    assert response.status_code == 200
    assert response.json() == {
        "refinement_status": "refined", "remove": [], "likely_pantry": [],
        "purchase_items": [{"name": "盐", "suggested_purchase": "约 13 g", "category": "Pantry & Dry Goods"}],
    }
    provider.assert_awaited_once()
    session.close.assert_awaited_once()
    assert provider.await_args.kwargs["max_completion_tokens"] == llm.settings.OPENAI_MAX_OUTPUT_TOKENS


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["provider-error", "malformed-json", "truncated", "timeout", "missing-provider"])
async def test_refine_route_returns_marked_fallback_without_retrying_provider(refinement_app, monkeypatch, caplog, failure):
    app, provider, _ = refinement_app
    if failure == "provider-error":
        provider.side_effect = RuntimeError("private provider detail")
    elif failure == "malformed-json":
        provider.return_value = completion("not JSON")
    elif failure == "truncated":
        provider.return_value = completion('{"purchase_items":[]}', "length")
    elif failure == "timeout":
        async def hanging_provider(**kwargs):
            await asyncio.sleep(10)
        provider.side_effect = hanging_provider
        monkeypatch.setattr(llm.settings, "OPENAI_TIMEOUT_SECONDS", .01)
    else:
        monkeypatch.setattr(refine, "get_openai_client", lambda: None)
    started = time.monotonic()
    response = await post_refine(app)

    assert response.status_code == 200
    assert response.json() == {
        "refinement_status": "fallback", "remove": [], "likely_pantry": [],
        "purchase_items": [{"name": "盐", "suggested_purchase": "约 13 g", "category": "Other"}],
    }
    assert provider.await_count == (0 if failure == "missing-provider" else 1)
    assert "private provider detail" not in caplog.text
    if failure == "timeout":
        assert time.monotonic() - started < 1


@pytest.mark.asyncio
@pytest.mark.parametrize("failure,status,retry_after", [
    (AIUsageLimitExceeded(60), 429, "60"),
    (OperationalError("private SQL", {}, RuntimeError("private connection")), 503, "30"),
])
async def test_refine_admission_still_fails_closed_without_provider_calls(refinement_app, monkeypatch, failure, status, retry_after):
    app, provider, session = refinement_app
    monkeypatch.setattr(ai_budget, "is_llm_enabled", lambda: True)
    monkeypatch.setattr(ai_budget, "reserve_ai_budget", AsyncMock(side_effect=failure))

    response = await post_refine(app)

    assert response.status_code == status
    assert response.headers["retry-after"] == retry_after
    assert "private" not in response.text
    provider.assert_not_awaited()
    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()


def test_refine_status_is_an_additive_documented_response_field():
    schema = routes_shopping.RefineResponse.model_json_schema()
    assert schema["properties"]["refinement_status"]["enum"] == ["refined", "fallback"]
    legacy = routes_shopping.RefineResponse(remove=[], likely_pantry=[], purchase_items=[])
    assert legacy.refinement_status == "refined"


@pytest.mark.asyncio
async def test_refine_route_preserves_more_than_200_original_entries_when_provider_unavailable(refinement_app, monkeypatch):
    app, provider, _ = refinement_app
    monkeypatch.setattr(refine, "get_openai_client", lambda: None)
    items = [{"name": f"ingredient {i}", "quantity": "1 g"} for i in range(250)]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/shopping-list/refine", json={"items": items})
    assert response.status_code == 200
    assert response.json()["refinement_status"] == "fallback"
    assert {row["name"]: row["suggested_purchase"] for row in response.json()["purchase_items"]} == {
        f"ingredient {i}": "1 g" for i in range(250)
    }
    provider.assert_not_awaited()
