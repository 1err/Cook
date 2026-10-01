"""Basic shopping totals survive provider failure; logs explain failed completions."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app import refine
from app.core import llm
from app.services.shopping_service import aggregate_ingredients, normalize_purchase_quantity


def test_exact_garlic_ginger_and_soy_aliases_always_share_a_total():
    rows = [("大蒜", "20 g"), ("蒜", "10 g"), ("姜", "15 g"),
            ("生姜", "25 g"), ("生抽", "5 g"), ("生抽酱油", "10 g"),
            ("蒜粉", "3 g"), ("姜粉", "4 g"), ("老抽", "7 g")]
    expected = {"大蒜": "30 g", "生姜": "40 g", "生抽": "15 g",
                "蒜粉": "3 g", "姜粉": "4 g", "老抽": "7 g"}
    for inputs in (rows, list(reversed(rows))):
        result = aggregate_ingredients(inputs, for_purchase=True)
        assert {row.name: normalize_purchase_quantity(row.name, row.total_quantity)
                for row in result} == expected


@pytest.mark.asyncio
async def test_provider_failure_still_combines_exact_aliases(monkeypatch):
    monkeypatch.setattr(refine, "get_openai_client", lambda: None)
    result = await refine.refine_shopping_list([
        {"name": "蒜", "quantity": "10 g"}, {"name": "大蒜", "quantity": "20 g"},
        {"name": "姜", "quantity": "15 g"}, {"name": "生姜", "quantity": "25 g"},
    ])
    assert {row["name"]: row["suggested_purchase"] for row in result["purchase_items"]} == {
        "大蒜": "30 g", "生姜": "40 g",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("finish_reason, content, reason", [
    ("length", '{"private ingredient":', "output_limit"),
    ("content_filter", None, "content_filter"),
    ("stop", "", "empty_response"),
])
async def test_failed_response_logs_its_actual_reason_without_content(
        monkeypatch, caplog, finish_reason, content, reason):
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content), finish_reason=finish_reason)],
        usage=SimpleNamespace(prompt_tokens=1000, completion_tokens=4000),
    )
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
        create=AsyncMock(return_value=response))))
    with pytest.raises(llm.AIUnavailableError):
        await llm.complete_chat(client, operation="shopping_refine",
            messages=[{"role": "user", "content": "private ingredient"}], json_object=True)
    assert f"reason={reason}" in caplog.text
    assert "output_tokens=4000" in caplog.text
    assert "private ingredient" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("model, expected_limit, parameter", [
    ("gpt-6-luna", 20000, "max_completion_tokens"),
    ("gpt-4o-mini", 16384, "max_tokens"),
    ("gpt-4o-mini-2024-07-18", 16384, "max_tokens"),
])
async def test_large_shopping_completion_is_fully_reserved_before_provider_work(
        monkeypatch, model, expected_limit, parameter):
    import time
    from contextlib import asynccontextmanager
    from decimal import Decimal
    from uuid import uuid4
    from app.core import ai_context
    from app.core.ai_context import AIRequestContext, current_ai_request
    from app.core.ai_cost import Price

    reserved = []
    sent = []
    in_transaction = False

    @asynccontextmanager
    async def session():
        nonlocal in_transaction
        in_transaction = True
        yield SimpleNamespace(commit=AsyncMock())
        in_transaction = False

    async def reserve(_session, **values):
        reserved.append(values)

    async def provider(**options):
        assert not in_transaction
        sent.append(options)
        limit = options[parameter]
        # A valid large response can need more than the ordinary recipe budget.
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"ok":true}'),
                finish_reason='stop' if limit >= 12000 else 'length')],
            usage=SimpleNamespace(prompt_tokens=2000, completion_tokens=min(12000, limit)),
        )

    monkeypatch.setattr(ai_context, 'session_factory', lambda: session)
    monkeypatch.setattr(ai_context, 'reserve_call', reserve)
    monkeypatch.setattr(ai_context, 'reconcile_call', AsyncMock())
    monkeypatch.setattr(ai_context, 'configured_price', lambda _: Price(
        model, 'fixture-reviewed', Decimal('.125'), Decimal('.50')))
    monkeypatch.setattr(llm.settings, 'OPENAI_MODEL', model)
    monkeypatch.setattr(llm.settings, 'OPENAI_API_KEY', 'fixture-only')
    monkeypatch.setattr(llm.settings, 'OPENAI_MAX_OUTPUT_TOKENS', 4000)
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=provider)))
    context = AIRequestContext(str(uuid4()), uuid4(), time.monotonic() + 30)
    token = current_ai_request.set(context)
    try:
        result = await llm.complete_chat(client, operation='shopping_refine', json_object=True,
            messages=[{'role': 'user', 'content': 'Return the complete shopping list as JSON.'}])
    finally:
        current_ai_request.reset(token)
    assert result == '{"ok":true}'
    assert reserved[0]['output_bound'] == expected_limit
    assert reserved[0]['output_bound'] == sent[0][parameter]
    assert len(sent) == 1
