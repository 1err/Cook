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


async def post_refine(app, *, unresolved=False):
    items = [
        {"name": "食用盐", "quantity": "1 茶匙"},
        {"name": "盐", "quantity": "7 g"},
    ]
    if unresolved:
        items.extend([
            {"name": "胡萝卜", "quantity": "200 g"},
            {"name": "胡萝卜", "quantity": "1 小段"},
        ])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/shopping-list/refine", json={"items": items})


@pytest.mark.asyncio
async def test_refine_route_consolidates_known_totals_without_provider_work(refinement_app):
    app, provider, session = refinement_app
    response = await post_refine(app)

    assert response.status_code == 200
    assert response.json() == {
        "refinement_status": "refined", "remove": [], "likely_pantry": [],
        "purchase_items": [{"name": "盐", "suggested_purchase": "约 13 g", "category": "Pantry & Dry Goods"}],
    }
    provider.assert_not_awaited()
    session.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_refine_route_retains_bounded_provider_enhancement_for_unresolved_portions(refinement_app):
    app, provider, _ = refinement_app
    provider.return_value = completion(json.dumps({"purchase_items": [
        {"source_ids": ["ingredient-1", "ingredient-2"], "name": "盐",
         "suggested_purchase": "约 13 g", "grocery_category": "Pantry & Dry Goods"},
        {"source_ids": ["ingredient-3", "ingredient-4"], "name": "胡萝卜",
         "suggested_purchase": "约 220–240 g", "grocery_category": "Produce"},
    ]}))
    response = await post_refine(app, unresolved=True)
    assert response.status_code == 200
    assert response.json()["refinement_status"] == "refined"
    assert response.json()["purchase_items"] == [
        {"name": "盐", "suggested_purchase": "约 13 g", "category": "Pantry & Dry Goods"},
        {"name": "胡萝卜", "suggested_purchase": "约 220–240 g", "category": "Produce"},
    ]
    provider.assert_awaited_once()
    assert provider.await_args.kwargs["max_completion_tokens"] == llm.settings.OPENAI_SHOPPING_MAX_OUTPUT_TOKENS


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["provider-error", "malformed-json", "truncated", "timeout", "missing-provider"])
async def test_refine_route_preserves_useful_local_list_when_enhancement_fails(refinement_app, monkeypatch, caplog, failure):
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
    response = await post_refine(app, unresolved=True)

    assert response.status_code == 200
    assert response.json() == {
        "refinement_status": "partial", "remove": [], "likely_pantry": [],
        "purchase_items": [
            {"name": "盐", "suggested_purchase": "约 13 g", "category": "Pantry & Dry Goods"},
            {"name": "胡萝卜", "suggested_purchase": "200 g + 1 小段", "category": "Produce"},
        ],
    }
    assert provider.await_count == (0 if failure == "missing-provider" else 1)
    assert "private provider detail" not in caplog.text
    if failure == "timeout":
        assert time.monotonic() - started < 1


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [
    AIUsageLimitExceeded(60),
    OperationalError("private SQL", {}, RuntimeError("private connection")),
])
@pytest.mark.parametrize("unresolved", [False, True])
async def test_refine_admission_limits_never_block_local_groceries_or_allow_paid_calls(
        refinement_app, monkeypatch, failure, unresolved):
    app, provider, session = refinement_app
    monkeypatch.setattr(ai_budget, "is_llm_enabled", lambda: True)
    reserve = AsyncMock(side_effect=failure)
    monkeypatch.setattr(ai_budget, "reserve_ai_budget", reserve)

    response = await post_refine(app, unresolved=unresolved)

    assert response.status_code == 200
    assert response.json()["refinement_status"] == ("partial" if unresolved else "refined")
    assert response.json()["purchase_items"][0] == {
        "name": "盐", "suggested_purchase": "约 13 g", "category": "Pantry & Dry Goods",
    }
    if unresolved:
        assert response.json()["purchase_items"][1] == {
            "name": "胡萝卜", "suggested_purchase": "200 g + 1 小段", "category": "Produce",
        }
        reserve.assert_awaited_once()
        session.rollback.assert_awaited_once()
    else:
        reserve.assert_not_awaited()
    assert "private" not in response.text
    provider.assert_not_awaited()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_optional_enhancement_keeps_operation_and_provider_cost_admission(refinement_app, monkeypatch):
    from app.core.ai_context import current_ai_request

    app, provider, session = refinement_app
    monkeypatch.setattr(ai_budget, "is_llm_enabled", lambda: True)
    reserve = AsyncMock()
    lease = AsyncMock()
    cleanup = AsyncMock()
    call_id = uuid4()
    events = []

    async def reserve_call(context, messages, operation):
        assert context is current_ai_request.get()
        assert operation == "shopping_refine"
        session.commit.assert_awaited_once()
        session.close.assert_awaited_once()
        events.append("cost-reserved")
        return call_id

    async def complete(**options):
        assert events == ["cost-reserved"]
        assert current_ai_request.get() is not None
        events.append("provider")
        return completion(json.dumps({"purchase_items": [
            {"source_ids": ["ingredient-1", "ingredient-2"], "name": "盐",
             "suggested_purchase": "约 13 g", "grocery_category": "Pantry & Dry Goods"},
            {"source_ids": ["ingredient-3", "ingredient-4"], "name": "胡萝卜",
             "suggested_purchase": "约 220–240 g", "grocery_category": "Produce"},
        ]}))

    reconcile = AsyncMock()
    monkeypatch.setattr(ai_budget, "reserve_ai_budget", reserve)
    monkeypatch.setattr(ai_budget, "acquire_lease", lease)
    monkeypatch.setattr(ai_budget, "cleanup_lease", cleanup)
    monkeypatch.setattr(llm, "reserve_provider_call", reserve_call)
    monkeypatch.setattr(llm, "finish_provider_call", reconcile)
    provider.side_effect = complete
    response = await post_refine(app, unresolved=True)
    assert response.status_code == 200
    assert response.json()["refinement_status"] == "refined"
    assert events == ["cost-reserved", "provider"]
    reserve.assert_awaited_once()
    lease.assert_awaited_once()
    cleanup.assert_awaited_once()
    reconcile.assert_awaited_once_with(call_id, input_tokens=None, output_tokens=None, provider_request_id=None)
    assert current_ai_request.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["authentication", "validation"])
async def test_local_refinement_does_not_bypass_authentication_or_input_validation(refinement_app, monkeypatch, failure):
    from fastapi import HTTPException

    app, provider, _ = refinement_app
    reserve = AsyncMock()
    monkeypatch.setattr(ai_budget, "reserve_ai_budget", reserve)
    if failure == "authentication":
        def unauthenticated():
            raise HTTPException(401, "Authentication required")
        app.dependency_overrides[get_current_user] = unauthenticated
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/shopping-list/refine", json={"items": [{
            "name": "" if failure == "validation" else "盐", "quantity": "1 g",
        }]})
    assert response.status_code == (401 if failure == "authentication" else 422)
    provider.assert_not_awaited()
    reserve.assert_not_awaited()


def test_refine_status_is_an_additive_documented_response_field():
    schema = routes_shopping.RefineResponse.model_json_schema()
    assert schema["properties"]["refinement_status"]["enum"] == ["refined", "partial", "fallback"]
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
    assert response.json()["refinement_status"] == "partial"
    assert {row["name"]: row["suggested_purchase"] for row in response.json()["purchase_items"]} == {
        f"ingredient {i}": "1 g" for i in range(250)
    }
    provider.assert_not_awaited()


@pytest.mark.asyncio
async def test_refine_route_distinguishes_retained_quantity_from_unavailable_service(refinement_app):
    app, provider, _ = refinement_app
    provider.return_value = completion(json.dumps({"purchase_items": [
        {"source_ids": ["ingredient-1", "ingredient-2"], "name": "大葱",
         "suggested_purchase": "约 170 g", "grocery_category": "Produce"},
        {"source_ids": ["ingredient-3"], "name": "调料",
         "suggested_purchase": "1 包（规格待确认）", "grocery_category": "Pantry & Dry Goods"},
    ]}))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/shopping-list/refine", json={"items": [
            {"name": "大葱", "quantity": "145 g"}, {"name": "大葱", "quantity": "1 小段"},
            {"name": "调料", "quantity": "1 包（规格待确认）"},
        ]})
    assert response.status_code == 200
    assert response.json() == {
        "refinement_status": "partial", "remove": [], "likely_pantry": [],
        "purchase_items": [
            {"name": "大葱", "suggested_purchase": "约 170 g", "category": "Produce"},
            {"name": "调料", "suggested_purchase": "1 包 (规格待确认)", "category": "Pantry & Dry Goods"},
        ],
    }
