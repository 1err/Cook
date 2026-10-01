"""Best-effort public RedNote notes. No cookies, signed APIs, or login bypass."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from http.client import HTTPException
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urljoin, urlsplit, urlunsplit
from urllib.request import Request

import httpx
from curl_cffi import CurlOpt, requests as browser_requests
from fastapi import HTTPException as APIException

from app.services.video_analysis import MAX_MEDIA_BYTES, validate_media_input
from app.services.public_video import compress_public_video

from app.video_import import VideoSource, VideoTextResult

NOTE_HOSTS = {"www.xiaohongshu.com", "xiaohongshu.com", "m.xiaohongshu.com"}
SHORT_HOSTS = {"xhslink.com", "www.xhslink.com", "xhslink.cn", "www.xhslink.cn"}
MEDIA_HOSTS = {"sns-video-bd.xhscdn.com", "sns-video-qc.xhscdn.com", "sns-video-hw.xhscdn.com", "sns-video-al.xhscdn.com"}
MEDIA_HOSTS |= {f'sns-{kind}-v{number}.xhscdn.com' for kind in ('video', 'bak') for number in range(1, 100)}
MAX_PUBLIC_VIDEO_BYTES = 150 * 1024 * 1024
FALLBACK = "This RedNote (小红书) post is unavailable or does not expose enough recipe content. Upload the saved video or paste its recipe text."
logger = logging.getLogger(__name__)
_URL_RE = re.compile(r"https?://[^\s<>\"'，。！？；、（）【】]+")
_JSON_TOKENS = re.compile(r'"(?:\\.|[^"\\])*"|\bundefined\b')


def _open_public_page(request, *, timeout):
    # Anonymous browser-compatible TLS; never load a user's cookies or account.
    chunks = []
    size = 0
    def receive(chunk):
        nonlocal size
        size += len(chunk)
        if size > 3_000_000:
            return 0
        chunks.append(chunk)
        return len(chunk)
    with browser_requests.Session(impersonate='chrome', trust_env=False,
            curl_options={CurlOpt.MAXFILESIZE_LARGE: 3_000_000}) as client:
        response = client.get(request.full_url, timeout=timeout, allow_redirects=False,
            headers={'Accept-Language':'zh-CN,zh;q=0.9,en;q=0.5'}, content_callback=receive)
        if response.status_code >= 300:
            raise HTTPError(request.full_url, response.status_code, 'Public source unavailable', response.headers, None)
    return BytesIO(b''.join(chunks))


def _trusted_url(value: str, hosts: set[str]) -> str | None:
    try:
        p = urlsplit(value)
        if p.scheme not in {"https", "http"} or p.hostname not in hosts or p.username or p.password or p.port not in (None, 443):
            return None
        if any(ord(c) < 33 for c in value) or "\\" in value:
            return None
        return urlunsplit(("https", p.hostname, p.path, p.query, ""))
    except ValueError:
        return None


def parse_rednote_source(value: str) -> VideoSource | None:
    """Extract the URL from native share text, upgrading known HTTP share URLs."""
    for candidate in _URL_RE.findall((value or "").strip()):
        url = _trusted_url(candidate.rstrip(".,;!?)］]}"), NOTE_HOSTS | SHORT_HOSTS)
        if not url:
            continue
        parsed = urlsplit(url)
        if parsed.hostname in SHORT_HOSTS:
            if re.fullmatch(r"/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)?/?", parsed.path):
                return VideoSource("xiaohongshu", url, urlunsplit(("https", parsed.hostname, parsed.path, "", "")), None)
        else:
            match = re.fullmatch(r"/(?:explore|discovery/item)/([a-fA-F0-9]{24})/?", parsed.path)
            if match:
                note_id = match.group(1).lower()
                return VideoSource("xiaohongshu", url, f"https://www.xiaohongshu.com/explore/{note_id}", note_id)
    return None


def safe_rednote_media_url(value: object) -> str | None:
    return _trusted_url(value, MEDIA_HOSTS) if isinstance(value, str) else None


def _public_media(note: dict) -> str | None:
    video = note.get("video")
    if not isinstance(video, dict):
        return None
    media = video.get("media")
    streams = media.get("stream") if isinstance(media, dict) else None
    if isinstance(streams, dict):
        for formats in streams.values():
            if not isinstance(formats, list):
                continue
            for entry in formats:
                if not isinstance(entry, dict):
                    continue
                backups = entry.get("backupUrls")
                for candidate in [entry.get("masterUrl"), *(backups if isinstance(backups, list) else [])]:
                    url = safe_rednote_media_url(candidate)
                    if url:
                        return url
    return None


def _parse_note(page: bytes, source: VideoSource) -> VideoTextResult:
    failed = VideoTextResult("no_transcript", "", source, message=FALLBACK)
    try:
        text = page.decode("utf-8")
        match = re.search(r"window\.__INITIAL_STATE__\s*=\s*", text)
        if not match or not source.external_id:
            return failed
        # Handle JavaScript undefined without eval, preserving literal text strings.
        state_text = _JSON_TOKENS.sub(lambda m: "null" if m.group() == "undefined" else m.group(), text[match.end():])
        state, _ = json.JSONDecoder().raw_decode(state_text)
        note = state["note"]["noteDetailMap"][source.external_id]["note"]
        if not isinstance(note, dict) or note.get("noteId", source.external_id) != source.external_id:
            return failed
        title = note.get("title") if isinstance(note.get("title"), str) else ""
        description = note.get("desc") if isinstance(note.get("desc"), str) else ""
        media_url = _public_media(note)
        if not description.strip() and not media_url:
            return failed
        evidence = f"RedNote post title: {title[:512]}\n\nPublic post description:\n{description[:32000]}"
        return VideoTextResult("ok", evidence, source, title=title[:512] or None,
                               source_kind="description", media_url=media_url)
    except (ValueError, KeyError, TypeError, RecursionError):
        return failed


def fetch_rednote_text(source: VideoSource, *, opener=None) -> VideoTextResult:
    opener = opener or _open_public_page
    current = source
    recovered_login = False
    deadline = time.monotonic() + 25
    for _ in range(5):
        request = Request(current.original_url, headers={"User-Agent": "ChefWorld/1.0", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5"})
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            with opener(request, timeout=min(8, remaining)) as response:
                # HTTPResponse.read1 performs at most one underlying read so a
                # trickling peer cannot extend one read indefinitely.
                read = getattr(response, "read1", response.read)
                chunks = []
                size = 0
                while size <= 3_000_000:
                    chunk = read(min(64 * 1024, 3_000_001 - size))
                    if time.monotonic() >= deadline:
                        raise TimeoutError()
                    if not chunk:
                        break
                    chunks.append(chunk)
                    size += len(chunk)
                page = b"".join(chunks)
            if len(page) > 3_000_000:
                break
            return _parse_note(page, current)
        except HTTPError as exc:
            if exc.code in {301, 302, 303, 307, 308}:
                target = urljoin(current.original_url, exc.headers.get("Location", ""))
                trusted_target = _trusted_url(target, NOTE_HOSTS)
                if trusted_target and urlsplit(trusted_target).path.rstrip("/") == "/login":
                    # Some public share links are wrapped in a login URL. Retry
                    # only its exact trusted, token-bearing note, once. A real
                    # sign-in requirement remains an actionable fallback.
                    nested = parse_qs(urlsplit(trusted_target).query).get('redirectPath', [])
                    candidate = _trusted_url(nested[0], NOTE_HOSTS) if len(nested) == 1 else None
                    resolved = parse_rednote_source(candidate) if candidate else None
                    if (not recovered_login and resolved and resolved.external_id
                            and parse_qs(urlsplit(candidate).query).get('xsec_token')
                            and (not current.external_id or current.external_id == resolved.external_id)):
                        current = resolved
                        recovered_login = True
                        continue
                    return VideoTextResult(
                        "access_required", "", current,
                        message="RedNote (小红书) requires sign-in before Chef World can read this post. "
                        "Upload the saved video or paste its recipe text instead.",
                    )
                resolved = parse_rednote_source(target)
                # A redirect must itself be a trusted URL, not share text containing one.
                if resolved is None or _trusted_url(target, NOTE_HOSTS | SHORT_HOSTS) != resolved.original_url:
                    break
                if source.external_id and resolved.external_id != source.external_id:
                    break
                current = resolved
                continue
            if exc.code in {429, 500, 502, 503, 504}:
                return VideoTextResult("fetch_failed", "", current, message="RedNote is temporarily unavailable. Try again, upload the saved video, or paste recipe text.")
            break
        except (HTTPException, URLError, TimeoutError, OSError, browser_requests.RequestsError):
            return VideoTextResult("fetch_failed", "", current, message="RedNote could not be reached. Try again, upload the saved video, or paste recipe text.")
    return VideoTextResult("no_transcript", "", current, message=FALLBACK)


async def download_rednote_video(url: str, *, transport=None) -> tuple[bytes, str]:
    """Retrieve bounded public video bytes for the existing audiovisual pipeline."""
    def fail(code="source_unavailable", message="The RedNote video could not be retrieved. Upload the saved video instead.", status=422):
        return APIException(status, {"code": code, "message": message})

    current = safe_rednote_media_url(url)
    if not current:
        raise fail()
    started, phase, size = time.monotonic(), 'download', 0
    try:
        async with asyncio.timeout(310), httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False, transport=transport) as client:
            for _ in range(4):
                async with client.stream("GET", current, headers={"User-Agent": "ChefWorld/1.0", "Accept-Encoding": "identity"}) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        current = safe_rednote_media_url(urljoin(current, response.headers.get("location", "")))
                        if not current:
                            break
                        continue
                    response.raise_for_status()
                    if response.headers.get("content-encoding", "identity").lower() != "identity":
                        break
                    length = int(response.headers.get("content-length", "0"))
                    if length < 0:
                        break
                    if length > MAX_PUBLIC_VIDEO_BYTES:
                        raise fail('media_too_large', 'This public video exceeds 150 MB. Upload a shorter clip or paste recipe text.', 413)
                    with TemporaryDirectory(prefix='chef-public-video-') as directory:
                        path = Path(directory) / 'source.video'
                        size = 0
                        with path.open('wb') as file:
                            async for chunk in response.aiter_bytes(64 * 1024):
                                size += len(chunk)
                                if size > MAX_PUBLIC_VIDEO_BYTES:
                                    raise fail('media_too_large', 'This public video exceeds 150 MB. Upload a shorter clip or paste recipe text.', 413)
                                file.write(chunk)
                        with path.open('rb') as file:
                            prefix = file.read(32)
                        phase = 'validate'
                        mime = response.headers.get('content-type', '').split(';', 1)[0].strip().lower()
                        if mime in {'', 'application/octet-stream'}:
                            mime = 'video/webm' if prefix.startswith(b'\x1a\x45\xdf\xa3') else 'video/mp4'
                        if mime not in {'video/mp4', 'video/webm', 'video/quicktime', 'video/mov'}:
                            break
                        mime = validate_media_input(prefix, mime)
                        logger.info('rednote_public_video_downloaded bytes=%d elapsed_seconds=%.1f',
                                    size, time.monotonic() - started)
                        phase = 'prepare'
                        content = (await compress_public_video(path, mime) if size > MAX_MEDIA_BYTES
                                   else path.read_bytes())
                        logger.info('rednote_public_video_prepared input_bytes=%d output_bytes=%d elapsed_seconds=%.1f',
                                    size, len(content), time.monotonic() - started)
                        return content, validate_media_input(content, 'video/mp4' if size > MAX_MEDIA_BYTES else mime)
    except APIException:
        raise
    except (httpx.HTTPError, TimeoutError, ValueError, OSError) as error:
        # Never log exception strings: HTTP errors can contain signed media URLs.
        logger.warning('rednote_public_video_failed phase=%s error_type=%s bytes=%d elapsed_seconds=%.1f',
                       phase, type(error).__name__, size, time.monotonic() - started)
    raise fail()
