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
        YouTubeTranscriptApi,
    )
except ImportError:
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


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, redirect_url):
        raise HTTPError(request.full_url, code, message, headers, response)


_YOUTUBE_WATCH_OPENER = build_opener(_RejectRedirects())


def _open_youtube_watch_page(request: Request, *, timeout: int):
    return _YOUTUBE_WATCH_OPENER.open(request, timeout=timeout)


def _youtube_public_description(source: VideoSource) -> VideoTextResult | None:
    request = Request(
        source.canonical_url,
        headers={
            "User-Agent": "ChefWorld/1.0",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with _open_youtube_watch_page(request, timeout=10) as response:
            raw = response.read(3_000_001)
    except (HTTPException, HTTPError, URLError, TimeoutError, OSError):
        return None
    if len(raw) > 3_000_000:
        return None
    try:
        page = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None

    marker = "var ytInitialPlayerResponse = "
    start = page.find(marker)
    if start < 0:
        return None
    try:
        payload, _ = json.JSONDecoder().raw_decode(page[start + len(marker) :])
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    playability = payload.get("playabilityStatus")
    if not isinstance(playability, dict) or playability.get("status") != "OK":
        return None
    if not isinstance(payload.get("videoDetails"), dict):
        return None
    details = payload["videoDetails"]
    if details.get("videoId") != source.external_id:
        return None
    title = details.get("title") if isinstance(details.get("title"), str) else ""
    description = (
        details.get("shortDescription")
        if isinstance(details.get("shortDescription"), str)
        else ""
    )
    title = title.strip()
    description = description.strip()
    if not description:
        return None

    text = f"Video title: {title}\n\nVideo description:\n{description}" if title else description
    logger.info(
        "Video text fetch result provider=%s video_id=%s status=ok source=description text_length=%d",
        source.provider,
        source.external_id,
        len(text),
    )
    return VideoTextResult(
        status="ok",
        text=text,
        source=source,
        title=title or None,
        thumbnail_url=f"https://img.youtube.com/vi/{source.external_id}/hqdefault.jpg",
    )


def _youtube_description_or_failure(
    source: VideoSource,
    status: str,
    message: str,
) -> VideoTextResult:
    return _youtube_public_description(source) or _failure(source, status, message)


def fetch_youtube_text(source: VideoSource) -> VideoTextResult:
    """Fetch public YouTube captions, with public description text as a fallback."""
    if YouTubeTranscriptApi is None:
        return _youtube_description_or_failure(
            source,
            "dependency_missing",
            "YouTube transcript support is not available on the server right now.",
        )
    try:
        tracks = YouTubeTranscriptApi().list(source.external_id or "")
        available_tracks = list(tracks)
        try:
            preferred_track = tracks.find_transcript(["en", "zh", "zh-Hans", "zh-Hant"])
        except NoTranscriptFound:
            candidate_tracks = available_tracks
        else:
            candidate_tracks = [preferred_track]
            candidate_tracks.extend(
                track
                for track in available_tracks
                if track is not preferred_track
            )
        caption_request_failed = False
        po_token_required = False
        for track in candidate_tracks:
            try:
                snippets = track.fetch()
            except PoTokenRequired:
                po_token_required = True
                continue
            except YouTubeRequestFailed:
                caption_request_failed = True
                continue
            text = " ".join(
                str(getattr(row, "text", "")).strip()
                for row in snippets
                if str(getattr(row, "text", "")).strip()
            )
            if text:
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
        if caption_request_failed:
            return _youtube_description_or_failure(
                source,
                "fetch_failed",
                "We could not fetch captions from YouTube for this video right now. "
                "Please try again or paste a transcript.",
            )
        if po_token_required:
            return _youtube_description_or_failure(
                source,
                "captions_unavailable",
                "YouTube did not provide a usable public caption track for this video. "
                "Paste a transcript instead.",
            )
        return _youtube_description_or_failure(
            source,
            "no_transcript",
            "No usable public captions or video description were found. Paste a transcript instead.",
        )
    except TranscriptsDisabled:
        return _youtube_description_or_failure(
            source,
            "captions_unavailable",
            "No public caption track or usable video description was available. Paste a transcript instead.",
        )
    except (VideoUnavailable, VideoUnplayable, AgeRestricted):
        return _failure(
            source,
            "video_unavailable",
            "This YouTube video is not publicly accessible to Chef World. "
            "Check that the link is public or unlisted, or paste a transcript.",
        )
    except NoTranscriptFound:
        return _youtube_description_or_failure(
            source,
            "no_transcript",
            "No usable public captions or video description were found. Paste a transcript instead.",
        )
    except (IpBlocked, RequestBlocked):
        return _youtube_description_or_failure(
            source,
            "fetch_failed",
            "YouTube is temporarily blocking caption requests from Chef World. "
            "The video may still have captions; try again later or paste the transcript.",
        )
    except (YouTubeRequestFailed, YouTubeDataUnparsable, FailedToCreateConsentCookie):
        return _youtube_description_or_failure(
            source,
            "fetch_failed",
            "We could not fetch captions from YouTube for this video right now. "
            "Please try again or paste a transcript.",
        )
    except PoTokenRequired:
        return _youtube_description_or_failure(
            source,
            "captions_unavailable",
            "YouTube did not provide a usable public caption track for this video. "
            "Paste a transcript instead.",
        )
    except Exception:
        logger.exception(
            "Unexpected YouTube text fetch failure provider=%s video_id=%s",
            source.provider,
            source.external_id,
        )
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
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if path == "/watch":
            candidate = query.get("v", [None])[0]
        else:
            match = re.fullmatch(r"/(?:shorts|live|embed)/([A-Za-z0-9_-]{11})/?", path)
            candidate = match.group(1) if match else None
    elif host == "youtu.be":
        match = re.fullmatch(r"/([A-Za-z0-9_-]{11})/?", path)
        candidate = match.group(1) if match else None
    elif host in {"youtube-nocookie.com", "www.youtube-nocookie.com"}:
        match = re.fullmatch(r"/embed/([A-Za-z0-9_-]{11})/?", path)
        candidate = match.group(1) if match else None
    else:
        candidate = None
    return candidate if candidate and re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate) else None
