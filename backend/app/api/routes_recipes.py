"""
Recipe CRUD, parse, catalog, and image-upload routes. All require auth.

Import flow is two-step: ``/recipes/parse/{link,transcript}`` returns a draft
Recipe without persisting; the client edits and then ``POST /recipes`` saves it.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._types import LibraryTags, StepList, StringList
from app.api.auth import get_current_user
from app.core.config import get_public_library_editor_emails, settings
from app.db import repo_mealplan, repo_recipes
from app.db.models import UserModel
from app.db.session import get_session
from app.extract import (
    _parse_youtube_video_id,
    estimate_tutorial_step_metadata,
    extract_recipe_from_text,
    fetch_transcript_from_video_link,
)
from app.models import IngredientItem, Recipe, RecipeStep, coerce_steps
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
    _user: UserModel = Depends(get_current_user),
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


def _append_import_notes(text: str, notes: str) -> str:
    clean_notes = (notes or "").strip()
    if not clean_notes:
        return text
    return text + ("\n\n" if text else "") + f"User guidance:\n{clean_notes}"


def _apply_import_overrides(recipe: Recipe, title: str, library_tags: list[str]) -> Recipe:
    updates: dict[str, object] = {"library_tags": library_tags}
    clean_title = title.strip()
    if clean_title:
        updates["title"] = clean_title
    return recipe.model_copy(update=updates)


class ParseLinkBody(BaseModel):
    url: str = ""
    notes: str = ""
    title: str = ""
    library_tags: LibraryTags = Field(default_factory=list)


@router.post("/parse/link", response_model=Recipe)
async def parse_from_link(
    body: ParseLinkBody,
    _user: UserModel = Depends(get_current_user),
):
    url = (body.url or "").strip()
    if not url:
        raise HTTPException(400, "url is required")
    transcript_result = fetch_transcript_from_video_link(url)
    if transcript_result.status != "ok":
        raise HTTPException(422, transcript_result.message or "Unable to import from this link.")
    transcript = _append_import_notes(transcript_result.transcript, body.notes)
    recipe = await extract_recipe_from_text(transcript)
    if recipe.thumbnail_url is None:
        video_id = _parse_youtube_video_id(url)
        if video_id:
            recipe = recipe.model_copy(
                update={"thumbnail_url": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"}
            )
    recipe = recipe.model_copy(update={"source_url": url})
    return _apply_import_overrides(recipe, body.title, body.library_tags)


class ParseTranscriptBody(BaseModel):
    transcript: str = ""
    notes: str = ""
    title: str = ""
    library_tags: LibraryTags = Field(default_factory=list)


@router.post("/parse/transcript", response_model=Recipe)
async def parse_from_transcript(
    body: ParseTranscriptBody,
    _user: UserModel = Depends(get_current_user),
):
    text = _append_import_notes((body.transcript or "").strip(), body.notes)
    recipe = await extract_recipe_from_text(text)
    return _apply_import_overrides(recipe, body.title, body.library_tags)


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
    _user: UserModel = Depends(get_current_user),
):
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


class EstimateTutorialBody(BaseModel):
    steps: StepList


class EstimateTutorialResponse(BaseModel):
    steps: list[RecipeStep]


@router.post(
    "/{recipe_id}/tutorial/estimate",
    response_model=EstimateTutorialResponse,
)
async def recipe_estimate_tutorial(
    recipe_id: str,
    body: EstimateTutorialBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    recipe = await repo_recipes.get_recipe(session, recipe_id, current_user.id)
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    draft_steps = coerce_steps(body.steps, recipe.total_time_minutes)
    estimated_steps = await estimate_tutorial_step_metadata(draft_steps)
    return EstimateTutorialResponse(steps=estimated_steps)


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
    library_tags: Optional[LibraryTags] = None
    description: Optional[str] = None
    total_time_minutes: Optional[int] = None
    steps: Optional[StepList] = None
    tips: Optional[StringList] = None
    equipment: Optional[StringList] = None

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, v: object) -> Optional[str]:
        """Trim whitespace; return None if empty after trimming."""
        if v is None:
            return None
        if not isinstance(v, str):
            return None
        s = v.strip()
        return s or None


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
    updated = Recipe.model_validate({**r.model_dump(), **updates})
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
    # Keep the planner clean: drop dangling references in this user's meal plans.
    # (Other users' meal plans aren't touched — their copies have their own ids.)
    await repo_mealplan.remove_recipe_id_from_user_plans(session, current_user.id, recipe_id)


@router.post("", response_model=Recipe)
async def recipe_create(
    recipe: Recipe,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    await repo_recipes.save_recipe(session, recipe, current_user.id)
    return recipe
