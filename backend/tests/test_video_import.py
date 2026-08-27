import json
import socket
from http.client import IncompleteRead
from io import BytesIO
from urllib.error import HTTPError, URLError
from urllib.request import Request

import pytest
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)

import app.video_import as video_import
from app.extract import TranscriptFetchResult, fetch_transcript_from_video_link
from app.video_import import (
    UnsupportedVideoUrl,
    fetch_tiktok_text,
    fetch_youtube_text,
    parse_video_source,
)


TIKTOK_SOURCE = parse_video_source("https://www.tiktok.com/@chef/video/7412345678901234567")


class _FakeResponse:
    def __init__(self, payload: bytes, *, read_error: Exception | None = None):
        self.payload = payload
        self.read_error = read_error
        self.read_sizes: list[int] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size: int) -> bytes:
        self.read_sizes.append(size)
        if self.read_error is not None:
            raise self.read_error
        return self.payload[:size]


def fake_json_response(payload: object):
    raw = json.dumps(payload).encode()

    def opener(_request, *, timeout: int):
        assert timeout == 10
        return _FakeResponse(raw)

    return opener


@pytest.mark.parametrize(
    ("raw", "provider", "external_id", "canonical"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ?t=10", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://m.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://music.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://youtube.com/live/dQw4w9WgXcQ?feature=share", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://youtube-nocookie.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://www.tiktok.com/@chef/video/7412345678901234567?is_from_webapp=1", "tiktok", "7412345678901234567", "https://www.tiktok.com/@chef/video/7412345678901234567"),
        ("https://vm.tiktok.com/ZMexample/", "tiktok", None, "https://vm.tiktok.com/ZMexample/"),
    ],
)
def test_parse_video_source_accepts_supported_forms(raw, provider, external_id, canonical):
    source = parse_video_source(raw)
    assert (source.provider, source.external_id, source.canonical_url) == (
        provider,
        external_id,
        canonical,
    )


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "not-a-url",
        "http://youtu.be/dQw4w9WgXcQ",
        "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
        "https://user@www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com:444/watch?v=dQw4w9WgXcQ",
        "https://studio.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube-nocookie.com.evil.test/embed/dQw4w9WgXcQ",
        "https://youtube-nocookie.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/v/dQw4w9WgXcQ",
        "https://www.youtube.com/live/dQw4w9WgXc",
        "https://www.youtube.com/live/dQw4w9WgXcQx",
        "https://www.tiktok.com/@chef/photo/7412345678901234567",
        "https://[::1",
        "https://www.youtube.com／watch?v=dQw4w9WgXcQ",
    ],
)
def test_parse_video_source_rejects_unsafe_or_unsupported_urls(raw):
    with pytest.raises(UnsupportedVideoUrl):
        parse_video_source(raw)


def test_fetch_youtube_text_uses_063_list_transcripts_and_language_fallback(monkeypatch):
    calls = []

    class Track:
        language_code = "fr"

        def fetch(self):
            return [{"text": "Coupez les oignons."}, {"text": " Faites-les revenir. "}]

    class Tracks:
        def find_transcript(self, languages):
            calls.append(languages)
            raise NoTranscriptFound("id", languages, [])

        def __iter__(self):
            return iter([Track()])

    monkeypatch.setattr(
        video_import.YouTubeTranscriptApi,
        "list_transcripts",
        lambda video_id: Tracks(),
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "ok"
    assert result.text == "Coupez les oignons. Faites-les revenir."
    assert calls == [["en", "zh", "zh-Hans", "zh-Hant"]]


def test_fetch_youtube_text_tries_later_fallback_after_empty_track(monkeypatch):
    class Track:
        def __init__(self, snippets):
            self.language_code = "fr"
            self._snippets = snippets

        def fetch(self):
            return self._snippets

    class Tracks:
        def find_transcript(self, languages):
            raise NoTranscriptFound("id", languages, [])

        def __iter__(self):
            return iter(
                [
                    Track([{"text": " "}, {"start": 1.2}]),
                    Track([{"text": "Hachez l'ail."}, {"text": " Ajoutez-le. "}]),
                ]
            )

    monkeypatch.setattr(
        video_import.YouTubeTranscriptApi,
        "list_transcripts",
        lambda video_id: Tracks(),
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "ok"
    assert result.text == "Hachez l'ail. Ajoutez-le."


def test_fetch_youtube_text_maps_terminal_error_from_fallback_track(monkeypatch):
    class UnavailableTrack:
        language_code = "fr"

        def fetch(self):
            raise VideoUnavailable("dQw4w9WgXcQ")

    class UsableTrack:
        language_code = "de"

        def fetch(self):
            return [{"text": "This track must not mask the terminal error."}]

    class Tracks:
        def find_transcript(self, languages):
            raise NoTranscriptFound("id", languages, [])

        def __iter__(self):
            return iter([UnavailableTrack(), UsableTrack()])

    monkeypatch.setattr(
        video_import.YouTubeTranscriptApi,
        "list_transcripts",
        lambda video_id: Tracks(),
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "video_unavailable"
    assert result.text == ""


def test_fetch_youtube_text_reports_disabled_captions(monkeypatch):
    monkeypatch.setattr(
        video_import.YouTubeTranscriptApi,
        "list_transcripts",
        lambda video_id: (_ for _ in ()).throw(TranscriptsDisabled("dQw4w9WgXcQ")),
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "captions_disabled"
    assert result.message == "This YouTube video has captions disabled. Paste a transcript instead."
    assert result.text == ""


def test_fetch_youtube_text_reports_unavailable_video(monkeypatch):
    monkeypatch.setattr(
        video_import.YouTubeTranscriptApi,
        "list_transcripts",
        lambda video_id: (_ for _ in ()).throw(VideoUnavailable("dQw4w9WgXcQ")),
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "video_unavailable"
    assert result.message == "This YouTube video is unavailable or private. Try another link or paste a transcript."
    assert result.text == ""


def test_fetch_youtube_text_reports_missing_tracks(monkeypatch):
    class Tracks:
        def find_transcript(self, languages):
            raise NoTranscriptFound("id", languages, [])

        def __iter__(self):
            return iter(())

    monkeypatch.setattr(video_import.YouTubeTranscriptApi, "list_transcripts", lambda video_id: Tracks())

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "no_transcript"
    assert result.message == "No usable transcript was found for this YouTube video. Paste a transcript instead."
    assert result.text == ""


def test_fetch_youtube_text_reports_empty_snippets(monkeypatch):
    class Track:
        def fetch(self):
            return [{"text": " "}, {"start": 1.2}, "not-a-snippet"]

    class Tracks:
        def find_transcript(self, languages):
            return Track()

    monkeypatch.setattr(video_import.YouTubeTranscriptApi, "list_transcripts", lambda video_id: Tracks())

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "no_transcript"
    assert result.message == "No usable transcript was found for this YouTube video. Paste a transcript instead."
    assert result.text == ""


def test_fetch_youtube_text_reports_unexpected_failures(monkeypatch):
    monkeypatch.setattr(
        video_import.YouTubeTranscriptApi,
        "list_transcripts",
        lambda video_id: (_ for _ in ()).throw(RuntimeError("network unavailable")),
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "fetch_failed"
    assert result.message == "We could not fetch captions from YouTube for this video right now. Please try again or paste a transcript."
    assert result.text == ""


def test_fetch_youtube_text_reports_missing_dependency(monkeypatch):
    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", None)

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "dependency_missing"
    assert result.message == "YouTube transcript support is not available on the server right now."
    assert result.text == ""


def test_fetch_tiktok_text_returns_public_caption_and_thumbnail():
    payload = {
        "version": "1.0",
        "provider_name": "TikTok",
        "type": "rich",
        "title": "Crispy chili noodles: noodles, garlic, soy sauce; toss for two minutes.",
        "author_name": "Chef Mei",
        "thumbnail_url": "https://p16.example/cover.jpeg",
        "html": "<script>must not be retained</script>",
    }

    result = fetch_tiktok_text(TIKTOK_SOURCE, opener=fake_json_response(payload))

    assert result.status == "ok"
    assert result.text == payload["title"]
    assert result.thumbnail_url == payload["thumbnail_url"]
    assert "html" not in result.text
    assert "script" not in result.text


def test_fetch_tiktok_text_rejects_attribution_only_title():
    result = fetch_tiktok_text(
        TIKTOK_SOURCE,
        opener=fake_json_response(
            {
                "version": "1.0",
                "provider_name": "TikTok",
                "type": "rich",
                "title": "Chef Mei on TikTok",
                "author_name": "Chef Mei",
            }
        ),
    )

    assert result.status == "no_transcript"


@pytest.mark.parametrize(
    ("payload", "expected_thumbnail"),
    [
        (
            {
                "version": "1.0",
                "provider_name": "TikTok",
                "type": "rich",
                "title": "Make ginger scallion noodles with soy sauce.",
                "author_name": "Chef Mei",
                "thumbnail_url": "http://p16.example/cover.jpeg",
            },
            None,
        ),
        (
            {
                "version": "1.0",
                "provider_name": "TikTok",
                "type": "rich",
                "title": "Make ginger scallion noodles with soy sauce.",
                "author_name": "Chef Mei",
                "thumbnail_url": "javascript:alert(1)",
            },
            None,
        ),
    ],
)
def test_fetch_tiktok_text_ignores_unsafe_thumbnail_urls(payload, expected_thumbnail):
    result = fetch_tiktok_text(TIKTOK_SOURCE, opener=fake_json_response(payload))

    assert result.status == "ok"
    assert result.thumbnail_url == expected_thumbnail


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"provider_name": "Not TikTok", "title": "Make noodles with garlic."},
    ],
)
def test_fetch_tiktok_text_rejects_invalid_provider_payload(payload):
    result = fetch_tiktok_text(TIKTOK_SOURCE, opener=fake_json_response(payload))

    assert result.status == "fetch_failed"


def test_fetch_tiktok_text_rejects_invalid_json():
    result = fetch_tiktok_text(TIKTOK_SOURCE, opener=lambda *_args, **_kwargs: _FakeResponse(b"not json"))

    assert result.status == "fetch_failed"


def test_fetch_tiktok_text_rejects_oversized_oembed_response():
    response = _FakeResponse(b"x" * 1_000_001)

    result = fetch_tiktok_text(TIKTOK_SOURCE, opener=lambda *_args, **_kwargs: response)

    assert result.status == "fetch_failed"
    assert response.read_sizes == [1_000_001]


def test_fetch_tiktok_text_rejects_redirect_without_second_request(monkeypatch):
    first_request_urls: list[str] = []

    class RedirectingOpener:
        def open(self, request, *, timeout: int):
            assert timeout == 10
            first_request_urls.append(request.full_url)
            raise HTTPError(
                request.full_url,
                302,
                "Found",
                {"Location": "http://127.0.0.1/private"},
                BytesIO(),
            )

    default_opener = getattr(video_import, "_open_tiktok_oembed", None)
    assert callable(default_opener), "TikTok default opener must reject redirects"
    monkeypatch.setattr(video_import, "_TIKTOK_OEMBED_OPENER", RedirectingOpener())

    result = fetch_tiktok_text(TIKTOK_SOURCE)

    assert result.status == "fetch_failed"
    assert len(first_request_urls) == 1
    assert first_request_urls[0].startswith("https://www.tiktok.com/oembed?")


def test_reject_redirects_handler_declines_follow_up_request():
    request = Request("https://www.tiktok.com/oembed?url=recipe")

    with pytest.raises(HTTPError) as exc_info:
        video_import._RejectRedirects().redirect_request(
            request,
            BytesIO(),
            302,
            "Found",
            {"Location": "http://127.0.0.1/private"},
            "http://127.0.0.1/private",
        )

    assert exc_info.value.code == 302
    assert exc_info.value.url == request.full_url


def test_fetch_tiktok_text_classifies_protocol_read_failure_as_temporary():
    response = _FakeResponse(b"", read_error=IncompleteRead(b"partial", 10))

    result = fetch_tiktok_text(TIKTOK_SOURCE, opener=lambda *_args, **_kwargs: response)

    assert result.status == "fetch_failed"


@pytest.mark.parametrize(
    ("failure", "expected_status"),
    [
        (HTTPError("https://www.tiktok.com/oembed", 404, "missing", None, BytesIO()), "no_transcript"),
        (HTTPError("https://www.tiktok.com/oembed", 408, "timeout", None, BytesIO()), "fetch_failed"),
        (HTTPError("https://www.tiktok.com/oembed", 429, "rate limited", None, BytesIO()), "fetch_failed"),
        (HTTPError("https://www.tiktok.com/oembed", 500, "server", None, BytesIO()), "fetch_failed"),
        (URLError("offline"), "fetch_failed"),
        (socket.timeout("timed out"), "fetch_failed"),
    ],
)
def test_fetch_tiktok_text_classifies_upstream_failures(failure, expected_status):
    def opener(*_args, **_kwargs):
        raise failure

    result = fetch_tiktok_text(TIKTOK_SOURCE, opener=opener)

    assert result.status == expected_status


def test_legacy_transcript_fetch_wrapper_exposes_compatibility_attributes(monkeypatch):
    class Track:
        def fetch(self):
            return [{"text": "Whisk the eggs."}]

    class Tracks:
        def find_transcript(self, languages):
            return Track()

    monkeypatch.setattr(video_import.YouTubeTranscriptApi, "list_transcripts", lambda video_id: Tracks())

    result = fetch_transcript_from_video_link("https://youtu.be/dQw4w9WgXcQ")

    assert isinstance(result, TranscriptFetchResult)
    assert (result.transcript, result.status, result.message, result.video_id) == (
        "Whisk the eggs.",
        "ok",
        None,
        "dQw4w9WgXcQ",
    )


@pytest.mark.parametrize("url", ["https://www.tiktok.com/@chef/video/7412345678901234567", "not-a-url"])
def test_legacy_transcript_fetch_wrapper_rejects_non_youtube_urls(url):
    result = fetch_transcript_from_video_link(url)

    assert (result.transcript, result.status, result.video_id) == ("", "unsupported_url", None)
    assert result.message == "Only YouTube links are supported right now. Paste a transcript for other platforms."
