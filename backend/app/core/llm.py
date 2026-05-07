"""
Shared OpenAI client factory.

Returns ``None`` when ``OPENAI_API_KEY`` is unset so callers can fall back
to non-LLM stubs without re-implementing the env-key check + client construction.
"""
from __future__ import annotations

from typing import Optional

from openai import AsyncOpenAI

from app.core.config import settings


def get_openai_client() -> Optional[AsyncOpenAI]:
    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        return None
    return AsyncOpenAI(api_key=api_key)


def is_llm_enabled() -> bool:
    return bool((settings.OPENAI_API_KEY or "").strip())
