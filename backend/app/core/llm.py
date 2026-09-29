"""Application-owned AI client and bounded, privacy-conscious completion calls."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from openai import AsyncOpenAI

from app.core.config import settings
from app.core.ai_context import current_ai_request, reserve_provider_call, finish_provider_call


logger = logging.getLogger(__name__)
MAX_PROMPT_CHARACTERS = 60_000
_client: AsyncOpenAI | None = None


class AIUnavailableError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("AI is temporarily unavailable. Please try again later.")


class AIInputTooLargeError(ValueError):
    pass


def get_openai_client() -> AsyncOpenAI | None:
    global _client
    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        return None
    if _client is None:
        _client = AsyncOpenAI(
            api_key=api_key,
            project=settings.OPENAI_PROJECT or None,
            timeout=settings.OPENAI_TIMEOUT_SECONDS,
            max_retries=0,
        )
    return _client


async def close_openai_client() -> None:
    global _client
    client = _client
    if client is not None:
        await client.close()
        if _client is client:
            _client = None


async def complete_chat(client: Any, *, messages: list[dict[str, str]],
                        operation: str, json_object: bool = False) -> str:
    """No SDK retries: each call has a known output and wall-clock budget."""
    if sum(len(message["content"]) for message in messages) > MAX_PROMPT_CHARACTERS:
        raise AIInputTooLargeError("The recipe text is too long. Please shorten it and try again.")
    started = time.monotonic()
    options: dict[str, Any] = {
        "model": settings.OPENAI_MODEL,
        "messages": messages,
    }
    if settings.OPENAI_MODEL == "gpt-6-luna":
        options["max_completion_tokens"] = settings.OPENAI_MAX_OUTPUT_TOKENS
        # Preserve 4o-mini's effective non-reasoning behavior on migration.
        # The pinned SDK predates this parameter; extra_body sends it unchanged.
        options["extra_body"] = {"reasoning_effort": "none"}
        options["service_tier"] = "default"
    else:
        options["max_tokens"] = settings.OPENAI_MAX_OUTPUT_TOKENS
    if json_object:
        options["response_format"] = {"type": "json_object"}
    context = current_ai_request.get()
    call_id = None
    if is_llm_enabled() and context is None:
        # A route/service added without admission must never create unmetered spend.
        raise AIUnavailableError()
    try:
        if context is not None:
            call_id = await reserve_provider_call(context, messages, operation)
        timeout = settings.OPENAI_TIMEOUT_SECONDS
        if context is not None:
            timeout = min(timeout, context.deadline - time.monotonic())
        if timeout <= 0:
            raise AIUnavailableError()
        async with asyncio.timeout(timeout):
            response = await client.chat.completions.create(**options)
        # Record charged usage before validating model output: malformed/truncated
        # results still cost money and must not disappear from the ledger.
        usage = getattr(response, "usage", None)
        if call_id is not None:
            await finish_provider_call(call_id,
                input_tokens=getattr(usage, "prompt_tokens", None),
                output_tokens=getattr(usage, "completion_tokens", None),
                provider_request_id=getattr(response, "_request_id", None))
        choice = response.choices[0]
        if getattr(choice, "finish_reason", None) in {"length", "content_filter"}:
            raise AIUnavailableError()
        content = choice.message.content
        if not isinstance(content, str) or not content.strip():
            raise AIUnavailableError()
    except BaseException as exc:
        if context is not None:
            context.denied = True
        if call_id is not None:
            try:
                async with asyncio.timeout(5):
                    await finish_provider_call(call_id, denied=getattr(exc, "status_code", None) in
                                               {400, 401, 403, 404, 422, 429})
            except Exception:
                # Durable pre-call reservation remains charged if storage fails.
                logger.warning("ai_reconciliation_unavailable")
        if isinstance(exc, asyncio.CancelledError):
            raise
        if not isinstance(exc, Exception):
            raise
        logger.warning("ai_call_failed operation=%s error_type=%s", operation, type(exc).__name__)
        raise AIUnavailableError() from None
    finally:
        if context is not None:
            context.call_active = False
    logger.info("ai_call operation=%s model=%s latency_ms=%d input_tokens=%s output_tokens=%s request_id=%s",
                operation, settings.OPENAI_MODEL, (time.monotonic() - started) * 1000,
                getattr(usage, "prompt_tokens", None), getattr(usage, "completion_tokens", None),
                getattr(response, "_request_id", None))
    return content


def is_llm_enabled() -> bool:
    return bool((settings.OPENAI_API_KEY or "").strip())
