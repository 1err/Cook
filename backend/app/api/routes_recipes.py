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
    extract_recipe_from_video,
    is_usable_instruction_text,
    is_usable_ingredient_name,
)
from app.models import IngredientItem, Recipe, RecipeStep, RecipePage, ImportReview, coerce_steps
from app.services.video_analysis import video_analysis_available
from app.rednote import download_rednote_video
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
    analyze_video: bool = False


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

    can_analyze = source.provider == "youtube" and video_analysis_available()
    if body.analyze_video and not can_analyze:
        raise HTTPException(503, {"code": "video_analysis_unavailable",
            "message": "Video analysis is not available. Paste recipe text or try a captioned video."})
    text_result = None if body.analyze_video else await fetch_video_text(source)
    if text_result and source.provider == "xiaohongshu":
        source = text_result.source
    use_rednote_video = bool(text_result and text_result.status == "ok"
                             and source.provider == "xiaohongshu" and text_result.media_url
                             and video_analysis_available())
    use_video = can_analyze and (body.analyze_video or text_result.status != "ok"
                                or text_result.source_kind == "description")
    if use_rednote_video:
        media_data, media_type = await download_rednote_video(text_result.media_url)
        recipe = await extract_recipe_from_video(media_data=media_data, media_type=media_type,
            notes=_append_import_notes(text_result.text, body.notes))
    elif use_video:
        # Captured descriptions often carry exact ingredient quantities that are
        # never spoken. Keep that evidence when upgrading to video analysis.
        source_notes = (f"Video description (source evidence):\n{text_result.text}"
                        if text_result and text_result.text.strip() else "")
        recipe = await extract_recipe_from_video(source_url=source.canonical_url,
            notes=_append_import_notes(source_notes, body.notes))
    else:
        if text_result.status != "ok":
            temporary = text_result.status in {"fetch_failed", "dependency_missing"}
            raise HTTPException(503 if temporary else 422, {
                "code": ("source_temporarily_unavailable" if temporary else
                         "source_access_required" if text_result.status == "access_required" else "source_unavailable"),
                "message": text_result.message or "No usable recipe text was found. Paste recipe text to continue.",
            })
        recipe = await extract_recipe_from_text(_append_import_notes(text_result.text, body.notes),
                                                source_kind=text_result.source_kind)
    review = recipe.import_review or ImportReview(source_kind="media" if use_rednote_video else "video" if use_video else text_result.source_kind)
    review.can_analyze_video = can_analyze
    if not _has_usable_steps(recipe):
        if not any(is_usable_ingredient_name(item.name) for item in recipe.ingredients):
            raise HTTPException(422, {'code':'recipe_content_missing',
                'message':'No usable recipe content was found. Paste recipe text or upload the video to continue.'})
        recipe = recipe.model_copy(update={'steps': []})
        review.status = "needs_review"
        review.warnings = list(dict.fromkeys([*review.warnings,
            "The source did not provide a complete cooking method. Add instructions or analyze the video before cooking."]))[:30]
    updates = {
        "source_url": source.canonical_url,
        "thumbnail_url": recipe.thumbnail_url or (text_result.thumbnail_url if text_result else None)
            or (f"https://img.youtube.com/vi/{source.external_id}/hqdefault.jpg" if source.provider == "youtube" else None),
        "import_review": review,
    }
    source_title = (text_result.title or "").strip() if text_result else ""
    if source_title and recipe.title.strip().casefold() in {"", "untitled recipe", "imported recipe"}:
        updates["title"] = source_title
    recipe = recipe.model_copy(update=updates)
    return _apply_import_overrides(recipe, body.title, body.library_tags)


class ParseTranscriptBody(BaseModel):
    transcript: str = Field("", max_length=40_000)
    notes: str = Field("", max_length=4000)
    title: str = Field("", max_length=512)
    library_tags: LibraryTags = Field(default_factory=list)
    source_url: str | None = Field(None, max_length=4096)


@router.post("/parse/transcript", response_model=Recipe, dependencies=[Depends(enforce_ai_budget)])
async def parse_from_transcript(
    body: ParseTranscriptBody,
    _user: UserModel = Depends(get_current_user),
):
    text = _append_import_notes((body.transcript or "").strip(), body.notes)
    if not text.strip():
        raise HTTPException(422, "Paste recipe text before importing.")
    source = None
    if body.source_url:
        try:
            source = parse_video_source(body.source_url)
        except UnsupportedVideoUrl as exc:
            raise HTTPException(422, str(exc)) from None
    recipe = await extract_recipe_from_text(text)
    if source is not None:
        recipe = recipe.model_copy(update={"source_url": source.canonical_url})
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
    request: Request = None,
):
    created: list[bool] = []
    recipe = await repo_recipes.copy_public_recipe_to_user(session, recipe_id, current_user.id, created_outcome=created)
    if not recipe:
        raise HTTPException(404, "Recipe not found in the public catalog")
    if request is not None:
        request.state.analytics_skip = not bool(created)
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
