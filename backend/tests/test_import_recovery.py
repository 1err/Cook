from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.api import routes_recipes as routes
from app.models import Recipe
from app.video_import import VideoTextResult, parse_video_source

SOURCE = parse_video_source('https://youtu.be/A6bByqI_TH8')


@pytest.mark.asyncio
async def test_ingredient_only_result_is_kept_for_review(monkeypatch):
    monkeypatch.setattr(routes, 'fetch_video_text', AsyncMock(return_value=VideoTextResult(
        'ok', 'Tofu, eggplant', SOURCE)))
    monkeypatch.setattr(routes, 'extract_recipe_from_text', AsyncMock(return_value=Recipe(
        id='draft', title='Claypot', ingredients=[{'name':'Tofu','quantity':'400g'}])))
    result = await routes.parse_from_link(routes.ParseLinkBody(url=SOURCE.canonical_url))
    assert result.ingredients[0].name == 'Tofu'
    assert result.source_url == SOURCE.canonical_url
    assert result.import_review.status == 'needs_review'


@pytest.mark.asyncio
async def test_text_fallback_keeps_original_video_url(monkeypatch):
    monkeypatch.setattr(routes, 'extract_recipe_from_text', AsyncMock(return_value=Recipe(
        id='draft',title='Tofu',ingredients=[],steps=['Slice tofu.'])))
    result = await routes.parse_from_transcript(routes.ParseTranscriptBody(
        transcript='Slice tofu.', source_url='https://youtu.be/A6bByqI_TH8'))
    assert result.source_url == SOURCE.canonical_url


@pytest.mark.asyncio
async def test_missing_source_error_has_recovery_code(monkeypatch):
    monkeypatch.setattr(routes, 'fetch_video_text', AsyncMock(return_value=VideoTextResult(
        'no_transcript', '', SOURCE, message='No public captions')))
    monkeypatch.setattr(routes, 'video_analysis_available', lambda: False, raising=False)
    with pytest.raises(HTTPException) as exc:
        await routes.parse_from_link(routes.ParseLinkBody(url=SOURCE.canonical_url))
    assert exc.value.detail['code'] == 'source_unavailable'


@pytest.mark.asyncio
async def test_caption_failure_uses_configured_video_provider(monkeypatch):
    monkeypatch.setattr(routes, 'fetch_video_text', AsyncMock(return_value=VideoTextResult(
        'no_transcript', '', SOURCE)))
    monkeypatch.setattr(routes, 'video_analysis_available', lambda: True, raising=False)
    analyze = AsyncMock(return_value=Recipe(id='draft',title='Tofu',ingredients=[],steps=['Slice tofu.']))
    monkeypatch.setattr(routes, 'extract_recipe_from_video', analyze, raising=False)
    result = await routes.parse_from_link(routes.ParseLinkBody(url=SOURCE.canonical_url))
    assert result.source_url == SOURCE.canonical_url
    assert analyze.await_args.kwargs['source_url'] == SOURCE.canonical_url


@pytest.mark.asyncio
async def test_video_fallback_preserves_available_description_quantities(monkeypatch):
    monkeypatch.setattr(routes, 'fetch_video_text', AsyncMock(return_value=VideoTextResult(
        'ok', 'Tofu 400 g. Oyster sauce 8 g.', SOURCE, source_kind='description')))
    monkeypatch.setattr(routes, 'video_analysis_available', lambda: True)
    analyze = AsyncMock(return_value=Recipe(id='draft', title='Tofu', ingredients=[], steps=['Slice tofu.']))
    monkeypatch.setattr(routes, 'extract_recipe_from_video', analyze)
    await routes.parse_from_link(routes.ParseLinkBody(url=SOURCE.canonical_url, notes='Keep Chinese names.'))
    notes = analyze.await_args.kwargs['notes']
    assert 'Tofu 400 g. Oyster sauce 8 g.' in notes
    assert 'Video description' in notes
    assert 'User guidance:\nKeep Chinese names.' in notes


@pytest.mark.asyncio
async def test_invalid_fallback_source_is_rejected_before_paid_work(monkeypatch):
    extract = AsyncMock()
    monkeypatch.setattr(routes, 'extract_recipe_from_text', extract)
    with pytest.raises(HTTPException):
        await routes.parse_from_transcript(routes.ParseTranscriptBody(
            transcript='Slice tofu.', source_url='http://127.0.0.1/private'))
    extract.assert_not_called()
