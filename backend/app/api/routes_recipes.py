"""
Recipe CRUD, parse, catalog, and image-upload routes. All require auth.

Import flow is two-step: ``/recipes/parse/{link,transcript}`` returns a draft
Recipe without persisting; the client edits and then ``POST /recipes`` saves it.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._types import LibraryTags, StepList, StringList
from app.api.auth import get_current_user
from app.api.ai_budget import enforce_ai_budget
from app.api.abuse import enforce_upload_limits
from app.core.config import settings
from app.core.admin import can_manage_public_catalog
from app.db import repo_mealplan, repo_recipes
from app.services.owned_images import reserve_owned_image, finish_owned_upload
from app.db.models import UserModel
from app.db.session import get_session
from app.extract import (
    estimate_tutorial_step_metadata,
    extract_recipe_from_text,
    is_usable_instruction_text,
)
from app.models import IngredientItem, Recipe, RecipeStep, RecipePage, coerce_steps
from app.api.recipe_pages import RecipePageQuery, read_page
from app.services.storage_service import (
    matches_image_signature,
    save_recipe_image_local,
    save_recipe_image_s3,
)
from app.video_import import UnsupportedVideoUrl, fetch_video_text, parse_video_source

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
    session: AsyncSession = Depends(get_session),
):
    """Validate once and store these bytes in S3 or local disk; no second upload."""
    content_type = (file.content_type or "").strip().lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Invalid file type. Use JPEG, PNG, WebP, or GIF.")

    data = await file.read(MAX_FILE_SIZE + 1)
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 10MB)")
    if not matches_image_signature(data, content_type):
        raise HTTPException(400, "The file contents do not match a supported image type.")

    account_id = str(_user.id)
    # Authentication is the only DB work here; storage must not hold its connection.
    await session.close()
    await enforce_upload_limits(account_id, len(data))
    receipt = await reserve_owned_image(_user.id, _user.auth_version, content_type, str(request.base_url))
    try:
        if receipt["storage_kind"] == "s3":
            await run_in_threadpool(save_recipe_image_s3, data, content_type, account_id, receipt["object_key"])
        else:
            await run_in_threadpool(save_recipe_image_local, data, content_type, receipt["object_key"])
        await finish_owned_upload(receipt["id"])
    except Exception as e:
        logger.warning("Image upload failed error_type=%s", type(e).__name__)
        raise HTTPException(503, "Image upload is temporarily unavailable.") from None
    return UploadImageResponse(upload_url="", file_url=receipt["file_url"])


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


def _has_usable_steps(recipe: Recipe) -> bool:
    return any(is_usable_instruction_text(step.text) for step in recipe.steps)


class ParseLinkBody(BaseModel):
    url: str = Field("", max_length=4096)
    notes: str = Field("", max_length=4000)
    title: str = Field("", max_length=512)
    library_tags: LibraryTags = Field(default_factory=list)


@router.post("/parse/link", response_model=Recipe, dependencies=[Depends(enforce_ai_budget)])
async def parse_from_link(
    body: ParseLinkBody,
    _user: UserModel = Depends(get_current_user),
):
    url = (body.url or "").strip()
    if not url:
        raise HTTPException(400, "url is required")
    try:
        source = parse_video_source(url)
    except UnsupportedVideoUrl as exc:
        raise HTTPException(400, str(exc)) from exc

    text_result = await fetch_video_text(source)
    if text_result.status in {"fetch_failed", "dependency_missing"}:
        raise HTTPException(503, text_result.message or "Video import is temporarily unavailable.")
    if text_result.status != "ok":
        raise HTTPException(422, text_result.message or "No usable recipe text was found.")

    recipe = await extract_recipe_from_text(_append_import_notes(text_result.text, body.notes))
    if not _has_usable_steps(recipe):
        provider_name = "YouTube video" if source.provider == "youtube" else "TikTok"
        raise HTTPException(
            422,
            f"We could not recover usable cooking steps from this {provider_name}. "
            "Paste a transcript that includes the cooking method instead.",
        )
    updates = {
        "source_url": source.canonical_url,
        "thumbnail_url": recipe.thumbnail_url or text_result.thumbnail_url,
    }
    source_title = (text_result.title or "").strip()
    if source_title and recipe.title.strip().casefold() in {"", "untitled recipe", "imported recipe"}:
        updates["title"] = source_title
    recipe = recipe.model_copy(update=updates)
    return _apply_import_overrides(recipe, body.title, body.library_tags)


class ParseTranscriptBody(BaseModel):
    transcript: str = Field("", max_length=40_000)
    notes: str = Field("", max_length=4000)
    title: str = Field("", max_length=512)
    library_tags: LibraryTags = Field(default_factory=list)


@router.post("/parse/transcript", response_model=Recipe, dependencies=[Depends(enforce_ai_budget)])
async def parse_from_transcript(
    body: ParseTranscriptBody,
    _user: UserModel = Depends(get_current_user),
):
    text = _append_import_notes((body.transcript or "").strip(), body.notes)
    if not text.strip():
        raise HTTPException(422, "Paste recipe text before importing.")
    recipe = await extract_recipe_from_text(text)
    return _apply_import_overrides(recipe, body.title, body.library_tags)


class CatalogEditorStatus(BaseModel):
    can_manage: bool


class CatalogVisibilityBody(BaseModel):
    is_public: bool


def _can_manage_public_catalog(current_user: UserModel) -> bool:
    return can_manage_public_catalog(current_user)


@router.get("/catalog/editor-status", response_model=CatalogEditorStatus)
async def catalog_editor_status(
    current_user: UserModel = Depends(get_current_user),
):
    return CatalogEditorStatus(can_manage=_can_manage_public_catalog(current_user))


@router.get("/page", response_model=RecipePage)
async def recipes_page(query: RecipePageQuery = Depends(), session: AsyncSession = Depends(get_session),
                       current_user: UserModel = Depends(get_current_user)):
    return await read_page(session, current_user.id, query)


@router.get("/catalog/page", response_model=RecipePage)
async def catalog_page(query: RecipePageQuery = Depends(), session: AsyncSession = Depends(get_session),
                       current_user: UserModel = Depends(get_current_user)):
    return await read_page(session, current_user.id, query, catalog=True)


@router.get("/catalog", response_model=list[Recipe], deprecated=True)
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


@router.get("", response_model=list[Recipe], deprecated=True)
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
    dependencies=[Depends(enforce_ai_budget)],
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
    # The preview is detached data and this route has no pending writes.
    await session.close()
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
    title: Optional[str] = Field(default=None, min_length=1, max_length=1024)
    thumbnail_url: Optional[str] = None
    ingredients: Optional[list[IngredientItem]] = None
    library_tags: Optional[LibraryTags] = None
    description: Optional[str] = None
    total_time_minutes: Optional[int] = Field(default=None, ge=0, le=2_147_483_647)
    steps: Optional[StepList] = None
    tips: Optional[StringList] = None
    equipment: Optional[StringList] = None

    @field_validator("title", "ingredients", mode="before")
    @classmethod
    def reject_required_field_nulls(cls, value: object) -> object:
        if value is None:
            raise ValueError("This field cannot be null; omit it to leave it unchanged")
        return value

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
    try:
        return await repo_recipes.save_recipe(session, updated, current_user.id)
    except repo_recipes.RecipeOwnershipConflict as exc:
        raise HTTPException(409, "Recipe ID is unavailable for this account") from exc


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


class RecipeSaveBody(Recipe):
    """Request-only storage bounds; legacy recipe response reads stay compatible."""
    id: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=1024)
    total_time_minutes: Optional[int] = Field(default=None, ge=0, le=2_147_483_647)


@router.post("", response_model=Recipe)
async def recipe_create(
    recipe: RecipeSaveBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    try:
        return await repo_recipes.save_recipe(session, recipe, current_user.id)
    except repo_recipes.RecipeOwnershipConflict as exc:
        raise HTTPException(409, "Recipe ID is unavailable for this account") from exc
