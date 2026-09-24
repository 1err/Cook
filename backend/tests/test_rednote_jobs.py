"""RedNote links use the current job, privacy, and audiovisual contracts."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from app.api import routes_imports, routes_recipes as routes
from app.api.auth import get_current_user
from app.db.session import get_session
from app.jobs import recipe_imports as worker
from app.models import Recipe
from app.video_import import VideoTextResult, parse_video_source

URL = "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9"
TOKEN_URL = URL + "?xsec_token=secret%3D&xsec_source=pc_share"
MEDIA = b"\x00\x00\x00\x18ftypisom" + b"public video bytes"
MEDIA_URL = "https://sns-video-bd.xhscdn.com/example.mp4"


def draft():
    return Recipe(id="draft", title="蒸蛋", ingredients=[{"name": "鸡蛋", "quantity": "2个"}],
                  steps=[{"text": "搅拌后蒸10分钟。", "instruction_source": "source", "source_excerpt": "蒸10分钟"}])


def test_queued_link_retains_token_but_text_attribution_removes_it():
    link = routes_imports.ImportJobBody(url="蒸蛋教程 " + TOKEN_URL)
    assert link.url == TOKEN_URL
    text = routes_imports.ImportJobBody(mode="text", transcript="蒸蛋", source_url=TOKEN_URL)
    assert text.url == text.source_url == URL


@pytest.mark.asyncio
async def test_worker_passes_original_link_to_retrieval(monkeypatch):
    parse = AsyncMock(return_value=draft())
    monkeypatch.setattr(worker, "parse_from_link", parse)
    body = routes_imports.ImportJobBody(url=TOKEN_URL)
    await worker.perform_import(SimpleNamespace(payload=body.model_dump()), object())
    assert parse.await_args.args[0].url == TOKEN_URL


@pytest.mark.asyncio
async def test_link_media_uses_gemini_bytes_and_resolved_safe_attribution(monkeypatch):
    source = parse_video_source(TOKEN_URL)
    monkeypatch.setattr(routes, "video_analysis_available", lambda: True)
    monkeypatch.setattr(routes, "fetch_video_text", AsyncMock(return_value=VideoTextResult(
        "ok", "鸡蛋2个，蒸10分钟。", source, source_kind="description", media_url=MEDIA_URL)))
    download = AsyncMock(return_value=(MEDIA, "video/mp4"))
    extract = AsyncMock(return_value=draft())
    monkeypatch.setattr(routes, "download_rednote_video", download)
    monkeypatch.setattr(routes, "extract_recipe_from_video", extract)
    result = await routes.parse_from_link(routes.ParseLinkBody(url="http://xhslink.com/a/Test", notes="保留中文"))
    download.assert_awaited_once_with(MEDIA_URL)
    assert extract.await_args.kwargs["media_data"] == MEDIA
    assert extract.await_args.kwargs["media_type"] == "video/mp4"
    assert "source_url" not in extract.await_args.kwargs
    assert "鸡蛋2个" in extract.await_args.kwargs["notes"]
    assert result.source_url == URL and result.steps[0].text == "搅拌后蒸10分钟。"
    assert result.steps[0].source_excerpt == "蒸10分钟"
    assert result.import_review.source_kind == "media"


@pytest.mark.asyncio
async def test_public_note_text_uses_existing_quality_extractor(monkeypatch):
    source = parse_video_source(TOKEN_URL)
    monkeypatch.setattr(routes, "fetch_video_text", AsyncMock(return_value=VideoTextResult(
        "ok", "鸡蛋2个，蒸10分钟。", source, source_kind="description")))
    extract = AsyncMock(return_value=draft())
    monkeypatch.setattr(routes, "extract_recipe_from_text", extract)
    result = await routes.parse_from_link(routes.ParseLinkBody(url=TOKEN_URL))
    assert extract.await_args.kwargs == {"source_kind": "description"}
    assert result.source_url == URL


@pytest.mark.asyncio
async def test_access_required_never_reaches_ai(monkeypatch):
    source = parse_video_source(TOKEN_URL)
    monkeypatch.setattr(routes, "fetch_video_text", AsyncMock(return_value=VideoTextResult(
        "access_required", "", source, message="RedNote requires sign-in. Upload the saved video.")))
    extract = AsyncMock()
    monkeypatch.setattr(routes, "extract_recipe_from_text", extract)
    with pytest.raises(HTTPException) as caught:
        await routes.parse_from_link(routes.ParseLinkBody(url=TOKEN_URL))
    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == "source_access_required"
    extract.assert_not_awaited()


@pytest.mark.asyncio
async def test_media_job_sanitizes_attribution_before_storage(monkeypatch):
    app = FastAPI()
    app.include_router(routes_imports.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="test")
    app.dependency_overrides[get_session] = lambda: object()
    monkeypatch.setattr(routes_imports, "video_analysis_available", lambda: True)
    admit = AsyncMock(return_value={"id": "job", "status": "queued"})
    monkeypatch.setattr(routes_imports, "_admit_queue", admit)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/recipes/import-jobs/media", files={"file": ("recipe.mp4", MEDIA, "video/mp4")},
                                     data={"source_url": TOKEN_URL})
    assert response.status_code == 202
    assert admit.await_args.args[2]["url"] == URL
    assert "secret" not in str(admit.await_args.args[2])
    assert admit.await_args.kwargs["media_data"] == MEDIA
