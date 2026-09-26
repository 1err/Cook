"""AI recipe covers are previews: generating never changes a saved recipe."""
from __future__ import annotations

import logging
import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.auth import get_current_user
from app.core.config import settings
from app.core.ai_context import cleanup_lease
from app.db import repo_recipe_images
from app.db.models import RecipeImageGenerationModel, UserModel
from app.db.session import get_session
from app.services.recipe_image_service import ImageGenerationError, generate_recipe_image
from app.services import recipe_image_service
from app.services.storage_service import save_recipe_image_local, save_recipe_image_s3
from app.services.owned_images import reserve_owned_image, finish_owned_upload
from app.db.repo_upload_budget import reserve_upload_allowance, UploadAllowanceExceeded

router = APIRouter(prefix="/recipes", tags=["recipes"])
logger = logging.getLogger(__name__)


class GenerateRecipeImageBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)]
    description: str = Field("", max_length=2000)
    ingredients: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]] = Field(default_factory=list, max_length=40)
    steps: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]] = Field(default_factory=list, max_length=12)


class ImageAccessResponse(BaseModel):
    enabled: bool
    allowed: bool
    reason: Literal["disabled", "membership_required", "daily_limit", "unavailable", "global_limit"] | None
    daily_limit: int
    remaining: int
    resets_at: datetime


class ImageGenerationResponse(BaseModel):
    request_id: UUID
    status: Literal["completed", "pending", "failed"]
    file_url: str | None
    error_code: str | None = None


def _result(row: RecipeImageGenerationModel, response: Response) -> ImageGenerationResponse:
    response.headers["Cache-Control"] = "no-store"
    if row.status == "pending":
        response.status_code = 202
        response.headers["Retry-After"] = "3"
    return ImageGenerationResponse(request_id=row.request_id, status=row.status,
                                   file_url=row.file_url, error_code=row.error_code)


def _http_error(exc: ImageGenerationError) -> HTTPException:
    return HTTPException(exc.status_code, {"code": exc.code, "message": exc.message},
                         headers={"Retry-After": str(exc.retry_after)} if exc.retry_after else None)


def _database_error(exc: SQLAlchemyError) -> HTTPException:
    logger.warning("recipe_image_database_failed error_type=%s", type(exc).__name__)
    return HTTPException(503, {"code": "unavailable", "message": "AI images are temporarily unavailable."},
                         headers={"Retry-After": "30"})


@router.get("/image-generation/access", response_model=ImageAccessResponse)
async def image_generation_access(response: Response, session: AsyncSession = Depends(get_session),
                                   user: UserModel = Depends(get_current_user)):
    user_id = user.id
    response.headers["Cache-Control"] = "no-store"
    try:
        result = await repo_recipe_images.image_access(session, user_id)
        await session.close()
        return result
    except SQLAlchemyError as exc:
        await session.rollback()
        logger.warning("recipe_image_access_unavailable error_type=%s", type(exc).__name__)
        now = datetime.now(timezone.utc)
        return ImageAccessResponse(enabled=False, allowed=False, reason="unavailable",
            daily_limit=repo_recipe_images.daily_limit(user_id), remaining=0,
            resets_at=now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))


@router.get("/image-generation/{request_id}", response_model=ImageGenerationResponse)
async def image_generation_status(request_id: UUID, response: Response,
                                   session: AsyncSession = Depends(get_session),
                                   user: UserModel = Depends(get_current_user)):
    try:
        row = await repo_recipe_images.find_request(
            session, user.id, request_id, purpose="recipe_cover"
        )
        await session.commit()
        if row is None:
            raise HTTPException(404, {"code": "not_found", "message": "Image request not found."})
        return _result(row, response)
    except SQLAlchemyError as exc:
        await session.rollback()
        raise _database_error(exc) from None


@router.post("/generate-image", response_model=ImageGenerationResponse)
async def generate_image(body: GenerateRecipeImageBody, request: Request, response: Response,
                          session: AsyncSession = Depends(get_session),
                          user: UserModel = Depends(get_current_user)):
    user_id = user.id
    deadline = time.monotonic() + min(settings.AI_OPERATION_TIMEOUT_SECONDS,
                                      settings.OPENAI_IMAGE_TIMEOUT_SECONDS + 75)
    state = {'lease_id': None, 'provider_started': False, 'finished': False}
    try:
        async with asyncio.timeout_at(deadline):
            result = await _generate_image_operation(body, request, response, session, user, deadline, state)
            state['finished'] = True
            return result
    except TimeoutError:
        raise _http_error(ImageGenerationError('generation_timeout',
            'Image generation took too long. Check this request before trying again.')) from None
    finally:
        try:
            async with asyncio.timeout(5):
                await session.rollback()
        except Exception:
            logger.warning('recipe_image_rollback_unavailable')
        if state['lease_id'] is not None:
            if not state['finished']:
                try:
                    async with asyncio.timeout(5):
                        if not state['provider_started']:
                            await recipe_image_service.finish_provider_call(state['lease_id'], denied=True)
                        await repo_recipe_images.finish_generation(session, user_id, body.request_id,
                            error_code='generation_interrupted')
                        await session.commit()
                except Exception:
                    logger.warning('recipe_image_interruption_record_unavailable')
            try:
                await cleanup_lease(state['lease_id'])
            except Exception:
                logger.warning('recipe_image_lease_cleanup_unavailable')


async def _generate_image_operation(body, request, response, session, user, deadline, state):
    user_id = user.id
    auth_version = user.auth_version
    recipe = body.model_dump(mode="json", exclude={"request_id"})
    try:
        row, admitted = await repo_recipe_images.begin_generation(
            session, user_id, body.request_id, recipe, purpose="recipe_cover")
        if admitted:
            state['lease_id'] = row.ledger_call_id
        await session.commit()
        if not admitted:
            return _result(row, response)
        # No connection or transaction remains checked out during paid/provider
        # work. The durable reservation survives a client disconnect or restart.
        await session.close()
        # Also catches a dependency that blocked synchronously or swallowed
        # cancellation. Never start paid work after its admission lease elapsed.
        if time.monotonic() >= deadline:
            raise TimeoutError
    except ImageGenerationError as exc:
        await session.rollback()
        raise _http_error(exc) from None
    except SQLAlchemyError as exc:
        await session.rollback()
        raise _database_error(exc) from None

    file_url = None
    error_code = None
    try:
        state['provider_started'] = True
        data = await generate_recipe_image(recipe, ledger_call_id=row.ledger_call_id)
        # Existing cumulative bytes/count caps still apply. Image generation has
        # its own short-term admission and does not consume manual upload quotas.
        await reserve_upload_allowance(str(user_id), len(data))
        receipt = await reserve_owned_image(user_id, auth_version, 'image/png', str(request.base_url))
        if receipt['storage_kind'] == 's3':
            await run_in_threadpool(save_recipe_image_s3, data, "image/png", str(user_id), receipt['object_key'])
        else:
            await run_in_threadpool(save_recipe_image_local, data, "image/png", receipt['object_key'])
        await finish_owned_upload(receipt['id'])
        file_url = receipt['file_url']
    except ImageGenerationError as exc:
        error_code = exc.code
    except UploadAllowanceExceeded:
        error_code = 'storage_limit'
    except Exception as exc:
        logger.warning("recipe_image_storage_failed error_type=%s", type(exc).__name__)
        error_code = "storage_failed"

    try:
        row = await repo_recipe_images.finish_generation(session, user_id, body.request_id,
                                                         purpose="recipe_cover",
                                                         file_url=file_url, error_code=error_code)
        await session.commit()
        return _result(row, response)
    except SQLAlchemyError as exc:
        # The request remains consumed. Its result can be recovered by ID; never
        # repeat the expensive provider call on an ambiguous database failure.
        await session.rollback()
        raise _database_error(exc) from None
