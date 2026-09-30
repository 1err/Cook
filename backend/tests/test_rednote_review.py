"""Independent boundary review of public RedNote retrieval."""
import asyncio
from io import BytesIO
import json
from types import SimpleNamespace
from urllib.error import HTTPError

import httpx
import pytest

from app import rednote
from fastapi import HTTPException
from app.video_import import parse_video_source


NOTE_ID = "6411cf99000000001300b6d9"
NOTE_URL = f"https://www.xiaohongshu.com/explore/{NOTE_ID}"
MEDIA_URL = "https://sns-video-bd.xhscdn.com/example.mp4"


def recipe_page():
    state = {"note": {"noteDetailMap": {NOTE_ID: {"note": {
        "noteId": NOTE_ID, "title": "蒸蛋", "desc": "鸡蛋加水搅匀，蒸10分钟。",
    }}}}}
    return ("<script>window.__INITIAL_STATE__=" + json.dumps(state) + "</script>").encode()


def test_note_read_cannot_accept_result_after_overall_deadline(monkeypatch):
    clock = SimpleNamespace(now=0.0)
    monkeypatch.setattr(rednote, "time", SimpleNamespace(monotonic=lambda: clock.now))

    class SlowResponse(BytesIO):
        def read(self, size=-1):
            # A socket read may keep receiving individual packets before each
            # idle timeout while the total read exceeds the request budget.
            clock.now += 26.0
            return super().read(size)

        read1 = read

    result = rednote.fetch_rednote_text(
        parse_video_source(NOTE_URL),
        opener=lambda *args, **kwargs: SlowResponse(recipe_page()),
    )
    assert result.status != "ok"


@pytest.mark.parametrize("location", [
    "https://www.xiaohongshu.com/login?redirect=" + NOTE_URL,
    "https://www.xiaohongshu.com/404",
    "https://127.0.0.1/private " + NOTE_URL,
    "https://www.xiaohongshu.com/explore/" + "a" * 24,
    "https://www.xiaohongshu.com:444/explore/" + NOTE_ID,
])
def test_note_redirect_rejects_login_wrong_identity_and_embedded_trusted_url(location):
    calls = []

    def opener(request, **kwargs):
        calls.append(request.full_url)
        raise HTTPError(request.full_url, 302, "redirect", {"Location": location}, None)

    result = rednote.fetch_rednote_text(parse_video_source(NOTE_URL), opener=opener)
    assert result.status != "ok"
    assert len(calls) == 1


class Chunks(httpx.AsyncByteStream):
    def __init__(self):
        self.chunks = iter([b"12345", b"67890"])

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.chunks)
        except StopIteration:
            raise StopAsyncIteration from None


@pytest.mark.asyncio
@pytest.mark.parametrize("announce_length", [True, False], ids=["content-length", "stream-overflow"])
async def test_download_preserves_actionable_size_error(monkeypatch, tmp_path, announce_length):
    monkeypatch.setattr(rednote, "MAX_PUBLIC_VIDEO_BYTES", 8)

    def handler(request):
        headers = {"Content-Length": "10"} if announce_length else {}
        return httpx.Response(200, headers=headers, stream=Chunks())

    destination = tmp_path / "video.mp4"
    with pytest.raises(HTTPException) as caught:
        await rednote.download_rednote_video(
            MEDIA_URL, transport=httpx.MockTransport(handler),
        )
    # Let HTTPX finish closing a byte iterator interrupted by the size limit.
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert caught.value.status_code == 413
    assert "Upload a shorter clip" in caught.value.detail["message"]
    assert not destination.exists() or destination.stat().st_size <= 8


@pytest.mark.asyncio
@pytest.mark.parametrize("location", [
    "http://127.0.0.1/private", "https://sns-video-bd.xhscdn.com.evil.test/a",
    "file:///etc/passwd", "https://user:password@sns-video-bd.xhscdn.com/a",
])
async def test_media_redirect_never_requests_untrusted_target(tmp_path, location):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"Location": location})

    with pytest.raises(HTTPException):
        await rednote.download_rednote_video(
            MEDIA_URL, transport=httpx.MockTransport(handler),
        )
    assert calls == [MEDIA_URL]


@pytest.mark.asyncio
async def test_public_video_bytes_are_streamed_to_local_file(tmp_path):
    data = b"\x00\x00\x00\x18ftypisom" + b"public video bytes"
    destination = tmp_path / "video.mp4"
    received, mime = await rednote.download_rednote_video(
        MEDIA_URL,
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=data)),
    )
    assert received == data
    assert mime == "video/mp4"


@pytest.mark.asyncio
@pytest.mark.parametrize("data,headers", [
    (b"<html>Login</html>", {"Content-Type": "video/mp4"}),
    (b"\x00\x00\x00\x18ftypisom" + b"media", {"Content-Type": "text/html"}),
    (b"", {}),
    (b"video", {"Content-Length": "-1"}),
])
async def test_bad_media_never_reaches_analysis(data, headers):
    with pytest.raises(HTTPException):
        await rednote.download_rednote_video(MEDIA_URL,
            transport=httpx.MockTransport(lambda request: httpx.Response(200, content=data, headers=headers)))


@pytest.mark.asyncio
@pytest.mark.parametrize('size', [15*1024*1024,30*1024*1024], ids=['above-previous-cap','exact-new-cap'])
async def test_download_accepts_larger_supported_public_video(size):
    header = b'\x00\x00\x00\x18ftypisom' + b'\x00'*4
    data = header + b'\x00'*(size-len(header))
    received,mime = await rednote.download_rednote_video(MEDIA_URL,
        transport=httpx.MockTransport(lambda request: httpx.Response(200,content=data)))
    assert len(received) == size and received == data and mime == 'video/mp4'


@pytest.mark.asyncio
async def test_download_announced_size_above_source_limit_is_actionable():
    with pytest.raises(HTTPException) as caught:
        await rednote.download_rednote_video(MEDIA_URL,
            transport=httpx.MockTransport(lambda request: httpx.Response(200,
                headers={'Content-Length':str(150*1024*1024+1)})))
    assert caught.value.status_code == 413
    assert caught.value.detail['code'] == 'media_too_large'
    assert '150 MB' in caught.value.detail['message']


@pytest.mark.asyncio
async def test_larger_public_video_is_compressed_before_analysis(monkeypatch):
    from unittest.mock import AsyncMock
    data = b'\x00\x00\x00\x18ftypisom' + b'\0' * (30*1024*1024)
    small = b'\x00\x00\x00\x18ftypisom' + b'\0'*16
    compress = AsyncMock(return_value=small)
    monkeypatch.setattr(rednote, 'compress_public_video', compress)
    received, mime = await rednote.download_rednote_video(MEDIA_URL,
        transport=httpx.MockTransport(lambda r: httpx.Response(200, content=data)))
    assert received == small and mime == 'video/mp4'
    compress.assert_awaited_once()
