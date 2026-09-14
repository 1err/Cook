import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app import extract
from app.core import llm


@pytest.mark.asyncio
async def test_missing_provider_does_not_fabricate_a_recipe(monkeypatch):
    monkeypatch.setattr(extract, "get_openai_client", lambda: None)
    with pytest.raises(Exception, match="unavailable"):
        await extract.extract_recipe_from_text("tofu")


@pytest.mark.asyncio
async def test_completion_has_an_output_budget(monkeypatch):
    create = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(
        message=SimpleNamespace(content='{"title":"Eggs","ingredients":[],"steps":[]}'))]))
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(extract, "get_openai_client", lambda: client)
    await extract.extract_recipe_from_text("Whisk the eggs.")
    assert 0 < create.call_args.kwargs.get("max_tokens", 0) <= 8000


@pytest.mark.asyncio
async def test_provider_failure_logs_no_prompt_or_secret(monkeypatch, caplog):
    create = AsyncMock(side_effect=RuntimeError("private transcript and secret"))
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(extract, "get_openai_client", lambda: client)
    with pytest.raises(Exception, match="unavailable"):
        await extract.extract_recipe_from_text("private transcript")
    assert "private transcript" not in caplog.text
    assert "and secret" not in caplog.text


@pytest.mark.asyncio
async def test_provider_cancellation_is_propagated(monkeypatch):
    create = AsyncMock(side_effect=asyncio.CancelledError)
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(extract, "get_openai_client", lambda: client)
    with pytest.raises(asyncio.CancelledError):
        await extract.extract_recipe_from_text("Whisk eggs.")


@pytest.mark.asyncio
async def test_client_is_reused_and_closed_at_shutdown(monkeypatch):
    client = SimpleNamespace(close=AsyncMock())
    calls = []
    def create_client(**kwargs):
        calls.append(kwargs)
        return client
    monkeypatch.setattr(llm, "_client", None)
    monkeypatch.setattr(llm.settings, "OPENAI_API_KEY", "test-only-not-a-real-key")
    monkeypatch.setattr(llm, "AsyncOpenAI", create_client)
    assert llm.get_openai_client() is client
    assert llm.get_openai_client() is client
    assert len(calls) == 1
    assert calls[0]["max_retries"] == 0
    assert calls[0]["timeout"] == llm.settings.OPENAI_TIMEOUT_SECONDS
    await llm.close_openai_client()
    await llm.close_openai_client()
    client.close.assert_awaited_once()
    assert llm._client is None


@pytest.mark.asyncio
async def test_hanging_provider_is_cancelled_at_deadline(monkeypatch):
    cancelled = asyncio.Event()
    async def hang(**kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=hang)))
    monkeypatch.setattr(llm.settings, "OPENAI_TIMEOUT_SECONDS", 0.01)
    with pytest.raises(llm.AIUnavailableError):
        await llm.complete_chat(client, messages=[{"role": "user", "content": "recipe"}], operation="test")
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_oversized_input_never_reaches_the_provider():
    create = AsyncMock()
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    with pytest.raises(llm.AIInputTooLargeError):
        await llm.complete_chat(client, messages=[{"role": "user", "content": "x" * 60_001}], operation="test")
    create.assert_not_called()


@pytest.mark.asyncio
async def test_truncated_model_output_is_not_accepted_as_a_recipe(monkeypatch):
    create = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(
        message=SimpleNamespace(content='{"title":"Eggs"}'), finish_reason="length")]))
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(extract, "get_openai_client", lambda: client)
    with pytest.raises(llm.AIUnavailableError):
        await extract.extract_recipe_from_text("Whisk eggs")
