"""Optional bounded Gemini audiovisual analysis, sharing the app's dollar ledger.

REST request/usage fields: https://ai.google.dev/api/generate-content
Token preflight: https://ai.google.dev/api/tokens
Input methods: https://ai.google.dev/gemini-api/docs/video-understanding
Reviewed 2026-09-24. Provider access has not been exercised by unit tests.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import time

import httpx

from app.core.ai_context import current_ai_request, finish_provider_call, reserve_provider_call
from app.core.ai_cost import GEMINI_INPUT_TOKEN_BOUND, GEMINI_OUTPUT_TOKEN_BOUND, configured_video_price
from app.core.config import settings
from app.core.llm import AIInputTooLargeError, AIUnavailableError, MAX_PROMPT_CHARACTERS

logger = logging.getLogger(__name__)
# Base64 plus the bounded UTF-8 prompt stays below the documented 20 MB limit.
MAX_MEDIA_BYTES = 14 * 1024 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
_CANONICAL_YOUTUBE = re.compile(r'https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}\Z')
_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models/'


def video_analysis_available() -> bool:
    if not (settings.GEMINI_API_KEY or '').strip():
        return False
    try:
        configured_video_price(settings)
    except (ValueError, ArithmeticError):
        return False
    return True


def validate_media_input(media_data: bytes, media_type: str | None) -> str:
    """Check bounded supported containers before ever sending user bytes upstream."""
    if not isinstance(media_data, bytes) or not media_data:
        raise ValueError('Attach a nonempty supported video or audio file.')
    if len(media_data) > MAX_MEDIA_BYTES:
        raise AIInputTooLargeError('Attach a video or audio file smaller than 14 MB.')
    mime = (media_type or '').split(';', 1)[0].strip().lower()
    mime = {'video/quicktime': 'video/mov', 'audio/mp4': 'audio/m4a',
            'audio/x-m4a': 'audio/m4a', 'audio/mp3': 'audio/mpeg'}.get(mime, mime)
    is_mp4 = len(media_data) >= 16 and media_data[4:8] == b'ftyp' and media_data[8:12] in {
        b'isom', b'iso2', b'iso3', b'iso4', b'iso5', b'iso6', b'mp41', b'mp42', b'avc1',
        b'M4A ', b'M4V ', b'MSNV', b'dash', b'qt  ',
    }
    valid = {
        'video/mp4': is_mp4,
        'video/mov': is_mp4,
        'audio/m4a': is_mp4,
        'video/webm': media_data.startswith(b'\x1a\x45\xdf\xa3'),
        'audio/webm': media_data.startswith(b'\x1a\x45\xdf\xa3'),
        'audio/mpeg': media_data.startswith(b'ID3') or (
            len(media_data) >= 4 and media_data[0] == 0xff and media_data[1] & 0xe0 == 0xe0),
        'audio/wav': len(media_data) >= 12 and media_data[:4] == b'RIFF' and media_data[8:12] == b'WAVE',
        'audio/flac': media_data.startswith(b'fLaC'),
    }
    if not valid.get(mime, False):
        raise ValueError('Use a supported MP4, MOV, WebM, MP3, M4A, WAV, or FLAC file with a matching media type.')
    return mime


async def _post_json(client: httpx.AsyncClient, method: str, payload: dict) -> dict:
    # Stream with a byte limit so a malformed provider response cannot grow RAM
    # without bound. Redirects and proxy environment variables are disabled.
    async with client.stream('POST', f'{_API_ROOT}{settings.GEMINI_MODEL}:{method}', json=payload) as response:
        response.raise_for_status()
        chunks = bytearray()
        async for chunk in response.aiter_bytes():
            chunks.extend(chunk)
            if len(chunks) > MAX_RESPONSE_BYTES:
                raise AIUnavailableError()
    result = json.loads(chunks)
    if not isinstance(result, dict):
        raise AIUnavailableError()
    return result


def _usage(result: dict) -> tuple[int, int]:
    usage = result.get('usageMetadata', {})
    prompt, candidates, total = (usage.get(key) for key in
                                  ('promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'))
    thoughts = usage.get('thoughtsTokenCount', 0)
    if (any(type(value) is not int or value < 0 for value in (prompt, candidates, total, thoughts))
            or prompt > GEMINI_INPUT_TOKEN_BOUND
            or total - prompt != candidates + thoughts
            or total - prompt > GEMINI_OUTPUT_TOKEN_BOUND
            or usage.get('toolUsePromptTokenCount', 0) != 0
            or usage.get('serviceTier', 'standard') not in ('standard', 'unspecified')):
        raise AIUnavailableError()
    return prompt, total - prompt


def _content(result: dict) -> str:
    feedback = result.get('promptFeedback', {})
    if feedback.get('blockReason') or any(rating.get('blocked') for rating in feedback.get('safetyRatings', [])):
        raise AIUnavailableError()
    candidates = result.get('candidates', [])
    if not isinstance(candidates, list) or len(candidates) != 1:
        raise AIUnavailableError()
    candidate = candidates[0]
    if candidate.get('finishReason') != 'STOP' or any(rating.get('blocked') for rating in candidate.get('safetyRatings', [])):
        raise AIUnavailableError()
    parts = candidate.get('content', {}).get('parts', [])
    if any('functionCall' in part or 'executableCode' in part for part in parts):
        raise AIUnavailableError()
    text = ''.join(part.get('text', '') for part in parts if not part.get('thought'))
    if not text.strip() or not isinstance(json.loads(text), dict):
        raise AIUnavailableError()
    return text


async def complete_video(prompt: str, *, source_url: str | None = None,
                         media_data: bytes | None = None, media_type: str | None = None,
                         response_schema: dict | None = None) -> str:
    """Return raw recipe JSON; exactly one metered generation and no retries.

    Source URL must already be canonical and is revalidated here. Gemini accepts
    public YouTube videos only; provider rejection is never bypassed with another
    host, scraping, private content, or hidden model-generated substitute recipe.
    """
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError('Video analysis requires a prompt.')
    if len(prompt) > MAX_PROMPT_CHARACTERS:
        raise AIInputTooLargeError('The recipe text is too long. Please shorten it and try again.')
    if (source_url is None) == (media_data is None):
        raise ValueError('Supply exactly one YouTube URL or attached media file.')
    if source_url is not None:
        if not isinstance(source_url, str) or not _CANONICAL_YOUTUBE.fullmatch(source_url):
            raise ValueError('Use a canonical public YouTube video link.')
        if media_type is not None:
            raise ValueError('A YouTube source does not accept an uploaded media type.')
        media_part = {'fileData': {'fileUri': source_url, 'mimeType': 'video/mp4'}}
    else:
        mime = validate_media_input(media_data, media_type)
        media_part = {'inlineData': {'mimeType': mime, 'data': base64.b64encode(media_data).decode('ascii')}}
    context = current_ai_request.get()
    if not video_analysis_available() or context is None:
        raise AIUnavailableError()
    call_id = None
    generation_started = False
    reconciled = False
    try:
        call_id = await reserve_provider_call(context, None, 'video_analysis',
            price=configured_video_price(settings), input_bound=GEMINI_INPUT_TOKEN_BOUND,
            output_bound=GEMINI_OUTPUT_TOKEN_BOUND)
        timeout = min(settings.GEMINI_TIMEOUT_SECONDS, context.deadline - time.monotonic())
        if timeout <= 0:
            raise AIUnavailableError()
        contents = [{'role': 'user', 'parts': [media_part, {'text': prompt}]}]
        generation_config = {'candidateCount': 1,
                             'maxOutputTokens': settings.GEMINI_MAX_OUTPUT_TOKENS,
                             'responseMimeType': 'application/json'}
        if response_schema is not None:
            generation_config['responseJsonSchema'] = response_schema
        async with asyncio.timeout(timeout):
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False,
                                       headers={'x-goog-api-key': settings.GEMINI_API_KEY.strip()}) as client:
                counted = await _post_json(client, 'countTokens', {'contents': contents})
                count = counted.get('totalTokens')
                if type(count) is not int or not 0 < count <= GEMINI_INPUT_TOKEN_BOUND:
                    raise AIUnavailableError()
                generation_started = True
                result = await _post_json(client, 'generateContent', {
                    'contents': contents, 'serviceTier': 'standard', 'store': False,
                    'generationConfig': generation_config,
                })
        # Bill every charged token, including thinking, before checking content.
        input_tokens, output_tokens = _usage(result)
        await finish_provider_call(call_id, input_tokens=input_tokens, output_tokens=output_tokens,
                                   provider_request_id=result.get('responseId'))
        reconciled = True
        return _content(result)
    except BaseException as exc:
        context.denied = True
        if call_id is not None and not reconciled:
            # Preflight cannot create a generation charge. Once generation starts,
            # timeout/cancellation/5xx/missing usage retain the full reservation.
            denied = not generation_started or (isinstance(exc, httpx.HTTPStatusError)
                       and exc.response.status_code in {400, 401, 403, 404, 422, 429})
            try:
                async with asyncio.timeout(5):
                    await finish_provider_call(call_id, denied=denied)
            except Exception:
                logger.warning('video_ai_reconciliation_unavailable')
        if not isinstance(exc, Exception):
            raise
        # Do not log exception strings, source URLs, prompt/media, or credentials.
        logger.warning('video_ai_call_failed error_type=%s', type(exc).__name__)
        raise AIUnavailableError() from None
    finally:
        if call_id is not None:
            context.call_active = False
