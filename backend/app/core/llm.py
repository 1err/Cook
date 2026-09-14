"""Application-owned AI client and bounded, privacy-conscious completion calls."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from openai import AsyncOpenAI

from app.core.config import settings


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
        "max_tokens": settings.OPENAI_MAX_OUTPUT_TOKENS,
    }
    if json_object:
        options["response_format"] = {"type": "json_object"}
    try:
        async with asyncio.timeout(settings.OPENAI_TIMEOUT_SECONDS):
            response = await client.chat.completions.create(**options)
        choice = response.choices[0]
        if getattr(choice, "finish_reason", None) in {"length", "content_filter"}:
            raise AIUnavailableError()
        content = choice.message.content
        if not isinstance(content, str) or not content.strip():
            raise AIUnavailableError()
    except Exception as exc:
        # SDK error bodies can include submitted content. Never log them.
        logger.warning("ai_call_failed operation=%s error_type=%s", operation, type(exc).__name__)
        raise AIUnavailableError() from None
    usage = getattr(response, "usage", None)
    logger.info("ai_call operation=%s model=%s latency_ms=%d input_tokens=%s output_tokens=%s request_id=%s",
                operation, settings.OPENAI_MODEL, (time.monotonic() - started) * 1000,
                getattr(usage, "prompt_tokens", None), getattr(usage, "completion_tokens", None),
                getattr(response, "_request_id", None))
    return content


def is_llm_enabled() -> bool:
    return bool((settings.OPENAI_API_KEY or "").strip())
