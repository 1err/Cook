import json
import socket
from http.client import IncompleteRead
from io import BytesIO
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from urllib.request import Request

import pytest
from requests import HTTPError as RequestsHTTPError
from youtube_transcript_api import (
    AgeRestricted,
    FailedToCreateConsentCookie,
    IpBlocked,
    NoTranscriptFound,
    PoTokenRequired,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
    VideoUnplayable,
    YouTubeDataUnparsable,
    YouTubeRequestFailed,
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


def _snippet(text: str):
    return SimpleNamespace(text=text, start=0.0, duration=1.0)


def _youtube_watch_opener(*, video_id: str, title: str, description: str):
    player_response = {
        "playabilityStatus": {"status": "OK"},
        "videoDetails": {
            "videoId": video_id,
            "title": title,
            "shortDescription": description,
        }
    }
    raw = (
        "<html><script>var ytInitialPlayerResponse = "
        + json.dumps(player_response)
        + ";</script></html>"
    ).encode()

    def opener(request, *, timeout: int):
        assert request.full_url == f"https://www.youtube.com/watch?v={video_id}"
        assert timeout == 10
        return _FakeResponse(raw)

    return opener


def test_fetch_youtube_text_uses_current_api_and_snippet_objects(monkeypatch):
    requested_ids = []

    class Track:
        language_code = "fr"

        def fetch(self):
            return [_snippet("Coupez les oignons."), _snippet(" Faites-les revenir. ")]

    class Tracks:
        def find_transcript(self, languages):
            assert languages == ["en", "zh", "zh-Hans", "zh-Hant"]
            raise NoTranscriptFound("id", languages, [])

        def __iter__(self):
            return iter([Track()])

    class Api:
        def list(self, video_id):
            requested_ids.append(video_id)
            return Tracks()

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)

    result = fetch_youtube_text(parse_video_source("https://youtu.be/A6bByqI_TH8"))

    assert result.status == "ok"
    assert result.text == "Coupez les oignons. Faites-les revenir."
    assert requested_ids == ["A6bByqI_TH8"]


def test_fetch_youtube_text_tries_remaining_track_after_empty_preferred_track(monkeypatch):
    class Track:
        def __init__(self, language_code, snippets):
            self.language_code = language_code
            self._snippets = snippets

        def fetch(self):
            return self._snippets

    empty_english = Track("en", [_snippet(" ")])
    usable_french = Track("fr", [_snippet("Hachez l'ail."), _snippet(" Ajoutez-le. ")])

    class Tracks:
        def find_transcript(self, languages):
            return empty_english

        def __iter__(self):
            return iter([empty_english, usable_french])

    class Api:
        def list(self, video_id):
            return Tracks()

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "ok"
    assert result.text == "Hachez l'ail. Ajoutez-le."


def test_fetch_youtube_text_tries_generated_track_after_empty_manual_track(monkeypatch):
    class Track:
        def __init__(self, snippets):
            self.language_code = "en"
            self._snippets = snippets

        def fetch(self):
            return self._snippets

    empty_manual = Track([_snippet(" ")])
    usable_generated = Track([_snippet("Brown the tofu, then add the eggplant.")])

    class Tracks:
        def find_transcript(self, languages):
            return empty_manual

        def __iter__(self):
            return iter([empty_manual, usable_generated])

    class Api:
        def list(self, video_id):
            return Tracks()

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "ok"
    assert result.text == "Brown the tofu, then add the eggplant."


def test_fetch_youtube_text_tries_remaining_track_after_po_token_failure(monkeypatch):
    class RestrictedTrack:
        language_code = "en"

        def fetch(self):
            raise PoTokenRequired("dQw4w9WgXcQ")

    class UsableTrack:
        language_code = "zh-Hans"

        def fetch(self):
            return [_snippet("将豆腐煎至金黄。")]

    class Tracks:
        def find_transcript(self, languages):
            return restricted

        def __iter__(self):
            return iter([restricted, UsableTrack()])

    restricted = RestrictedTrack()

    class Api:
        def list(self, video_id):
            return Tracks()

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "ok"
    assert result.text == "将豆腐煎至金黄。"


def test_fetch_youtube_text_tries_remaining_track_after_caption_request_failure(monkeypatch):
    class FailedTrack:
        language_code = "en"

        def fetch(self):
            raise YouTubeRequestFailed(
                "dQw4w9WgXcQ",
                RequestsHTTPError("caption endpoint returned 503"),
            )

    class UsableTrack:
        language_code = "zh-Hans"

        def fetch(self):
            return [_snippet("将茄子炒软。")]

    failed = FailedTrack()

    class Tracks:
        def find_transcript(self, languages):
            return failed

        def __iter__(self):
            return iter([failed, UsableTrack()])

    class Api:
        def list(self, video_id):
            return Tracks()

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "ok"
    assert result.text == "将茄子炒软。"


@pytest.mark.parametrize(
    ("track_error", "expected_status"),
    [
        (
            YouTubeRequestFailed(
                "dQw4w9WgXcQ",
                RequestsHTTPError("caption endpoint returned 503"),
            ),
            "fetch_failed",
        ),
        (PoTokenRequired("dQw4w9WgXcQ"), "captions_unavailable"),
    ],
)
def test_fetch_youtube_text_preserves_terminal_track_failure_after_all_tracks_fail(
    monkeypatch, track_error, expected_status
):
    class FailedTrack:
        language_code = "en"

        def fetch(self):
            raise track_error

    failed = FailedTrack()

    class Tracks:
        def find_transcript(self, languages):
            return failed

        def __iter__(self):
            return iter([failed])

    class Api:
        def list(self, video_id):
            return Tracks()

    def unavailable_metadata(_request, *, timeout: int):
        raise URLError("offline")

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        unavailable_metadata,
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == expected_status
    assert result.text == ""


def test_fetch_youtube_text_falls_back_to_public_description_when_caption_ip_is_blocked(
    monkeypatch,
):
    class BlockedTrack:
        language_code = "en"

        def fetch(self):
            raise IpBlocked("A6bByqI_TH8")

    class Tracks:
        def find_transcript(self, languages):
            return BlockedTrack()

        def __iter__(self):
            return iter([BlockedTrack()])

    class Api:
        def list(self, video_id):
            return Tracks()

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        _youtube_watch_opener(
            video_id="A6bByqI_TH8",
            title="豆腐茄子煲",
            description="【主料】老豆腐（约400克） 紫皮茄子（1根）【做法】将豆腐煎至金黄。",
        ),
        raising=False,
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/A6bByqI_TH8"))

    assert result.status == "ok"
    assert result.title == "豆腐茄子煲"
    assert "老豆腐（约400克）" in result.text
    assert "将豆腐煎至金黄" in result.text


def test_fetch_youtube_text_rejects_youtube_watch_redirects(monkeypatch):
    class Api:
        def list(self, video_id):
            raise IpBlocked(video_id)

    class RedirectingOpener:
        def open(self, request, *, timeout: int):
            raise HTTPError(
                request.full_url,
                302,
                "Found",
                {"Location": "http://127.0.0.1/private"},
                BytesIO(),
            )

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)
    monkeypatch.setattr(
        video_import,
        "_YOUTUBE_WATCH_OPENER",
        RedirectingOpener(),
        raising=False,
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "fetch_failed"
    assert result.text == ""


@pytest.mark.parametrize(
    "watch_page",
    [
        b"<script>var ytInitialPlayerResponse = {not-json};</script>",
        b"\xff\xfe\xfd",
        (
            b'<script>var ytInitialPlayerResponse = {"videoDetails":'
            b'{"videoId":"wrongVideo1","title":"Wrong","shortDescription":"Recipe text"}};'
            b"</script>"
        ),
        (
            b'<script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED"},'
            b'"videoDetails":{"videoId":"dQw4w9WgXcQ","title":"Private recipe",'
            b'"shortDescription":"This account-gated description must not be used."}};'
            b"</script>"
        ),
        (
            b'<script>var ytInitialPlayerResponse = {"videoDetails":'
            b'{"videoId":"dQw4w9WgXcQ","title":"No description","shortDescription":"  "}};'
            b"</script>"
        ),
    ],
)
def test_youtube_description_fallback_rejects_untrusted_or_malformed_pages(
    monkeypatch, watch_page
):
    class Api:
        def list(self, video_id):
            raise IpBlocked(video_id)

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        lambda _request, *, timeout: _FakeResponse(watch_page),
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "fetch_failed"
    assert result.text == ""


def test_youtube_description_fallback_caps_watch_page_size(monkeypatch):
    class Api:
        def list(self, video_id):
            raise IpBlocked(video_id)

    response = _FakeResponse(b"x" * 3_000_001)
    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        lambda _request, *, timeout: response,
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "fetch_failed"
    assert result.text == ""
    assert response.read_sizes == [3_000_001]


@pytest.mark.parametrize("blocked_error", [IpBlocked, RequestBlocked])
def test_fetch_youtube_text_reports_server_block_without_blaming_captions(
    monkeypatch, blocked_error
):
    class Api:
        def list(self, video_id):
            raise blocked_error(video_id)

    def unavailable_metadata(_request, *, timeout: int):
        raise URLError("offline")

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        unavailable_metadata,
        raising=False,
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "fetch_failed"
    assert result.message == (
        "YouTube is temporarily blocking caption requests from Chef World. "
        "The video may still have captions; try again later or paste the transcript."
    )
    assert "disabled" not in result.message.lower()
    assert result.text == ""


def test_fetch_youtube_text_reports_unavailable_public_text_without_false_disabled_claim(
    monkeypatch,
):
    class Api:
        def list(self, video_id):
            raise TranscriptsDisabled(video_id)

    def unavailable_metadata(_request, *, timeout: int):
        raise URLError("offline")

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        unavailable_metadata,
        raising=False,
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "captions_unavailable"
    assert result.message == (
        "No public caption track or usable video description was available. "
        "Paste a transcript instead."
    )
    assert "disabled" not in result.message.lower()
    assert result.text == ""


@pytest.mark.parametrize(
    "unavailable_error",
    [
        VideoUnavailable("dQw4w9WgXcQ"),
        VideoUnplayable("dQw4w9WgXcQ", "Region restricted", []),
        AgeRestricted("dQw4w9WgXcQ"),
    ],
)
def test_fetch_youtube_text_reports_video_not_publicly_accessible(
    monkeypatch, unavailable_error
):
    class Api:
        def list(self, video_id):
            raise unavailable_error

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "video_unavailable"
    assert result.message == (
        "This YouTube video is not publicly accessible to Chef World. "
        "Check that the link is public or unlisted, or paste a transcript."
    )
    assert result.text == ""


def test_fetch_youtube_text_reports_missing_tracks(monkeypatch):
    class Tracks:
        def find_transcript(self, languages):
            raise NoTranscriptFound("id", languages, [])

        def __iter__(self):
            return iter(())

    class Api:
        def list(self, video_id):
            return Tracks()

    def unavailable_metadata(_request, *, timeout: int):
        raise URLError("offline")

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        unavailable_metadata,
        raising=False,
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "no_transcript"
    assert result.message == (
        "No usable public captions or video description were found. "
        "Paste a transcript instead."
    )
    assert result.text == ""


def test_fetch_youtube_text_reports_empty_snippets(monkeypatch):
    class Track:
        language_code = "en"

        def fetch(self):
            return [_snippet(" "), SimpleNamespace(start=1.2, duration=1.0), "not-a-snippet"]

    class Tracks:
        def find_transcript(self, languages):
            return Track()

        def __iter__(self):
            return iter([Track()])

    class Api:
        def list(self, video_id):
            return Tracks()

    def unavailable_metadata(_request, *, timeout: int):
        raise URLError("offline")

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        unavailable_metadata,
        raising=False,
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "no_transcript"
    assert result.text == ""


def test_fetch_youtube_text_reports_unexpected_failures(monkeypatch):
    class Api:
        def list(self, video_id):
            raise RuntimeError("network unavailable")

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)

    result = fetch_youtube_text(parse_video_source("https://youtu.be/dQw4w9WgXcQ"))

    assert result.status == "fetch_failed"
    assert result.message == "We could not fetch captions from YouTube for this video right now. Please try again or paste a transcript."
    assert result.text == ""


@pytest.mark.parametrize(
    "retrieval_error",
    [
        YouTubeDataUnparsable("A6bByqI_TH8"),
        FailedToCreateConsentCookie("A6bByqI_TH8"),
        YouTubeRequestFailed(
            "A6bByqI_TH8",
            RequestsHTTPError("caption endpoint returned 503"),
        ),
    ],
)
def test_fetch_youtube_text_uses_public_description_after_typed_retrieval_failure(
    monkeypatch, retrieval_error
):
    class Api:
        def list(self, video_id):
            raise retrieval_error

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        _youtube_watch_opener(
            video_id="A6bByqI_TH8",
            title="豆腐茄子煲",
            description="【主料】老豆腐（约400克）【做法】煎至金黄。",
        ),
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/A6bByqI_TH8"))

    assert result.status == "ok"
    assert "老豆腐（约400克）" in result.text


def test_fetch_youtube_text_uses_public_description_when_dependency_is_missing(monkeypatch):
    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", None)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        _youtube_watch_opener(
            video_id="A6bByqI_TH8",
            title="豆腐茄子煲",
            description="【主料】老豆腐（约400克）【做法】煎至金黄。",
        ),
    )

    result = fetch_youtube_text(parse_video_source("https://youtu.be/A6bByqI_TH8"))

    assert result.status == "ok"
    assert "老豆腐（约400克）" in result.text


def test_fetch_youtube_text_reports_missing_dependency(monkeypatch):
    def unavailable_metadata(_request, *, timeout: int):
        raise URLError("offline")

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", None)
    monkeypatch.setattr(
        video_import,
        "_open_youtube_watch_page",
        unavailable_metadata,
    )

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
            return [_snippet("Whisk the eggs.")]

    class Tracks:
        def find_transcript(self, languages):
            return Track()

        def __iter__(self):
            return iter([Track()])

    class Api:
        def list(self, video_id):
            return Tracks()

    monkeypatch.setattr(video_import, "YouTubeTranscriptApi", Api)

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
