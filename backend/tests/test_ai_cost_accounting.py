from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.core.ai_cost import Price, estimate_cost_nano, prompt_token_ceiling, configured_price


def test_money_is_integer_and_rounds_up():
    price = Price('gpt-4o-mini', 'test-v1', Decimal('0.15'), Decimal('0.60'))
    assert estimate_cost_nano(price, 1, 1) == 750
    assert estimate_cost_nano(Price('m', 'v', Decimal('0.0000001'), Decimal('0')), 1, 0) == 1


def test_input_reserve_covers_utf8_bytes_and_message_framing():
    messages = [{'role': 'user', 'content': '鸡蛋🥚'}]
    assert prompt_token_ceiling(messages) > len('鸡蛋🥚'.encode('utf-8'))


def test_unknown_price_and_model_fail_closed():
    settings = SimpleNamespace(OPENAI_MODEL='gpt-4o-mini', AI_PRICE_MODEL='', AI_PRICE_VERSION='',
                               AI_INPUT_USD_PER_MILLION_TOKENS=None, AI_OUTPUT_USD_PER_MILLION_TOKENS=None)
    with pytest.raises(ValueError):
        configured_price(settings)


@pytest.mark.parametrize("model,input_rate,output_rate", [
    ("gpt-4o-mini", ".01", ".60"),
    ("gpt-4o-mini", ".15", ".01"),
    ("gpt-4o", ".15", ".60"),
])
def test_unverified_or_underpriced_models_cannot_under_reserve(model, input_rate, output_rate):
    settings = SimpleNamespace(OPENAI_MODEL=model, AI_PRICE_MODEL=model, AI_PRICE_VERSION="2026-09-22",
                               AI_INPUT_USD_PER_MILLION_TOKENS=Decimal(input_rate),
                               AI_OUTPUT_USD_PER_MILLION_TOKENS=Decimal(output_rate))
    with pytest.raises(ValueError):
        configured_price(settings)


def test_repository_enforces_thirty_dollars_even_with_an_excessive_cap():
    from datetime import date
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.db.ai_cost_models import AIMonthlyBudgetModel
    from app.db.repo_ai_cost import money_reservation_statement
    from app.db.repo_ai_usage import AIUsageLimitExceeded
    engine = create_engine('sqlite://')
    AIMonthlyBudgetModel.__table__.create(engine)
    with Session(engine) as session:
        month = date(2026, 9, 1)
        assert session.execute(money_reservation_statement('global', month, 29_000_000_000, 100_000_000_000)).scalar_one() == 29_000_000_000
        assert session.execute(money_reservation_statement('global', month, 2_000_000_000, 100_000_000_000)).scalar_one_or_none() is None
        with pytest.raises(AIUsageLimitExceeded):
            money_reservation_statement('global', date(2026, 10, 1), 31_000_000_000, 100_000_000_000)
    engine.dispose()


def test_money_caps_and_month_rollover_are_atomic():
    from datetime import date
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from app.db.ai_cost_models import AIMonthlyBudgetModel
    from app.db.repo_ai_cost import money_reservation_statement
    from app.db.repo_ai_usage import AIUsageLimitExceeded
    engine = create_engine('sqlite://')
    AIMonthlyBudgetModel.__table__.create(engine)
    with Session(engine) as session:
        jan, feb = date(2026, 1, 1), date(2026, 2, 1)
        assert session.execute(money_reservation_statement('global', jan, 6, 10)).scalar_one() == 6
        assert session.execute(money_reservation_statement('global', jan, 6, 10)).scalar_one_or_none() is None
        assert session.execute(money_reservation_statement('global', feb, 6, 10)).scalar_one() == 6
        with pytest.raises(AIUsageLimitExceeded):
            money_reservation_statement('new-account', feb, 11, 10)
        assert len(session.execute(select(AIMonthlyBudgetModel)).scalars().all()) == 2
    engine.dispose()


@pytest.mark.asyncio
async def test_enabled_provider_cannot_bypass_request_admission(monkeypatch):
    from unittest.mock import AsyncMock
    from app.core import llm
    monkeypatch.setattr(llm.settings, 'OPENAI_API_KEY', 'fake-test-key')
    create = AsyncMock()
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    with pytest.raises(llm.AIUnavailableError):
        await llm.complete_chat(client, messages=[{'role': 'user', 'content': 'eggs'}], operation='extract')
    create.assert_not_awaited()


@pytest.mark.asyncio
async def test_two_calls_metered_third_denied_and_no_transaction_during_provider(monkeypatch):
    import time
    from contextlib import asynccontextmanager
    from unittest.mock import AsyncMock
    from uuid import uuid4
    from app.core import ai_context, llm
    from app.core.ai_context import AIRequestContext, current_ai_request
    events = []
    in_transaction = False
    @asynccontextmanager
    async def factory():
        nonlocal in_transaction
        in_transaction = True
        async def commit():
            events.append('commit')
        yield SimpleNamespace(commit=commit)
        in_transaction = False
    async def reserve(*args, **kwargs):
        events.append('reserve')
    async def provider(**kwargs):
        assert not in_transaction
        events.append('provider')
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='ok'))],
                               usage=SimpleNamespace(prompt_tokens=12, completion_tokens=4))
    monkeypatch.setattr(ai_context, 'session_factory', lambda: factory)
    monkeypatch.setattr(ai_context, 'reserve_call', reserve)
    reconcile = AsyncMock()
    monkeypatch.setattr(ai_context, 'reconcile_call', reconcile)
    monkeypatch.setattr(ai_context, 'configured_price', lambda settings: Price('gpt-4o-mini', 'test', Decimal('.15'), Decimal('.6')))
    monkeypatch.setattr(llm.settings, 'OPENAI_API_KEY', 'fake-test-key')
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=provider)))
    context = AIRequestContext(str(uuid4()), uuid4(), time.monotonic() + 30)
    token = current_ai_request.set(context)
    try:
        for _ in range(2):
            assert await llm.complete_chat(client, messages=[{'role':'user', 'content':'eggs'}], operation='extract') == 'ok'
        with pytest.raises(llm.AIUnavailableError):
            await llm.complete_chat(client, messages=[{'role':'user', 'content':'eggs'}], operation='extract')
    finally:
        current_ai_request.reset(token)
    assert events.count('provider') == 2
    assert events[:3] == ['reserve', 'commit', 'provider']
    assert reconcile.await_count == 2
    assert reconcile.await_args.kwargs['input_tokens'] == 12


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['cancel', 'timeout', 'denied'])
async def test_failure_is_terminal_and_retains_or_reconciles_reservation(monkeypatch, failure):
    import asyncio
    import time
    from unittest.mock import AsyncMock
    from uuid import uuid4
    from app.core import ai_context, llm
    from app.core.ai_context import AIRequestContext, current_ai_request
    call_id = uuid4()
    async def reserve(context, messages, operation):
        if context.denied:
            raise RuntimeError('terminal')
        return call_id
    class Denied(Exception):
        status_code = 429
    error = {'cancel': asyncio.CancelledError(), 'timeout': TimeoutError(), 'denied': Denied()}[failure]
    create = AsyncMock(side_effect=error)
    finish = AsyncMock()
    monkeypatch.setattr(llm, 'reserve_provider_call', reserve)
    monkeypatch.setattr(llm, 'finish_provider_call', finish)
    monkeypatch.setattr(llm.settings, 'OPENAI_API_KEY', 'fake-test-key')
    context = AIRequestContext(str(uuid4()), uuid4(), time.monotonic() + 30)
    token = current_ai_request.set(context)
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    try:
        with pytest.raises(asyncio.CancelledError if failure == 'cancel' else llm.AIUnavailableError):
            await llm.complete_chat(client, messages=[{'role':'user', 'content':'eggs'}], operation='extract')
        with pytest.raises(llm.AIUnavailableError):
            await llm.complete_chat(client, messages=[{'role':'user', 'content':'eggs'}], operation='extract')
    finally:
        current_ai_request.reset(token)
    create.assert_awaited_once()
    finish.assert_awaited_once_with(call_id, denied=failure == 'denied')
