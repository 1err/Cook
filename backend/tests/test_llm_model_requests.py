"""Offline SDK contract checks; these do not evaluate live model quality or latency."""
from __future__ import annotations

import json

import httpx
import pytest
from openai import AsyncOpenAI

from app import extract, refine
from app.models import RecipeStep


@pytest.mark.asyncio
@pytest.mark.parametrize("workflow", ["extract", "estimate", "refine"])
async def test_luna_low_request_and_existing_output_contract(monkeypatch, workflow):
    step = RecipeStep(
        id="00000000-0000-0000-0000-000000000001",
        text="Simmer the sauce.",
        duration_seconds=300,
        duration_source="fallback",
    )
    payloads = {
        "extract": {
            "title": "番茄汤", "ingredients": [{"name": "番茄", "quantity": "2个"}],
            "steps": [], "equipment": [], "tips": [],
        },
        "estimate": [{
            "id": step.id, "duration_seconds": 420,
            "attention_type": "passive", "action_type": "simmer",
        }],
        "refine": {"purchase_items": [{
            "name": "番茄", "suggested_purchase": "2个", "grocery_category": "Produce",
        }]},
    }
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={
            "id": "chatcmpl-offline-test", "object": "chat.completion",
            "created": 0, "model": "gpt-6-luna",
            "choices": [{
                "index": 0, "finish_reason": "stop",
                "message": {"role": "assistant", "content": json.dumps(payloads[workflow])},
            }],
        })

    # A fake key and MockTransport ensure this test cannot call the OpenAI API.
    async with AsyncOpenAI(
        api_key="offline-test-key",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    ) as client:
        monkeypatch.setattr(extract, "get_openai_client", lambda: client)
        monkeypatch.setattr(refine, "get_openai_client", lambda: client)
        if workflow == "extract":
            result = await extract.extract_recipe_from_text("用2个番茄煮汤。")
            assert result.title == "番茄汤"
            assert result.ingredients[0].name == "番茄"
        elif workflow == "estimate":
            result = await extract.estimate_tutorial_step_metadata([step])
            assert result[0].id == step.id
            assert result[0].text == step.text
            assert result[0].duration_seconds == 420
            assert result[0].duration_source == "estimated"
        else:
            result = await refine.refine_shopping_list([{"name": "番茄", "quantity": "2个"}])
            assert result == payloads["refine"]

    assert len(requests) == 1
    assert requests[0].url.path == "/v1/chat/completions"
    body = json.loads(requests[0].content)
    assert body["model"] == "gpt-6-luna"
    assert body["reasoning_effort"] == "low"
    assert body["messages"]
    assert not {"temperature", "top_p", "logprobs", "top_logprobs", "tools"} & body.keys()


@pytest.mark.asyncio
async def test_no_key_fallbacks_remain_available(monkeypatch):
    monkeypatch.setattr(extract, "get_openai_client", lambda: None)
    monkeypatch.setattr(refine, "get_openai_client", lambda: None)
    assert (await extract.extract_recipe_from_text("mapo tofu")).title == "Mapo Tofu"
    items = [{"name": "Salt", "quantity": "1 tsp"}]
    assert await refine.refine_shopping_list(items) == {
        "purchase_items": [{"name": "Salt", "suggested_purchase": "1 tsp", "grocery_category": "Other"}]
    }


@pytest.mark.asyncio
async def test_refine_api_failure_preserves_fallback(monkeypatch):
    def fail(request):
        return httpx.Response(400, json={"error": {"message": "test error", "type": "invalid_request_error"}})

    async with AsyncOpenAI(
        api_key="offline-test-key", max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(fail)),
    ) as client:
        monkeypatch.setattr(refine, "get_openai_client", lambda: client)
        assert await refine.refine_shopping_list([{"name": "Salt", "quantity": "1 tsp"}]) == {
            "purchase_items": [{"name": "Salt", "suggested_purchase": "1 tsp", "grocery_category": "Other"}]
        }
