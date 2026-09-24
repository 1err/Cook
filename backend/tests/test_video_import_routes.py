import json
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock
from urllib.error import HTTPError

import pytest
from fastapi import HTTPException

import app.api.routes_recipes as routes_recipes
import app.extract as extract_module
from app.models import Recipe
from app.video_import import UnsupportedVideoUrl, VideoSource, VideoTextResult, fetch_tiktok_text


RAW_URL = "https://www.tiktok.com/@chef/video/7412345678901234567?is_from_webapp=1"
CANONICAL_URL = "https://www.tiktok.com/@chef/video/7412345678901234567"
POST_ID = "7412345678901234567"


def _completion(payload: object):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content=json.dumps(payload, ensure_ascii=False)
                )
            )
        ]
    )


def _recipe(*, title="Extracted", ingredients=None, steps=None) -> Recipe:
    return Recipe(
        id="draft",
        title=title,
        ingredients=ingredients if ingredients is not None else [{"name": "Eggs", "quantity": "2"}],
        steps=steps if steps is not None else ["Whisk and fry."],
    )


def _mock_successful_tiktok_import(monkeypatch, *, source_title: str, recipe_title: str):
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
                title=source_title,
                thumbnail_url="https://p16.example/cover.jpeg",
            )
        ),
    )
    monkeypatch.setattr(
        routes_recipes,
        "extract_recipe_from_text",
        AsyncMock(return_value=_recipe(title=recipe_title)),
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


@pytest.mark.parametrize("recipe_title", ["", "  Imported Recipe  ", "UNTITLED RECIPE"])
@pytest.mark.asyncio
async def test_parse_link_uses_tiktok_source_title_for_generic_recipe_title(monkeypatch, recipe_title):
    _mock_successful_tiktok_import(
        monkeypatch,
        source_title="Creator's crispy chili noodles",
        recipe_title=recipe_title,
    )

    result = await routes_recipes.parse_from_link(
        routes_recipes.ParseLinkBody(url=RAW_URL), _user=object()
    )

    assert result.title == "Creator's crispy chili noodles"


@pytest.mark.asyncio
async def test_parse_link_preserves_meaningful_extracted_recipe_title(monkeypatch):
    _mock_successful_tiktok_import(
        monkeypatch,
        source_title="Creator's noodle caption",
        recipe_title="Crispy Chili Noodles",
    )

    result = await routes_recipes.parse_from_link(
        routes_recipes.ParseLinkBody(url=RAW_URL), _user=object()
    )

    assert result.title == "Crispy Chili Noodles"


@pytest.mark.asyncio
async def test_parse_link_explicit_user_title_wins_over_source_title(monkeypatch):
    _mock_successful_tiktok_import(
        monkeypatch,
        source_title="Creator's noodle caption",
        recipe_title="Imported Recipe",
    )

    result = await routes_recipes.parse_from_link(
        routes_recipes.ParseLinkBody(url=RAW_URL, title="  My chili noodles  "), _user=object()
    )

    assert result.title == "My chili noodles"


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
async def test_parse_link_maps_tiktok_redirect_rejection_to_service_unavailable(monkeypatch):
    source = VideoSource("tiktok", RAW_URL, CANONICAL_URL, POST_ID)
    monkeypatch.setattr(routes_recipes, "parse_video_source", lambda _: source)

    def redirecting_opener(request, *, timeout: int):
        raise HTTPError(request.full_url, 302, "Found", {"Location": "http://127.0.0.1/private"}, BytesIO())

    async def redirect_rejection(_source):
        return fetch_tiktok_text(_source, opener=redirecting_opener)

    monkeypatch.setattr(routes_recipes, "fetch_video_text", redirect_rejection)

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


@pytest.mark.asyncio
async def test_parse_link_preserves_ingredients_when_method_is_empty(monkeypatch):
    raw_url = "https://www.youtube.com/watch?v=A6bByqI_TH8&t=23s"
    canonical_url = "https://www.youtube.com/watch?v=A6bByqI_TH8"
    source = VideoSource("youtube", raw_url, canonical_url, "A6bByqI_TH8")
    monkeypatch.setattr(routes_recipes, "parse_video_source", lambda _: source)
    monkeypatch.setattr(
        routes_recipes,
        "fetch_video_text",
        AsyncMock(
            return_value=VideoTextResult(
                "ok",
                "Video title: 豆腐茄子煲\nVideo description: 老豆腐约400克，紫皮茄子1根。",
                source,
            )
        ),
    )
    monkeypatch.setattr(
        routes_recipes,
        "extract_recipe_from_text",
        AsyncMock(
            return_value=_recipe(
                title="豆腐茄子煲",
                ingredients=[{"name": "老豆腐", "quantity": "约400克"}],
                steps=[],
            )
        ),
    )

    result = await routes_recipes.parse_from_link(
        routes_recipes.ParseLinkBody(url=raw_url), _user=object())
    assert result.ingredients[0].name == "老豆腐"
    assert result.steps == []
    assert result.import_review.status == "needs_review"


@pytest.mark.asyncio
async def test_parse_link_preserves_ingredients_after_unusable_audit(monkeypatch):
    raw_url = "https://www.youtube.com/watch?v=A6bByqI_TH8&t=23s"
    canonical_url = "https://www.youtube.com/watch?v=A6bByqI_TH8"
    source = VideoSource("youtube", raw_url, canonical_url, "A6bByqI_TH8")
    monkeypatch.setattr(routes_recipes, "parse_video_source", lambda _: source)
    monkeypatch.setattr(
        routes_recipes,
        "fetch_video_text",
        AsyncMock(
            return_value=VideoTextResult(
                "ok",
                "Video title: 豆腐茄子煲\nVideo description: 老豆腐约400克，紫皮茄子1根。",
                source,
            )
        ),
    )
    create = AsyncMock(
        side_effect=[
            _completion(
                {
                    "title": "豆腐茄子煲",
                    "ingredients": [
                        {"name": "老豆腐", "quantity": "约400克", "notes": None}
                    ],
                    "steps": [{"content": "unsupported"}],
                }
            ),
            _completion({"method": "No instructions available."}),
        ]
    )
    client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    result = await routes_recipes.parse_from_link(
        routes_recipes.ParseLinkBody(url=raw_url), _user=object())
    assert result.steps == []
    assert result.ingredients[0].name == "老豆腐"
    assert result.import_review.status == "needs_review"
    assert create.await_count == 2


@pytest.mark.asyncio
async def test_parse_link_does_not_accept_ungrounded_reconstructed_method(monkeypatch):
    raw_url = "https://www.youtube.com/watch?v=A6bByqI_TH8&t=23s"
    canonical_url = "https://www.youtube.com/watch?v=A6bByqI_TH8"
    source = VideoSource("youtube", raw_url, canonical_url, "A6bByqI_TH8")
    monkeypatch.setattr(routes_recipes, "parse_video_source", lambda _: source)
    monkeypatch.setattr(
        routes_recipes,
        "fetch_video_text",
        AsyncMock(
            return_value=VideoTextResult(
                "ok",
                "Video title: 豆腐茄子煲\nVideo description: 老豆腐约400克，紫皮茄子1根。",
                source,
            )
        ),
    )
    create = AsyncMock(
        side_effect=[
            _completion(
                {
                    "title": "豆腐茄子煲",
                    "ingredients": [
                        {"name": "老豆腐", "quantity": "约400克", "notes": None},
                        {"name": "紫皮茄子", "quantity": "1根", "notes": None},
                    ],
                    "steps": [],
                }
            ),
            _completion(
                {
                    "steps": [
                        {
                            "text": "将豆腐切块，煎至两面金黄。",
                            "duration_seconds": 300,
                            "duration_source": "stated",
                            "attention_type": "hands_on",
                            "action_type": "sear",
                        }
                    ]
                }
            ),
        ]
    )
    client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    result = await routes_recipes.parse_from_link(
        routes_recipes.ParseLinkBody(url=raw_url), _user=object()
    )

    assert result.source_url == canonical_url
    assert result.steps == []
    assert len(result.ingredients) == 2
    assert result.import_review.status == "needs_review"
    assert create.await_count == 2


@pytest.mark.asyncio
async def test_parse_link_strips_placeholder_steps_but_keeps_ingredients(monkeypatch):
    source = VideoSource("youtube", RAW_URL, CANONICAL_URL, POST_ID)
    monkeypatch.setattr(routes_recipes, "parse_video_source", lambda _: source)
    monkeypatch.setattr(
        routes_recipes,
        "fetch_video_text",
        AsyncMock(return_value=VideoTextResult("ok", "2 eggs", source)),
    )
    monkeypatch.setattr(
        routes_recipes,
        "extract_recipe_from_text",
        AsyncMock(return_value=_recipe(steps=["No instructions available."])),
    )

    result = await routes_recipes.parse_from_link(
        routes_recipes.ParseLinkBody(url=RAW_URL), _user=object())
    assert result.steps == []
    assert result.ingredients[0].name == "Eggs"
    assert result.import_review.status == "needs_review"


@pytest.mark.asyncio
async def test_parse_transcript_keeps_procedure_and_always_attempts_audit(monkeypatch):
    create = AsyncMock(
        return_value=_completion(
            {
                "title": "Quick tofu",
                "ingredients": [
                    {"name": "Tofu", "quantity": "1 block", "notes": None}
                ],
                "steps": [
                    {
                        "text": "Dice the tofu.",
                        "duration_seconds": 120,
                        "duration_source": "estimated",
                        "attention_type": "hands_on",
                        "action_type": "chop",
                    },
                    {
                        "text": "Sear the tofu until golden.",
                        "duration_seconds": 360,
                        "duration_source": "estimated",
                        "attention_type": "hands_on",
                        "action_type": "sear",
                    },
                ],
            }
        )
    )
    client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    monkeypatch.setattr(extract_module, "get_openai_client", lambda: client)

    result = await routes_recipes.parse_from_transcript(
        routes_recipes.ParseTranscriptBody(
            transcript="Dice one block of tofu, then sear it until golden."
        ),
        _user=object(),
    )

    assert [step.text for step in result.steps] == [
        "Dice the tofu.",
        "Sear the tofu until golden.",
    ]
    assert create.await_count == 2
    assert result.import_review.status == "needs_review"
