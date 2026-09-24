"""Authenticated persistent import jobs; drafts still require explicit recipe save."""
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._types import LibraryTags
from app.api.auth import get_current_user
from app.api.abuse import enforce_limits, private_scope
from app.core.config import settings
from app.db.models import UserModel
from app.db import repo_import_jobs as jobs
from app.db.repo_request_limits import RequestLimit
from app.db.session import get_session
from app.models import Recipe
from app.services.video_analysis import MAX_MEDIA_BYTES, validate_media_input, video_analysis_available
from app.video_import import parse_video_source, UnsupportedVideoUrl

router = APIRouter(prefix='/recipes', tags=['imports'])


class ImportJobBody(BaseModel):
    mode: Literal['link', 'text', 'video'] = 'link'
    url: str = Field('', max_length=4096)
    source_url: str | None = Field(None, max_length=4096)
    transcript: str = Field('', max_length=40000)
    notes: str = Field('', max_length=4000)
    title: str = Field('', max_length=512)
    library_tags: LibraryTags = Field(default_factory=list)

    @model_validator(mode='after')
    def validate_source(self):
        link = self.url or self.source_url
        if self.mode != 'text' and not link:
            raise ValueError('Paste a video link before importing.')
        if self.mode == 'text' and not self.transcript.strip():
            raise ValueError('Paste recipe text before importing.')
        if link:
            try:
                source = parse_video_source(link)
            except UnsupportedVideoUrl as exc:
                raise ValueError(str(exc)) from None
            self.url = source.canonical_url
            if self.mode == 'video' and source.provider != 'youtube':
                raise ValueError('Video-link analysis supports public YouTube videos. Upload a file for other sources.')
        return self


class ImportJobResponse(BaseModel):
    id: str
    status: Literal['queued', 'processing', 'completed', 'failed', 'cancelled']
    recipe: Recipe | None = None
    error: dict[str, str] | None = None


@router.get('/import-capabilities')
async def import_capabilities(_user: UserModel = Depends(get_current_user)):
    enabled = video_analysis_available()
    return {'video_analysis': enabled, 'media_upload': enabled, 'max_media_bytes': MAX_MEDIA_BYTES}


async def _admit_queue(session, user, payload, *, media_data=None, media_type=None):
    if settings.ABUSE_LIMITS_ENABLED:
        # Close the auth read before separate, committed rate-limit admission.
        await session.close()
        limits = [RequestLimit('import-queue-global', 60, settings.AI_GLOBAL_REQUESTS_PER_MINUTE),
                  RequestLimit(private_scope('import-queue-account', str(user.id)), 60,
                               settings.AI_USER_REQUESTS_PER_MINUTE)]
        if media_data is not None:
            limits.append(RequestLimit(private_scope('import-media-bytes', str(user.id)), 86400,
                                       settings.UPLOAD_ACCOUNT_BYTES_PER_DAY, len(media_data)))
        await enforce_limits(limits)
    try:
        job = await jobs.create_job(session, user, payload, media_data=media_data, media_type=media_type)
        await session.commit()
    except jobs.ImportQueueFull as exc:
        await session.rollback()
        raise HTTPException(409, {'code':'import_already_running', 'message':str(exc)}) from None
    return jobs.job_response(job)


@router.post('/import-jobs', response_model=ImportJobResponse, status_code=202)
async def create_import_job(body: ImportJobBody, user: UserModel = Depends(get_current_user),
                            session: AsyncSession = Depends(get_session)):
    if body.mode == 'video' and not video_analysis_available():
        raise HTTPException(503, {'code':'video_analysis_unavailable',
            'message':'Video analysis is not available. Paste recipe text to continue.'})
    return await _admit_queue(session, user, body.model_dump())


@router.post('/import-jobs/media', response_model=ImportJobResponse, status_code=202)
async def create_media_import_job(file: UploadFile = File(...), notes: str = Form('', max_length=4000),
        title: str = Form('', max_length=512), source_url: str = Form('', max_length=4096),
        library_tags: str = Form('[]', max_length=2000), user: UserModel = Depends(get_current_user),
        session: AsyncSession = Depends(get_session)):
    if not video_analysis_available():
        raise HTTPException(503, {'code':'video_analysis_unavailable',
            'message':'Media analysis is not available. Paste recipe text to continue.'})
    try:
        tags = json.loads(library_tags)
        if not isinstance(tags, list):
            raise ValueError()
        payload = ImportJobBody(mode='text', transcript='Uploaded media', url=source_url,
                                notes=notes, title=title, library_tags=tags).model_dump()
    except (ValueError, TypeError):
        raise HTTPException(422, 'Check the original video link and recipe categories.') from None
    data = await file.read(MAX_MEDIA_BYTES + 1)
    await file.close()
    try:
        media_type = validate_media_input(data, file.content_type)
    except ValueError:
        raise HTTPException(422, f'Upload a supported video or audio file, at most {MAX_MEDIA_BYTES // 1024 // 1024} MB.') from None
    payload['mode'] = 'media'
    payload.pop('transcript', None)
    return await _admit_queue(session, user, payload, media_data=data, media_type=media_type)


@router.get('/import-jobs/{job_id}', response_model=ImportJobResponse)
async def read_import_job(job_id: UUID, user: UserModel = Depends(get_current_user),
                          session: AsyncSession = Depends(get_session)):
    job = await jobs.get_job(session, job_id, user.id, include_payload=False)
    if job is None:
        raise HTTPException(404, 'Import not found or expired.')
    return jobs.job_response(job)


@router.delete('/import-jobs/{job_id}', response_model=ImportJobResponse)
async def cancel_import_job(job_id: UUID, user: UserModel = Depends(get_current_user),
                            session: AsyncSession = Depends(get_session)):
    job = await jobs.cancel_job(session, job_id, user.id)
    if job is None:
        raise HTTPException(404, 'Import not found or expired.')
    await session.commit()
    return jobs.job_response(job)
