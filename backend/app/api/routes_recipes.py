"""
Recipe CRUD and import routes. Uses repo + extract service. All require auth.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.core.config import get_public_library_editor_emails, settings
from app.db.session import get_session
from app.db import repo_recipes
from app.db.models import UserModel
from app.models import Recipe, IngredientItem, coerce_library_tags
from app.extract import _parse_youtube_video_id
from app.services.extract_service import (
    fetch_transcript_from_video_link,
    get_transcript_from_uploaded_file,
    get_ocr_text_from_video,
    extract_recipe_from_text,
)
from app.services.storage_service import (
    generate_image_upload_url,
    save_recipe_image_local,
)

router = APIRouter(prefix="/recipes", tags=["recipes"])
logger = logging.getLogger(__name__)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


class UploadImageResponse(BaseModel):
    upload_url: str
    file_url: str


@router.post("/upload-image", response_model=UploadImageResponse)
async def upload_recipe_image(
    request: Request,
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
):
    """Presigned S3 upload when configured; otherwise save to local disk and return file_url (upload_url empty)."""
    content_type = (file.content_type or "").strip().lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Invalid file type. Use JPEG, PNG, WebP, or GIF.")

    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 10MB)")

    region = (settings.AWS_REGION or "").strip()
    bucket = (settings.S3_BUCKET_NAME or "").strip()
    if region and bucket:
        try:
            result = generate_image_upload_url(content_type)
        except ValueError as e:
            logger.warning("Image upload config error: %s", e)
            raise HTTPException(503, str(e))
        except Exception as e:
            logger.exception("Image upload presign failed: %s", e)
            raise HTTPException(503, "Image upload is temporarily unavailable.")
        return UploadImageResponse(**result)

    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 10MB)")
    rel = save_recipe_image_local(data, content_type)
    base = str(request.base_url).rstrip("/")
    return UploadImageResponse(upload_url="", file_url=f"{base}{rel}")


class ImportLinkBody(BaseModel):
    url: str = ""
    notes: str = ""
    title: str = ""
    library_tags: list[str] = Field(default_factory=list)

    @field_validator("library_tags", mode="before")
    @classmethod
    def validate_library_tags(cls, v: object) -> list[str]:
        return coerce_library_tags(v)


def _build_import_recipe_overrides(title: str, library_tags: list[str]) -> dict[str, object]:
    updates: dict[str, object] = {}
    clean_title = title.strip()
    if clean_title:
        updates["title"] = clean_title
    updates["library_tags"] = coerce_library_tags(library_tags)
    return updates


def _append_import_notes(text: str, notes: str) -> str:
    clean_notes = (notes or "").strip()
    if not clean_notes:
        return text
    return text + ("\n\n" if text else "") + f"User guidance:\n{clean_notes}"


async def _parse_recipe_from_link_body(body: ImportLinkBody) -> Recipe:
    url = (body.url or "").strip()
    if not url:
        raise HTTPException(400, "url is required")
    transcript_result = fetch_transcript_from_video_link(url)
    if transcript_result.status != "ok":
        raise HTTPException(422, transcript_result.message or "Unable to import from this link.")
    transcript = _append_import_notes(transcript_result.transcript, body.notes)
    ocr_text = get_ocr_text_from_video(url)
    recipe = await extract_recipe_from_text(transcript, ocr_text)
    if recipe.thumbnail_url is None:
        video_id = _parse_youtube_video_id(url)
        if video_id:
            recipe = recipe.model_copy(
                update={"thumbnail_url": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"}
            )
    return recipe.model_copy(
        update={
            "source_url": url,
            **_build_import_recipe_overrides(body.title, body.library_tags),
        }
    )


@router.post("/parse/link", response_model=Recipe)
async def parse_from_link(
    body: ImportLinkBody,
    current_user: UserModel = Depends(get_current_user),
):
    del current_user
    return await _parse_recipe_from_link_body(body)


@router.post("/import/link")
async def import_from_link(
    body: ImportLinkBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Import recipe from video link. Fetches YouTube captions when possible, then LLM extraction."""
    recipe = await _parse_recipe_from_link_body(body)
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
    notes: str = ""
    title: str = ""
    library_tags: list[str] = Field(default_factory=list)

    @field_validator("library_tags", mode="before")
    @classmethod
    def validate_library_tags(cls, v: object) -> list[str]:
        return coerce_library_tags(v)


async def _parse_recipe_from_transcript_body(body: TranscriptBody) -> Recipe:
    text = (body.transcript or "").strip()
    text = _append_import_notes(text, body.notes)
    recipe = await extract_recipe_from_text(text, "")
    return recipe.model_copy(update=_build_import_recipe_overrides(body.title, body.library_tags))


@router.post("/parse/transcript", response_model=Recipe)
async def parse_from_transcript(
    body: TranscriptBody,
    current_user: UserModel = Depends(get_current_user),
):
    del current_user
    return await _parse_recipe_from_transcript_body(body)


@router.post("/import/transcript")
async def import_from_transcript(
    body: TranscriptBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Import by pasted transcript only."""
    recipe = await _parse_recipe_from_transcript_body(body)
    await repo_recipes.save_recipe(session, recipe, current_user.id)
    return recipe


class CatalogEditorStatus(BaseModel):
    can_manage: bool


class CatalogVisibilityBody(BaseModel):
    is_public: bool


def _can_manage_public_catalog(current_user: UserModel) -> bool:
    editor_emails = get_public_library_editor_emails()
    if not editor_emails:
        return True
    return (current_user.email or "").strip().lower() in editor_emails


@router.get("/catalog/editor-status", response_model=CatalogEditorStatus)
async def catalog_editor_status(
    current_user: UserModel = Depends(get_current_user),
):
    return CatalogEditorStatus(can_manage=_can_manage_public_catalog(current_user))


@router.get("/catalog", response_model=list[Recipe])
async def recipes_catalog_list(
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    del current_user
    return await repo_recipes.list_public_recipes(session)


@router.post("/catalog/{recipe_id}/copy", response_model=Recipe)
async def copy_catalog_recipe(
    recipe_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    recipe = await repo_recipes.copy_public_recipe_to_user(session, recipe_id, current_user.id)
    if not recipe:
        raise HTTPException(404, "Recipe not found in the public catalog")
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


@router.post("/{recipe_id}/catalog", response_model=Recipe)
async def recipe_set_catalog_visibility(
    recipe_id: str,
    body: CatalogVisibilityBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    if not _can_manage_public_catalog(current_user):
        raise HTTPException(403, "You cannot manage the public recipe catalog.")
    recipe = await repo_recipes.set_recipe_public_catalog(session, recipe_id, current_user.id, body.is_public)
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    return recipe


class RecipeUpdate(BaseModel):
    title: Optional[str] = None
    thumbnail_url: Optional[str] = None
    ingredients: Optional[list[IngredientItem]] = None
    library_tags: Optional[list[str]] = None

    @field_validator("library_tags", mode="before")
    @classmethod
    def validate_library_tags(cls, v: object) -> list[str]:
        return coerce_library_tags(v)


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
