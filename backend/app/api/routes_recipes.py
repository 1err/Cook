"""
Recipe CRUD and import routes. Uses repo + extract service. All require auth.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db.session import get_session
from app.db import repo_recipes
from app.db.models import UserModel
from app.models import Recipe, IngredientItem
from app.extract import _parse_youtube_video_id
from app.services.extract_service import (
    get_transcript_from_video_link,
    get_transcript_from_uploaded_file,
    get_ocr_text_from_video,
    extract_recipe_from_text,
)
from app.services.storage_service import generate_image_upload_url

router = APIRouter(prefix="/recipes", tags=["recipes"])
logger = logging.getLogger(__name__)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


class UploadImageResponse(BaseModel):
    upload_url: str
    file_url: str


@router.post("/upload-image", response_model=UploadImageResponse)
async def upload_recipe_image(
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
):
    """Return a presigned S3 URL for the client to upload an image; use file_url as recipe thumbnail_url."""
    content_type = (file.content_type or "").strip().lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Invalid file type. Use JPEG, PNG, WebP, or GIF.")

    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 10MB)")

    try:
        result = generate_image_upload_url(content_type)
    except ValueError as e:
        logger.warning("Image upload config error: %s", e)
        raise HTTPException(503, str(e))
    except Exception as e:
        logger.exception("Image upload presign failed: %s", e)
        raise HTTPException(503, "Image upload is temporarily unavailable.")
    return UploadImageResponse(**result)


@router.post("/import/link")
async def import_from_link(
    url: str,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Import recipe from video link. Fetches YouTube captions when possible, then LLM extraction."""
    transcript = get_transcript_from_video_link(url)
    ocr_text = get_ocr_text_from_video(url)
    recipe = await extract_recipe_from_text(transcript, ocr_text)
    if recipe.thumbnail_url is None:
        video_id = _parse_youtube_video_id(url)
        if video_id:
            recipe = recipe.model_copy(
                update={"thumbnail_url": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"}
            )
    recipe = recipe.model_copy(update={"source_url": url})
    await repo_recipes.save_recipe(session, recipe, current_user.id)
    return recipe


@router.post("/import/upload")
async def import_from_upload(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Import recipe from uploaded video file. Transcript stubbed; real impl would use Whisper."""
    transcript = get_transcript_from_uploaded_file("")
    ocr_text = get_ocr_text_from_video("")
    recipe = await extract_recipe_from_text(transcript, ocr_text)
    await repo_recipes.save_recipe(session, recipe, current_user.id)
    return recipe


class TranscriptBody(BaseModel):
    transcript: str = ""


@router.post("/import/transcript")
async def import_from_transcript(
    body: TranscriptBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Import by pasted transcript only."""
    recipe = await extract_recipe_from_text(body.transcript, "")
    await repo_recipes.save_recipe(session, recipe, current_user.id)
    return recipe


@router.get("", response_model=list[Recipe])
async def recipes_list(
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    return await repo_recipes.list_recipes(session, current_user.id)


@router.get("/{recipe_id}", response_model=Recipe)
async def recipe_get(
    recipe_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    r = await repo_recipes.get_recipe(session, recipe_id, current_user.id)
    if not r:
        raise HTTPException(404, "Recipe not found")
    return r


class RecipeUpdate(BaseModel):
    title: Optional[str] = None
    thumbnail_url: Optional[str] = None
    ingredients: Optional[list[IngredientItem]] = None


@router.patch("/{recipe_id}", response_model=Recipe)
async def recipe_update(
    recipe_id: str,
    body: RecipeUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    r = await repo_recipes.get_recipe(session, recipe_id, current_user.id)
    if not r:
        raise HTTPException(404, "Recipe not found")
    updates = body.model_dump(exclude_unset=True)
    updated = r.model_copy(update=updates)
    await repo_recipes.save_recipe(session, updated, current_user.id)
    return updated


@router.delete("/{recipe_id}", status_code=204)
async def recipe_delete(
    recipe_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    deleted = await repo_recipes.delete_recipe(session, recipe_id, current_user.id)
    if not deleted:
        raise HTTPException(404, "Recipe not found")


@router.post("", response_model=Recipe)
async def recipe_create(
    recipe: Recipe,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    await repo_recipes.save_recipe(session, recipe, current_user.id)
    return recipe
