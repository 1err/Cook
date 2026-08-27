import pytest
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)

import app.video_import as video_import
from app.video_import import (
    UnsupportedVideoUrl,
    fetch_youtube_text,
    parse_video_source,
)


@pytest.mark.parametrize(
    ("raw", "provider", "external_id", "canonical"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ?t=10", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://m.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
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
