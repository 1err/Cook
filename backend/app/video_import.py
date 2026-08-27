"""Provider-aware parsing and caption retrieval for supported video URLs."""
import asyncio
from dataclasses import dataclass
from http.client import HTTPException
import json
import logging
import re
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import (
        NoTranscriptFound,
        TranscriptsDisabled,
        VideoUnavailable,
    )
except ModuleNotFoundError:
    YouTubeTranscriptApi = None


logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class VideoSource:
    provider: Literal["youtube", "tiktok"]
    original_url: str
    canonical_url: str
    external_id: str | None


@dataclass(frozen=True, slots=True)
class VideoTextResult:
    status: str
    text: str
    source: VideoSource
    message: str | None = None
    title: str | None = None
    thumbnail_url: str | None = None

    @property
    def transcript(self) -> str:
        """Compatibility alias for callers using the previous result shape."""
        return self.text

    @property
    def video_id(self) -> str | None:
        """Compatibility alias for callers using the previous result shape."""
        return self.source.external_id


class UnsupportedVideoUrl(ValueError):
    pass


def parse_video_source(raw_url: str) -> VideoSource:
    original = (raw_url or "").strip()
    try:
        parsed = urlsplit(original)
        port = parsed.port
    except ValueError as exc:
        raise UnsupportedVideoUrl("Paste a public YouTube or TikTok video link.") from exc
    if parsed.scheme != "https" or parsed.username or parsed.password or port not in (None, 443):
        raise UnsupportedVideoUrl("Paste a public YouTube or TikTok video link.")

    host = (parsed.hostname or "").lower().rstrip(".")
    youtube_id = _youtube_id(host, parsed.path, parse_qs(parsed.query))
    if youtube_id is not None:
        return VideoSource(
            provider="youtube",
            original_url=original,
            canonical_url=f"https://www.youtube.com/watch?v={youtube_id}",
            external_id=youtube_id,
        )

    tiktok_match = re.fullmatch(r"/@([^/]+)/video/(\d+)/?", parsed.path)
    if host in {"www.tiktok.com", "m.tiktok.com"} and tiktok_match:
        creator, post_id = tiktok_match.groups()
        return VideoSource(
            provider="tiktok",
            original_url=original,
            canonical_url=f"https://www.tiktok.com/@{creator}/video/{post_id}",
            external_id=post_id,
        )
    if (
        host in {"vm.tiktok.com", "vt.tiktok.com"}
        and re.fullmatch(r"/[A-Za-z0-9_-]+/?", parsed.path)
    ) or (
        host == "www.tiktok.com"
        and re.fullmatch(r"/t/[A-Za-z0-9_-]+/?", parsed.path)
    ):
        return VideoSource("tiktok", original, original, None)
    raise UnsupportedVideoUrl("Paste a public YouTube or TikTok video link.")


def _failure(source: VideoSource, status: str, message: str) -> VideoTextResult:
    logger.warning(
        "Video text fetch result provider=%s video_id=%s status=%s text_length=0",
        source.provider,
        source.external_id,
        status,
    )
    return VideoTextResult(status=status, text="", source=source, message=message)


def fetch_youtube_text(source: VideoSource) -> VideoTextResult:
    """Fetch a YouTube transcript using the 0.6.3 ``list_transcripts`` API."""
    if YouTubeTranscriptApi is None:
        return _failure(
            source,
            "dependency_missing",
            "YouTube transcript support is not available on the server right now.",
        )
    try:
        tracks = YouTubeTranscriptApi.list_transcripts(source.external_id or "")
        try:
            track = tracks.find_transcript(["en", "zh", "zh-Hans", "zh-Hant"])
        except NoTranscriptFound:
            track = next(iter(tracks), None)
            if track is None:
                return _failure(
                    source,
                    "no_transcript",
                    "No usable transcript was found for this YouTube video. Paste a transcript instead.",
                )
        snippets = track.fetch()
        text = " ".join(
            str(row.get("text", "")).strip()
            for row in snippets
            if isinstance(row, dict) and str(row.get("text", "")).strip()
        )
        if not text:
            return _failure(
                source,
                "no_transcript",
                "No usable transcript was found for this YouTube video. Paste a transcript instead.",
            )
        logger.info(
            "Video text fetch result provider=%s video_id=%s status=ok text_length=%d",
            source.provider,
            source.external_id,
            len(text),
        )
        return VideoTextResult(
            status="ok",
            text=text,
            source=source,
            thumbnail_url=f"https://img.youtube.com/vi/{source.external_id}/hqdefault.jpg",
        )
    except TranscriptsDisabled:
        return _failure(
            source,
            "captions_disabled",
            "This YouTube video has captions disabled. Paste a transcript instead.",
        )
    except VideoUnavailable:
        return _failure(
            source,
            "video_unavailable",
            "This YouTube video is unavailable or private. Try another link or paste a transcript.",
        )
    except NoTranscriptFound:
        return _failure(
            source,
            "no_transcript",
            "No usable transcript was found for this YouTube video. Paste a transcript instead.",
        )
    except Exception:
        return _failure(
            source,
            "fetch_failed",
            "We could not fetch captions from YouTube for this video right now. Please try again or paste a transcript.",
        )


def _safe_https_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return None
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return None
    return candidate


def _meaningful_tiktok_text(title: str, author: str) -> str:
    text = title.strip()
    if not text:
        return ""
    attribution = f"{author.strip()} on TikTok".strip()
    if text.casefold() in {"tiktok", attribution.casefold()}:
        return ""
    return text


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, redirect_url):
        raise HTTPError(request.full_url, code, message, headers, response)


_TIKTOK_OEMBED_OPENER = build_opener(_RejectRedirects())


def _open_tiktok_oembed(request: Request, *, timeout: int):
    return _TIKTOK_OEMBED_OPENER.open(request, timeout=timeout)


def fetch_tiktok_text(source: VideoSource, *, opener=_open_tiktok_oembed) -> VideoTextResult:
    """Fetch recipe-adjacent public text from TikTok's oEmbed endpoint."""
    endpoint = "https://www.tiktok.com/oembed?" + urlencode({"url": source.original_url})
    request = Request(endpoint, headers={"User-Agent": "ChefWorld/1.0"})
    try:
        with opener(request, timeout=10) as response:
            raw = response.read(1_000_001)
    except HTTPError as exc:
        if 400 <= exc.code < 500 and exc.code not in {408, 429}:
            return _failure(
                source,
                "no_transcript",
                "This TikTok is unavailable or does not expose recipe text. Paste its transcript instead.",
            )
        return _failure(
            source,
            "fetch_failed",
            "TikTok is temporarily unavailable. Please try again.",
        )
    except (HTTPException, URLError, TimeoutError, OSError):
        return _failure(
            source,
            "fetch_failed",
            "TikTok is temporarily unavailable. Please try again.",
        )

    if len(raw) > 1_000_000:
        return _failure(source, "fetch_failed", "TikTok returned an invalid response. Please try again.")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _failure(source, "fetch_failed", "TikTok returned an invalid response. Please try again.")
    if not isinstance(payload, dict) or payload.get("provider_name") != "TikTok":
        return _failure(source, "fetch_failed", "TikTok returned an invalid response. Please try again.")

    title = payload.get("title") if isinstance(payload.get("title"), str) else ""
    author = payload.get("author_name") if isinstance(payload.get("author_name"), str) else ""
    text = _meaningful_tiktok_text(title, author)
    if not text:
        return _failure(
            source,
            "no_transcript",
            "This TikTok does not expose enough recipe text. Paste its transcript instead.",
        )
    thumbnail = _safe_https_url(payload.get("thumbnail_url"))
    logger.info(
        "Video text fetch result provider=%s video_id=%s status=ok text_length=%d",
        source.provider,
        source.external_id,
        len(text),
    )
    return VideoTextResult("ok", text, source, title=title, thumbnail_url=thumbnail)


async def fetch_video_text(source: VideoSource) -> VideoTextResult:
    fetcher = fetch_youtube_text if source.provider == "youtube" else fetch_tiktok_text
    return await asyncio.to_thread(fetcher, source)


def _youtube_id(host: str, path: str, query: dict[str, list[str]]) -> str | None:
    if host in {"www.youtube.com", "m.youtube.com", "youtube.com"}:
        if path == "/watch":
            candidate = query.get("v", [None])[0]
        else:
            match = re.fullmatch(r"/(?:shorts|embed)/([A-Za-z0-9_-]{11})/?", path)
            candidate = match.group(1) if match else None
    elif host == "youtu.be":
        match = re.fullmatch(r"/([A-Za-z0-9_-]{11})/?", path)
        candidate = match.group(1) if match else None
    elif host == "www.youtube-nocookie.com":
        match = re.fullmatch(r"/embed/([A-Za-z0-9_-]{11})/?", path)
        candidate = match.group(1) if match else None
    else:
        candidate = None
    return candidate if candidate and re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate) else None
