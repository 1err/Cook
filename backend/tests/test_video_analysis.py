"""Exercise HTTP requests and the real request ledger admission together."""
import asyncio
import base64
from contextlib import asynccontextmanager
from decimal import Decimal
import importlib
import json
import time
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app.core import ai_context
from app.core.ai_context import AIRequestContext, current_ai_request
from app.core.llm import AIInputTooLargeError, AIUnavailableError

URL = "https://www.youtube.com/watch?v=A6bByqI_TH8"
MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42"


def module():
    return importlib.import_module("app.services.video_analysis")


@pytest.fixture
def provider(monkeypatch):
    video = module()
    values = dict(GEMINI_API_KEY="fake-video-test-key", GEMINI_MODEL="gemini-3.5-flash-lite",
                  GEMINI_PRICE_MODEL="gemini-3.5-flash-lite", GEMINI_PRICE_VERSION="2026-09-24",
                  GEMINI_INPUT_USD_PER_MILLION_TOKENS=Decimal(".30"),
                  GEMINI_OUTPUT_USD_PER_MILLION_TOKENS=Decimal("2.50"),
                  AI_MONTHLY_BUDGET_USD=Decimal("30"), AI_ACCOUNT_MONTHLY_BUDGET_USD=Decimal("3"))
    for key, value in values.items():
        monkeypatch.setattr(video.settings, key, value)
    return video


@pytest.fixture
def ledger(monkeypatch):
    state = SimpleNamespace(reservations=[], finishes=[], events=[], in_transaction=False)
    @asynccontextmanager
    async def session():
        state.in_transaction = True
        async def commit():
            state.events.append("commit")
        try:
            yield SimpleNamespace(commit=commit)
        finally:
            state.in_transaction = False
    async def reserve(session, **kwargs):
        state.events.append("reserve")
        state.reservations.append(kwargs)
    async def reconcile(session, call_id, **kwargs):
        state.finishes.append(kwargs)
    monkeypatch.setattr(ai_context, "session_factory", lambda: session)
    monkeypatch.setattr(ai_context, "reserve_call", reserve)
    monkeypatch.setattr(ai_context, "reconcile_call", reconcile)
    return state


@pytest.fixture
def admitted():
    context = AIRequestContext(str(uuid4()), uuid4(), time.monotonic() + 30)
    token = current_ai_request.set(context)
    try:
        yield context
    finally:
        current_ai_request.reset(token)


def response_payload():
    return {"candidates": [{"finishReason": "STOP", "content": {"role": "model", "parts": [{"text": '{"title":"Eggplant"}'}]}}],
            "usageMetadata": {"promptTokenCount": 1200, "candidatesTokenCount": 100, "thoughtsTokenCount": 50,
                              "totalTokenCount": 1350}, "responseId": "provider-request"}


def mock_http(monkeypatch, provider, ledger, *, result=None, count=None, error=None, status=200):
    requests = []
    async def handler(request):
        assert not ledger.in_transaction
        requests.append(request)
        ledger.events.append(request.url.path.rsplit(":", 1)[-1])
        if request.url.path.endswith(":countTokens"):
            return httpx.Response(200, json={"totalTokens": 1200} if count is None else count)
        if error:
            raise error
        return httpx.Response(status, json=response_payload() if result is None else result)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
    return requests


def test_missing_credentials_or_reviewed_pricing_disable_video(provider, monkeypatch):
    assert provider.video_analysis_available()
    for key, value in [("GEMINI_API_KEY", ""), ("GEMINI_PRICE_VERSION", ""),
                       ("GEMINI_MODEL", "unreviewed"), ("GEMINI_INPUT_USD_PER_MILLION_TOKENS", Decimal(".01")),
                       ("GEMINI_OUTPUT_USD_PER_MILLION_TOKENS", None)]:
        with monkeypatch.context() as patch:
            patch.setattr(provider.settings, key, value)
            assert not provider.video_analysis_available()


def test_native_media_mimes_normalize_to_documented_provider_types(provider):
    assert provider.validate_media_input(MP4.replace(b'isom', b'qt  '), 'video/quicktime') == 'video/mov'
    assert provider.validate_media_input(MP4, 'audio/mp4') == 'audio/m4a'


@pytest.mark.asyncio
async def test_youtube_request_precounts_and_accounts_for_thinking(provider, monkeypatch, ledger, admitted):
    requests = mock_http(monkeypatch, provider, ledger)
    assert await provider.complete_video("Extract JSON.", source_url=URL) == '{"title":"Eggplant"}'
    assert ledger.events[:4] == ["reserve", "commit", "countTokens", "generateContent"]
    request = json.loads(requests[-1].content)
    assert request["contents"][0]["parts"][0] == {"fileData": {"fileUri": URL, "mimeType": "video/mp4"}}
    assert request["generationConfig"]["responseMimeType"] == "application/json"
    assert request["generationConfig"]["candidateCount"] == 1
    assert request["serviceTier"] == "standard"
    assert requests[-1].headers["x-goog-api-key"] == "fake-video-test-key"
    assert "key" not in requests[-1].url.params
    reservation = ledger.reservations[0]
    assert reservation["input_bound"] == 1048576
    assert reservation["output_bound"] == 65536
    assert reservation["global_cap"] == 30_000_000_000
    assert reservation["price"].model == "gemini-3.5-flash-lite"
    assert ledger.finishes == [{"input_tokens": 1200, "output_tokens": 150, "provider_request_id": "provider-request"}]
    assert admitted.calls == 1 and not admitted.call_active


@pytest.mark.asyncio
@pytest.mark.parametrize("data,mime", [(MP4, "video/mp4"), (b"RIFF\x24\x00\x00\x00WAVEfmt "+b"\x00"*32, "audio/wav")])
async def test_upload_sends_actual_media_bytes(provider, monkeypatch, ledger, admitted, data, mime):
    requests = mock_http(monkeypatch, provider, ledger)
    await provider.complete_video("Extract JSON.", media_data=data, media_type=mime)
    for request in requests:
        payload = json.loads(request.content)
        part = payload["contents"][0]["parts"][0]
        assert part["inlineData"] == {"mimeType": mime, "data": base64.b64encode(data).decode("ascii")}


@pytest.mark.asyncio
async def test_two_calls_allowed_third_never_contacts_provider(provider, monkeypatch, ledger, admitted):
    requests = mock_http(monkeypatch, provider, ledger)
    await provider.complete_video("Extract JSON.", source_url=URL)
    await provider.complete_video("Audit JSON.", source_url=URL)
    with pytest.raises(AIUnavailableError):
        await provider.complete_video("Third attempt.", source_url=URL)
    assert len(requests) == 4 and len(ledger.reservations) == 2


@pytest.mark.asyncio
async def test_no_request_admission_never_contacts_provider(provider, monkeypatch, ledger):
    requests = mock_http(monkeypatch, provider, ledger)
    with pytest.raises(AIUnavailableError):
        await provider.complete_video("Extract JSON.", source_url=URL)
    assert requests == [] and ledger.reservations == []


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["http://www.youtube.com/watch?v=A6bByqI_TH8", "https://evil.test/watch?v=A6bByqI_TH8",
                                   "https://www.youtube.com@127.0.0.1/watch?v=A6bByqI_TH8", URL+"&redirect=http://localhost",
                                   "https://www.youtube.com:444/watch?v=A6bByqI_TH8"])
async def test_direct_call_rejects_noncanonical_or_private_urls(provider, monkeypatch, ledger, admitted, source):
    requests = mock_http(monkeypatch, provider, ledger)
    with pytest.raises(ValueError):
        await provider.complete_video("Extract JSON.", source_url=source)
    assert not requests and not ledger.reservations


@pytest.mark.asyncio
@pytest.mark.parametrize("data,mime", [(b"<html>not media</html>", "video/mp4"), (MP4, "text/plain"), (b"", "video/mp4")])
async def test_upload_signature_and_mime_required(provider, monkeypatch, ledger, admitted, data, mime):
    requests = mock_http(monkeypatch, provider, ledger)
    with pytest.raises(ValueError):
        await provider.complete_video("Extract JSON.", media_data=data, media_type=mime)
    assert not requests and not ledger.reservations


@pytest.mark.asyncio
async def test_large_inline_media_rejected_before_network(provider, monkeypatch, ledger, admitted):
    requests = mock_http(monkeypatch, provider, ledger)
    with pytest.raises(AIInputTooLargeError):
        await provider.complete_video("Extract JSON.", media_data=MP4+b"\x00"*(15*1024*1024), media_type="video/mp4")
    assert not requests and not ledger.reservations


@pytest.mark.asyncio
@pytest.mark.parametrize("finish", ["MAX_TOKENS", "SAFETY", "RECITATION", "OTHER", "", "BLOCKLIST"])
async def test_nonstop_finishes_rejected_but_usage_recorded(provider, monkeypatch, ledger, admitted, finish):
    result = response_payload()
    result["candidates"][0]["finishReason"] = finish
    mock_http(monkeypatch, provider, ledger, result=result)
    with pytest.raises(AIUnavailableError):
        await provider.complete_video("Extract JSON.", source_url=URL)
    assert ledger.finishes[0]["output_tokens"] == 150
    assert admitted.denied


@pytest.mark.asyncio
async def test_prompt_block_rejected_and_missing_usage_retains_reservation(provider, monkeypatch, ledger, admitted):
    mock_http(monkeypatch, provider, ledger, result={"promptFeedback": {"blockReason": "SAFETY"}})
    with pytest.raises(AIUnavailableError):
        await provider.complete_video("Extract JSON.", source_url=URL)
    assert ledger.finishes == [{"denied": False}]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["cancel", "timeout", "rate", "server"])
async def test_failure_reconciliation_preserves_uncertain_charges(provider, monkeypatch, ledger, admitted, failure):
    error = {"cancel": asyncio.CancelledError(), "timeout": httpx.ReadTimeout("private text"),
             "rate": None, "server": None}[failure]
    mock_http(monkeypatch, provider, ledger, error=error, status={"rate":429, "server":500}.get(failure,200))
    with pytest.raises(asyncio.CancelledError if failure == "cancel" else AIUnavailableError):
        await provider.complete_video("Extract JSON.", source_url=URL)
    assert ledger.finishes == [{"denied": failure == "rate"}]
    assert admitted.denied and not admitted.call_active


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [{}, {"totalTokens": -1}, {"totalTokens": True}, {"totalTokens": 1048577}])
async def test_invalid_count_prevents_generation_and_releases_unused_reservation(provider, monkeypatch, ledger, admitted, count):
    requests = mock_http(monkeypatch, provider, ledger, count=count)
    with pytest.raises(AIUnavailableError):
        await provider.complete_video("Extract JSON.", source_url=URL)
    assert len(requests) == 1
    assert ledger.finishes == [{"denied": True}]


@pytest.mark.asyncio
@pytest.mark.parametrize("usage", [{}, {"promptTokenCount": 1200, "candidatesTokenCount": 100},
                                  {"promptTokenCount": 1200, "candidatesTokenCount": 100, "totalTokenCount": 1200},
                                  {"promptTokenCount": True, "candidatesTokenCount": 100, "totalTokenCount": 101}])
async def test_untrusted_usage_never_refunds_full_reservation(provider, monkeypatch, ledger, admitted, usage):
    result = response_payload()
    result["usageMetadata"] = usage
    mock_http(monkeypatch, provider, ledger, result=result)
    with pytest.raises(AIUnavailableError):
        await provider.complete_video("Extract JSON.", source_url=URL)
    assert ledger.finishes == [{"denied": False}]


@pytest.mark.asyncio
async def test_missing_key_prevents_all_http_and_accounting(provider, monkeypatch, ledger, admitted):
    monkeypatch.setattr(provider.settings, "GEMINI_API_KEY", "")
    requests = mock_http(monkeypatch, provider, ledger)
    with pytest.raises(AIUnavailableError):
        await provider.complete_video("Extract JSON.", source_url=URL)
    assert not requests and not ledger.reservations


@pytest.mark.asyncio
@pytest.mark.parametrize("bounds", [{}, {"input_bound": 100}, {"input_bound": True, "output_bound": 100},
                                   {"input_bound": 100, "output_bound": -1}])
async def test_explicit_provider_price_requires_both_positive_bounds(provider, ledger, admitted, bounds):
    from app.core.ai_cost import configured_video_price
    with pytest.raises(ValueError):
        await ai_context.reserve_provider_call(admitted, None, "video_analysis", price=configured_video_price(provider.settings), **bounds)
    assert not ledger.reservations and admitted.denied


@pytest.mark.asyncio
async def test_oversize_provider_response_stays_reserved(provider, monkeypatch, ledger, admitted):
    result = response_payload()
    result["padding"] = "x" * (2 * 1024 * 1024)
    mock_http(monkeypatch, provider, ledger, result=result)
    with pytest.raises(AIUnavailableError):
        await provider.complete_video("Extract JSON.", source_url=URL)
    assert ledger.finishes == [{"denied": False}]
