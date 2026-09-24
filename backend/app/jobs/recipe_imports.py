"""Durable import worker. Retry only concurrency contention before AI admission."""
import asyncio
from contextlib import asynccontextmanager
import logging

from fastapi import HTTPException
from sqlalchemy import select

from app.api.ai_budget import AIConcurrencyUnavailable, enforce_ai_budget
from app.api.routes_recipes import (ParseLinkBody, ParseTranscriptBody, parse_from_link,
    parse_from_transcript, _apply_import_overrides)
from app.core.config import settings
from app.core.llm import AIInputTooLargeError, AIUnavailableError
from app.db import session as database, repo_import_jobs as jobs
from app.db.import_job_models import ImportJobModel as Job
from app.db.models import UserModel
from app.extract import extract_recipe_from_video

logger = logging.getLogger(__name__)


class ImportAdmissionDeferred(Exception):
    def __init__(self, retry_after):
        self.retry_after = retry_after


async def perform_import(job, user):
    payload = job.payload
    common = {key: payload.get(key, default) for key, default in
              [('notes',''), ('title',''), ('library_tags',[])]}
    if payload['mode'] == 'text':
        return await parse_from_transcript(ParseTranscriptBody(transcript=payload['transcript'],
            source_url=payload.get('url') or None, **common), _user=user)
    if payload['mode'] in {'link', 'video'}:
        return await parse_from_link(ParseLinkBody(url=payload['url'],
            analyze_video=payload['mode'] == 'video', **common), _user=user)
    recipe = await extract_recipe_from_video(media_data=job.media_data, media_type=job.media_type,
                                             notes=common['notes'])
    recipe = recipe.model_copy(update={'source_url':payload.get('url') or None})
    return _apply_import_overrides(recipe, common['title'], common['library_tags'])


async def _run_admitted(job):
    maker = database.async_session_maker
    async with maker() as session:
        user = await session.get(UserModel, job.user_id)
        if user is None or user.auth_version != job.auth_version:
            raise HTTPException(401, 'Account access changed. Please import again.')
        await session.close()
        admitted = False
        try:
            async with asynccontextmanager(enforce_ai_budget)(session=session, user=user):
                admitted = True
                return await perform_import(job, user)
        except AIConcurrencyUnavailable as exc:
            if admitted:
                # Even a similarly typed failure after admission is terminal:
                # it could follow a charged provider request.
                raise
            raise ImportAdmissionDeferred(exc.retry_after) from None


async def process_job(job):
    task = asyncio.create_task(_run_admitted(job))
    result, error = None, None
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=0.5)
            if task.done():
                break
            async with database.async_session_maker() as session:
                active = (await session.execute(select(Job.id).join(UserModel, UserModel.id == Job.user_id)
                    .where(Job.id == job.id, Job.status == 'processing',
                           UserModel.auth_version == job.auth_version))).scalar_one_or_none()
            if active is None:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                return
        recipe = await task
        result = recipe.model_dump(mode='json')
    except ImportAdmissionDeferred as exc:
        async with database.async_session_maker.begin() as session:
            await jobs.requeue_job(session, job, retry_seconds=min(exc.retry_after, 5))
        return
    except HTTPException as exc:
        error = exc.detail if isinstance(exc.detail, dict) else {'code':'import_unavailable','message':str(exc.detail)}
    except (AIUnavailableError, AIInputTooLargeError) as exc:
        error = {'code':'analysis_unavailable', 'message':str(exc)}
    except asyncio.CancelledError:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        raise
    except Exception as exc:
        logger.warning('recipe_import_failed error_type=%s', type(exc).__name__)
        error = {'code':'import_failed', 'message':'Import could not finish. Your source is unchanged; please retry.'}
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    async with database.async_session_maker.begin() as session:
        await jobs.finish_job(session, job.id, result=result, error=error)


async def _worker():
    while True:
        try:
            maker = database.async_session_maker
            if maker is None:
                await asyncio.sleep(1)
                continue
            async with maker.begin() as session:
                job = await jobs.claim_job(session, lease_seconds=settings.AI_OPERATION_TIMEOUT_SECONDS + 15)
            if job is None:
                await asyncio.sleep(1)
            else:
                await process_job(job)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning('recipe_import_worker_unavailable error_type=%s', type(exc).__name__)
            await asyncio.sleep(5)


async def import_worker_loop():
    # Ledger admission remains global across replicas; local polling is bounded.
    async with asyncio.TaskGroup() as group:
        for _ in range(min(settings.AI_GLOBAL_MAX_INFLIGHT, 4)):
            group.create_task(_worker())
