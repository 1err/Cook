"""Durable menu decoration previews and authenticated PNG export bytes."""
from __future__ import annotations

import logging
import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.auth import get_current_user
from app.api.routes_recipe_images import ImageAccessResponse, ImageGenerationResponse
from app.core.config import settings
from app.core.ai_context import cleanup_lease
from app.services import recipe_image_service
from app.services.owned_images import reserve_owned_image, finish_owned_upload
from app.db.repo_upload_budget import reserve_upload_allowance, UploadAllowanceExceeded
from app.db import repo_recipe_images
from app.db.models import RecipeImageGenerationModel, UserModel
from app.db.session import get_session
from app.services.menu_artwork_service import LAYOUT_VERSION, PROMPT_VERSION, generate_menu_artwork
from app.services.menu_artwork_storage import MenuArtworkStorageError, read_menu_artwork, save_menu_artwork
from app.services.recipe_image_service import ImageGenerationError

router = APIRouter(prefix="/menus/artwork", tags=["menus"])
logger = logging.getLogger(__name__)


class GenerateMenuArtworkBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    style_id: Literal["cozy-cafe", "french-bistro", "garden-table", "italian-supper", "chinese-teahouse", "minimal-modern"]
    instructions: str = Field("", max_length=300)


def _result(row: RecipeImageGenerationModel, response: Response) -> ImageGenerationResponse:
    response.headers["Cache-Control"] = "no-store"
    if row.status == "pending":
        response.status_code = 202
        response.headers["Retry-After"] = "3"
    return ImageGenerationResponse(request_id=row.request_id, status=row.status,
                                   file_url=row.file_url, error_code=row.error_code)


def _http_error(exc: ImageGenerationError) -> HTTPException:
    headers = {"Cache-Control": "no-store"}
    if exc.retry_after:
        headers["Retry-After"] = str(exc.retry_after)
    return HTTPException(exc.status_code, {"code": exc.code, "message": exc.message}, headers=headers)


def _database_error(exc: SQLAlchemyError) -> HTTPException:
    logger.warning("menu_artwork_database_failed error_type=%s", type(exc).__name__)
    return _http_error(ImageGenerationError("unavailable", "AI images are temporarily unavailable.", 503, 30))


def _not_found() -> HTTPException:
    return _http_error(ImageGenerationError("not_found", "Image request not found.", 404))


@router.get("/access", response_model=ImageAccessResponse)
async def menu_artwork_access(response: Response, session: AsyncSession = Depends(get_session),
                              user: UserModel = Depends(get_current_user)):
    user_id = user.id
    response.headers["Cache-Control"] = "no-store"
    try:
        result = await repo_recipe_images.image_access(session, user_id)
        await session.close()
        return result
    except SQLAlchemyError as exc:
        await session.rollback()
        logger.warning("menu_artwork_access_unavailable error_type=%s", type(exc).__name__)
        now = datetime.now(timezone.utc)
        return ImageAccessResponse(enabled=False, allowed=False, reason="unavailable",
            daily_limit=repo_recipe_images.daily_limit(user_id), remaining=0,
            resets_at=now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))


@router.get("/{request_id}", response_model=ImageGenerationResponse)
async def menu_artwork_status(request_id: UUID, response: Response,
                              session: AsyncSession = Depends(get_session),
                              user: UserModel = Depends(get_current_user)):
    try:
        row = await repo_recipe_images.find_request(session, user.id, request_id, purpose="menu_artwork")
        await session.commit()
        if row is None:
            raise _not_found()
        result = _result(row, response)
        await session.close()
        return result
    except SQLAlchemyError as exc:
        await session.rollback()
        raise _database_error(exc) from None


@router.post("", response_model=ImageGenerationResponse)
async def create_menu_artwork(body: GenerateMenuArtworkBody, request: Request, response: Response,
                              session: AsyncSession = Depends(get_session),
                              user: UserModel = Depends(get_current_user)):
    user_id = user.id
    deadline = time.monotonic() + min(settings.AI_OPERATION_TIMEOUT_SECONDS,
                                      settings.OPENAI_IMAGE_TIMEOUT_SECONDS + 75)
    state = {"lease_id": None, "provider_started": False, "finished": False}
    try:
        async with asyncio.timeout_at(deadline):
            result = await _generate_artwork_operation(body, request, response, session, user, deadline, state)
            state["finished"] = True
            return result
    except TimeoutError:
        raise _http_error(ImageGenerationError("generation_timeout",
            "Image generation took too long. Check this request before trying again.")) from None
    finally:
        try:
            async with asyncio.timeout(5):
                await session.rollback()
        except Exception:
            logger.warning("menu_artwork_rollback_unavailable")
        if state["lease_id"] is not None:
            if not state["finished"]:
                try:
                    async with asyncio.timeout(5):
                        if not state["provider_started"]:
                            await recipe_image_service.finish_provider_call(state["lease_id"], denied=True)
                        await repo_recipe_images.finish_generation(session, user_id, body.request_id,
                            purpose="menu_artwork", error_code="generation_interrupted")
                        await session.commit()
                except Exception:
                    logger.warning("menu_artwork_interruption_record_unavailable")
            try:
                await cleanup_lease(state["lease_id"])
            except Exception:
                logger.warning("menu_artwork_lease_cleanup_unavailable")


async def _generate_artwork_operation(body, request, response, session, user, deadline, state):
    user_id, auth_version = user.id, user.auth_version
    data = {**body.model_dump(mode="json", exclude={"request_id"}),
            "prompt_version": PROMPT_VERSION, "layout_version": LAYOUT_VERSION}
    try:
        row, admitted = await repo_recipe_images.begin_generation(
            session, user_id, body.request_id, data, purpose="menu_artwork")
        if admitted:
            state["lease_id"] = row.ledger_call_id
        await session.commit()
        if not admitted:
            result = _result(row, response)
            await session.close()
            return result
        # Admission survives disconnects; external work holds no connection.
        await session.close()
        if time.monotonic() >= deadline:
            raise TimeoutError
    except ImageGenerationError as exc:
        await session.rollback()
        raise _http_error(exc) from None
    except SQLAlchemyError as exc:
        await session.rollback()
        raise _database_error(exc) from None

    stored = None
    file_url = error_code = None
    try:
        state["provider_started"] = True
        content = await generate_menu_artwork(body.style_id, body.instructions, ledger_call_id=row.ledger_call_id)
        await reserve_upload_allowance(str(user_id), len(content))
        receipt = await reserve_owned_image(user_id, auth_version, "image/png", str(request.base_url),
                                            namespace="menu-artwork")
        stored = await run_in_threadpool(save_menu_artwork, content, str(user_id), receipt["object_key"])
        await finish_owned_upload(receipt["id"])
        file_url = receipt["file_url"]
    except MenuArtworkStorageError:
        error_code = "storage_failed"
    except ImageGenerationError as exc:
        error_code = exc.code
    except UploadAllowanceExceeded:
        error_code = "storage_limit"
    except Exception as exc:
        logger.warning("menu_artwork_storage_failed error_type=%s", type(exc).__name__)
        error_code = "storage_failed"

    try:
        row = await repo_recipe_images.finish_generation(session, user_id, body.request_id,
            purpose="menu_artwork", file_url=file_url, error_code=error_code,
            storage_kind=stored.storage_kind if stored else None,
            storage_key=stored.storage_key if stored else None)
        await session.commit()
        result = _result(row, response)
        await session.close()
        return result
    except SQLAlchemyError as exc:
        await session.rollback()
        raise _database_error(exc) from None


@router.get("/{request_id}/file")
async def menu_artwork_file(request_id: UUID, session: AsyncSession = Depends(get_session),
                            user: UserModel = Depends(get_current_user)):
    user_id = user.id
    try:
        row = await repo_recipe_images.find_request(session, user_id, request_id, purpose="menu_artwork")
        await session.commit()
        if row is None:
            raise _not_found()
        if row.status != "completed":
            raise _http_error(ImageGenerationError("not_ready", "Menu artwork is not available for export.", 409))
        if not row.storage_kind or not row.storage_key:
            raise _not_found()
        storage_kind, storage_key = row.storage_kind, row.storage_key
        await session.close()
    except SQLAlchemyError as exc:
        await session.rollback()
        raise _database_error(exc) from None
    try:
        content = await run_in_threadpool(read_menu_artwork, storage_kind, storage_key, str(user_id))
    except MenuArtworkStorageError as exc:
        raise _http_error(exc) from None
    except Exception as exc:
        logger.warning("menu_artwork_read_failed error_type=%s", type(exc).__name__)
        raise _http_error(MenuArtworkStorageError()) from None
    return Response(content=content, media_type="image/png",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
