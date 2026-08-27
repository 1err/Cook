from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

import app.api.routes_recipes as routes_recipes
from app.models import Recipe
from app.video_import import UnsupportedVideoUrl, VideoSource, VideoTextResult


RAW_URL = "https://www.tiktok.com/@chef/video/7412345678901234567?is_from_webapp=1"
CANONICAL_URL = "https://www.tiktok.com/@chef/video/7412345678901234567"
POST_ID = "7412345678901234567"


def _recipe(*, ingredients=None, steps=None) -> Recipe:
    return Recipe(
        id="draft",
        title="Extracted",
        ingredients=ingredients if ingredients is not None else [{"name": "Eggs", "quantity": "2"}],
        steps=steps if steps is not None else ["Whisk and fry."],
    )


@pytest.mark.asyncio
async def test_parse_link_uses_canonical_source_and_user_title(monkeypatch):
    source = VideoSource("tiktok", RAW_URL, CANONICAL_URL, POST_ID)
    monkeypatch.setattr(routes_recipes, "parse_video_source", lambda _: source)
    monkeypatch.setattr(
        routes_recipes,
        "fetch_video_text",
        AsyncMock(
            return_value=VideoTextResult(
                status="ok",
                text="2 eggs. Whisk and fry.",
                source=source,
                title="Creator caption",
                thumbnail_url="https://p16.example/cover.jpeg",
            )
        ),
    )
    monkeypatch.setattr(routes_recipes, "extract_recipe_from_text", AsyncMock(return_value=_recipe()))

    result = await routes_recipes.parse_from_link(
        routes_recipes.ParseLinkBody(url=RAW_URL, title="My omelet"), _user=object()
    )

    assert result.title == "My omelet"
    assert result.source_url == CANONICAL_URL
    assert result.thumbnail_url == "https://p16.example/cover.jpeg"


@pytest.mark.asyncio
async def test_parse_link_rejects_unsupported_url_with_bad_request(monkeypatch):
    monkeypatch.setattr(
        routes_recipes,
        "parse_video_source",
        lambda _: (_ for _ in ()).throw(UnsupportedVideoUrl("Paste a public YouTube or TikTok video link.")),
    )

    with pytest.raises(HTTPException) as exc_info:
        await routes_recipes.parse_from_link(routes_recipes.ParseLinkBody(url="not-a-url"), _user=object())

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_parse_link_rejects_tiktok_with_no_public_text(monkeypatch):
    source = VideoSource("tiktok", RAW_URL, CANONICAL_URL, POST_ID)
    monkeypatch.setattr(routes_recipes, "parse_video_source", lambda _: source)
    monkeypatch.setattr(
        routes_recipes,
        "fetch_video_text",
        AsyncMock(return_value=VideoTextResult("no_transcript", "", source, message="Paste its transcript instead.")),
    )

    with pytest.raises(HTTPException) as exc_info:
        await routes_recipes.parse_from_link(routes_recipes.ParseLinkBody(url=RAW_URL), _user=object())

    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_parse_link_rejects_temporary_provider_failure(monkeypatch):
    source = VideoSource("tiktok", RAW_URL, CANONICAL_URL, POST_ID)
    monkeypatch.setattr(routes_recipes, "parse_video_source", lambda _: source)
    monkeypatch.setattr(
        routes_recipes,
        "fetch_video_text",
        AsyncMock(return_value=VideoTextResult("fetch_failed", "", source, message="Try again.")),
    )

    with pytest.raises(HTTPException) as exc_info:
        await routes_recipes.parse_from_link(routes_recipes.ParseLinkBody(url=RAW_URL), _user=object())

    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_parse_link_rejects_structurally_empty_tiktok_draft(monkeypatch):
    source = VideoSource("tiktok", RAW_URL, CANONICAL_URL, POST_ID)
    monkeypatch.setattr(routes_recipes, "parse_video_source", lambda _: source)
    monkeypatch.setattr(
        routes_recipes,
        "fetch_video_text",
        AsyncMock(return_value=VideoTextResult("ok", "A very thin public caption", source)),
    )
    monkeypatch.setattr(
        routes_recipes,
        "extract_recipe_from_text",
        AsyncMock(
            return_value=_recipe(
                ingredients=[
                    {
                        "name": "Example ingredient",
                        "quantity": "to taste",
                        "notes": "Replace with real extraction",
                    }
                ],
                steps=[],
            )
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        await routes_recipes.parse_from_link(routes_recipes.ParseLinkBody(url=RAW_URL), _user=object())

    assert exc_info.value.status_code == 422
