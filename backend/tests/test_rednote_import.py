import json
from io import BytesIO
from urllib.error import HTTPError

import pytest

from app.video_import import UnsupportedVideoUrl, parse_video_source


NOTE_ID = "6411cf99000000001300b6d9"
URL = f"https://www.xiaohongshu.com/explore/{NOTE_ID}"


@pytest.mark.parametrize("value", [URL, URL.replace("/explore/", "/discovery/item/") + "?xsec_token=abc%3D&xsec_source=pc_share", "蛋糕教程 http://xhslink.com/a/Abc123，复制后打开小红书！"])
def test_rednote_links_and_whole_share_text(value):
    result = parse_video_source(value)
    assert result.provider == "xiaohongshu"
    assert result.original_url.startswith("https://")
    if "xsec_token" in value:
        assert "xsec_token=abc%3D" in result.original_url
        assert result.canonical_url == URL
    if "xhslink" in value:
        assert result.original_url == "https://xhslink.com/a/Abc123"


@pytest.mark.parametrize("value", ["https://xiaohongshu.com.evil.test/explore/" + NOTE_ID, "https://user@www.xiaohongshu.com/explore/" + NOTE_ID, "https://www.xiaohongshu.com:444/explore/" + NOTE_ID, "https://www.xiaohongshu.com/user/profile/" + NOTE_ID, "https://127.0.0.1/explore/" + NOTE_ID])
def test_rednote_rejects_unsafe_links(value):
    with pytest.raises(UnsupportedVideoUrl):
        parse_video_source(value)


class Response(BytesIO):
    headers = {}


def note_page(note=None, *, note_id=NOTE_ID):
    note = note if note is not None else {"noteId": NOTE_ID, "title": "蒸蛋", "desc": "2个鸡蛋，加水搅拌，蒸10分钟。"}
    state = {"note": {"noteDetailMap": {note_id: {"note": note}}}}
    return ("<script>window.__INITIAL_STATE__=" + json.dumps(state, ensure_ascii=False)[:-1] + ',"other":undefined}</script>').encode()


def test_extracts_only_expected_note_and_preserves_chinese():
    from app.rednote import fetch_rednote_text
    result = fetch_rednote_text(parse_video_source(URL), opener=lambda *a, **kw: Response(note_page()))
    assert result.status == "ok"
    assert "蒸10分钟" in result.text
    assert result.title == "蒸蛋"
    assert result.source.canonical_url == URL


@pytest.mark.parametrize("page", [b"<title>Login</title><script>window.__INITIAL_STATE__={}</script>", note_page(note_id="another-note"), note_page({"noteId": "different", "desc": "wrong recipe"}), note_page({"noteId": NOTE_ID, "title": "recipe", "desc": ""}), b"x" * 3_000_001], ids=["login", "wrong-key", "wrong-id", "empty", "oversized"])
def test_login_wrong_note_and_empty_pages_never_become_recipes(page):
    from app.rednote import fetch_rednote_text
    result = fetch_rednote_text(parse_video_source(URL), opener=lambda *a, **kw: Response(page))
    assert result.status != "ok"
    assert "upload" in result.message.lower()


def test_short_link_redirect_preserves_token_and_rejects_untrusted_targets():
    from app.rednote import fetch_rednote_text
    calls = []
    def opener(request, **kw):
        calls.append(request.full_url)
        if len(calls) == 1:
            raise HTTPError(request.full_url, 302, "Found", {"Location": URL + "?xsec_token=abc%3D"}, None)
        return Response(note_page())
    result = fetch_rednote_text(parse_video_source("http://xhslink.com/a/Abc123"), opener=opener)
    assert result.status == "ok"
    assert calls[1] == URL + "?xsec_token=abc%3D"
    assert result.source.canonical_url == URL
    calls.clear()
    def unsafe(request, **kw):
        calls.append(request.full_url)
        raise HTTPError(request.full_url, 302, "Found", {"Location": "http://127.0.0.1/private"}, None)
    assert fetch_rednote_text(parse_video_source(URL), opener=unsafe).status != "ok"
    assert len(calls) == 1


def test_media_only_note_exposes_allowlisted_video_for_analysis():
    from app.rednote import fetch_rednote_text
    note = {"noteId": NOTE_ID, "title": "蒸蛋", "desc": "", "video": {"media": {"stream": {"h264": [{"masterUrl": "http://sns-video-bd.xhscdn.com/stream/test.mp4"}]}}}}
    result = fetch_rednote_text(parse_video_source(URL), opener=lambda *a, **kw: Response(note_page(note)))
    assert result.status == "ok"
    assert result.media_url == "https://sns-video-bd.xhscdn.com/stream/test.mp4"


@pytest.mark.parametrize("url", ["https://sns-video-bd.xhscdn.com.evil.test/a", "https://user@sns-video-bd.xhscdn.com/a", "https://127.0.0.1/a", "file:///etc/passwd", "https://sns-video-bd.xhscdn.com:444/a"])
def test_media_host_validation(url):
    from app.rednote import safe_rednote_media_url
    assert safe_rednote_media_url(url) is None


@pytest.mark.parametrize("location", ["/login?redirectPath=%2Fdiscovery%2Fitem%2Fexample", "https://www.xiaohongshu.com/login/", "https://m.xiaohongshu.com/login"])
def test_login_redirect_explains_access_requirement_without_following_it(location):
    from app.rednote import fetch_rednote_text
    calls = []
    def opener(request, **kwargs):
        calls.append(request.full_url)
        raise HTTPError(request.full_url, 302, "Found", {"Location": location}, None)
    result = fetch_rednote_text(parse_video_source(URL), opener=opener)
    assert result.status == "access_required"
    assert "requires sign-in" in result.message
    assert "Upload the saved video" in result.message
    assert result.text == ""
    assert calls == [URL]


def test_lookalike_login_redirect_is_not_attributed_to_rednote():
    from app.rednote import fetch_rednote_text
    def opener(request, **kwargs):
        raise HTTPError(request.full_url, 302, "Found", {"Location": "https://www.xiaohongshu.com.evil.test/login"}, None)
    assert fetch_rednote_text(parse_video_source(URL), opener=opener).status == "no_transcript"
