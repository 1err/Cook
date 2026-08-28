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
from xml.etree.ElementTree import ParseError

try:
    from requests import Session
    from requests.exceptions import RequestException
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
    Session = None
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
_YOUTUBE_PLAYER_RESPONSE_MAX_BYTES = 3_000_000
_YOUTUBE_TITLE_MAX_CHARS = 500
_YOUTUBE_DESCRIPTION_MAX_CHARS = 100_000


if Session is not None:
    class _NoRedirectSession(Session):
        def request(self, method, url, **kwargs):
            kwargs["allow_redirects"] = False
            return super().request(method, url, **kwargs)
else:
    _NoRedirectSession = None


@dataclass(slots=True)
class _YouTubePlayerMetadata:
    title: str = ""
    description: str = ""


def _open_youtube_watch_page(request: Request, *, timeout: int):
    return _YOUTUBE_WATCH_OPENER.open(request, timeout=timeout)


def _youtube_metadata_from_player_payload(
    source: VideoSource,
    payload: object,
) -> tuple[str, str] | None:
    if not isinstance(payload, dict):
        return None
    playability = payload.get("playabilityStatus")
    if not isinstance(playability, dict) or playability.get("status") != "OK":
        return None
    details = payload.get("videoDetails")
    if not isinstance(details, dict) or details.get("videoId") != source.external_id:
        return None

    raw_title = details.get("title")
    raw_description = details.get("shortDescription")
    title = raw_title.strip() if isinstance(raw_title, str) else ""
    description = (
        raw_description.strip() if isinstance(raw_description, str) else ""
    )
    if (
        not description
        or len(title) > _YOUTUBE_TITLE_MAX_CHARS
        or len(description) > _YOUTUBE_DESCRIPTION_MAX_CHARS
    ):
        return None
    return title, description


def _youtube_description_result(
    source: VideoSource,
    title: str,
    description: str,
    *,
    origin: str,
) -> VideoTextResult:
    text = f"Video title: {title}\n\nVideo description:\n{description}" if title else description
    logger.info(
        "Video text fetch result provider=%s video_id=%s status=ok source=%s text_length=%d",
        source.provider,
        source.external_id,
        origin,
        len(text),
    )
    return VideoTextResult(
        status="ok",
        text=text,
        source=source,
        title=title or None,
        thumbnail_url=f"https://img.youtube.com/vi/{source.external_id}/hqdefault.jpg",
    )


def _capture_youtube_player_metadata(source: VideoSource, metadata: _YouTubePlayerMetadata):
    def capture(response, *_args, **_kwargs):
        try:
            request = response.request
            parsed = urlsplit(response.url)
            content_type = response.headers.get("content-type", "")
            content_length = response.headers.get("content-length")
            if (
                str(getattr(request, "method", "")).upper() != "POST"
                or parsed.scheme != "https"
                or parsed.hostname != "www.youtube.com"
                or parsed.username
                or parsed.password
                or parsed.port not in (None, 443)
                or parsed.path != "/youtubei/v1/player"
                or response.status_code != 200
                or bool(getattr(response, "history", ()))
                or content_type.split(";", 1)[0].strip().lower() != "application/json"
            ):
                return response
            if content_length is not None:
                if int(content_length) > _YOUTUBE_PLAYER_RESPONSE_MAX_BYTES:
                    return response
            content = getattr(response, "content", None)
            if (
                isinstance(content, (bytes, bytearray))
                and len(content) > _YOUTUBE_PLAYER_RESPONSE_MAX_BYTES
            ):
                return response
            captured = _youtube_metadata_from_player_payload(source, response.json())
            if captured is not None:
                metadata.title, metadata.description = captured
        except Exception:
            # A response hook must never interfere with transcript retrieval.
            return response
        return response

    return capture


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
    metadata = _youtube_metadata_from_player_payload(source, payload)
    if metadata is None:
        return None
    return _youtube_description_result(
        source,
        *metadata,
        origin="watch_description",
    )


def _youtube_description_or_failure(
    source: VideoSource,
    status: str,
    message: str,
    metadata: _YouTubePlayerMetadata | None = None,
) -> VideoTextResult:
    if metadata is not None and metadata.description:
        return _youtube_description_result(
            source,
            metadata.title,
            metadata.description,
            origin="player_description",
        )
    return _youtube_public_description(source) or _failure(source, status, message)


def _youtube_blocked_result(
    source: VideoSource,
    metadata: _YouTubePlayerMetadata,
    *,
    stage: str,
) -> VideoTextResult:
    logger.warning(
        "YouTube request blocked provider=%s video_id=%s stage=%s metadata_captured=%s",
        source.provider,
        source.external_id,
        stage,
        bool(metadata.description),
    )
    return _youtube_description_or_failure(
        source,
        "fetch_failed",
        "YouTube is temporarily blocking caption requests from Chef World. "
        "The video may still have captions; try again later or paste the transcript.",
        metadata,
    )


def fetch_youtube_text(source: VideoSource) -> VideoTextResult:
    """Fetch public YouTube captions, with public description text as a fallback."""
    metadata = _YouTubePlayerMetadata()
    request_stage = "dependency"
    http_client = None
    if YouTubeTranscriptApi is None or _NoRedirectSession is None:
        return _youtube_description_or_failure(
            source,
            "dependency_missing",
            "YouTube transcript support is not available on the server right now.",
            metadata,
        )
    try:
        http_client = _NoRedirectSession()
        http_client.hooks.setdefault("response", []).append(
            _capture_youtube_player_metadata(source, metadata)
        )
        request_stage = "list"
        tracks = YouTubeTranscriptApi(http_client=http_client).list(source.external_id or "")
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
        caption_ip_blocked = False
        po_token_required = False
        request_stage = "caption"
        for track in candidate_tracks:
            try:
                snippets = track.fetch()
            except PoTokenRequired:
                po_token_required = True
                continue
            except (YouTubeRequestFailed, RequestException, ParseError):
                caption_request_failed = True
                continue
            except (IpBlocked, RequestBlocked):
                caption_ip_blocked = True
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
        if caption_ip_blocked:
            return _youtube_blocked_result(
                source,
                metadata,
                stage=request_stage,
            )
        if caption_request_failed:
            return _youtube_description_or_failure(
                source,
                "fetch_failed",
                "We could not fetch captions from YouTube for this video right now. "
                "Please try again or paste a transcript.",
                metadata,
            )
        if po_token_required:
            return _youtube_description_or_failure(
                source,
                "captions_unavailable",
                "YouTube did not provide a usable public caption track for this video. "
                "Paste a transcript instead.",
                metadata,
            )
        return _youtube_description_or_failure(
            source,
            "no_transcript",
            "No usable public captions or video description were found. Paste a transcript instead.",
            metadata,
        )
    except TranscriptsDisabled:
        return _youtube_description_or_failure(
            source,
            "captions_unavailable",
            "No public caption track or usable video description was available. Paste a transcript instead.",
            metadata,
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
            metadata,
        )
    except (IpBlocked, RequestBlocked):
        return _youtube_blocked_result(
            source,
            metadata,
            stage=request_stage,
        )
    except (YouTubeRequestFailed, YouTubeDataUnparsable, FailedToCreateConsentCookie):
        logger.warning(
            "YouTube retrieval failed provider=%s video_id=%s stage=%s metadata_captured=%s",
            source.provider,
            source.external_id,
            request_stage,
            bool(metadata.description),
        )
        return _youtube_description_or_failure(
            source,
            "fetch_failed",
            "We could not fetch captions from YouTube for this video right now. "
            "Please try again or paste a transcript.",
            metadata,
        )
    except (RequestException, ParseError) as exc:
        logger.warning(
            "YouTube retrieval failed provider=%s video_id=%s stage=%s error_type=%s metadata_captured=%s",
            source.provider,
            source.external_id,
            request_stage,
            type(exc).__name__,
            bool(metadata.description),
        )
        return _youtube_description_or_failure(
            source,
            "fetch_failed",
            "We could not fetch captions from YouTube for this video right now. "
            "Please try again or paste a transcript.",
            metadata,
        )
    except PoTokenRequired:
        return _youtube_description_or_failure(
            source,
            "captions_unavailable",
            "YouTube did not provide a usable public caption track for this video. "
            "Paste a transcript instead.",
            metadata,
        )
    except Exception as exc:
        logger.error(
            "Unexpected YouTube text fetch failure provider=%s video_id=%s error_type=%s",
            source.provider,
            source.external_id,
            type(exc).__name__,
        )
        return _failure(
            source,
            "fetch_failed",
            "We could not fetch captions from YouTube for this video right now. Please try again or paste a transcript.",
        )
    finally:
        if http_client is not None:
            http_client.close()


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
