"""Friend library sharing routes.

GET  /users/search?email=...                            — find a user by email if their library is public
GET  /users/{user_id}/recipes                           — list a user's recipes if their library is public
POST /users/{user_id}/recipes/{recipe_id}/copy          — clone into the caller's library
"""
import uuid
from typing import Literal

from fastapi import Request, APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from app.db.models import RecipeModel

from app.api.auth import get_current_user
from app.db import repo_content_safety, repo_users, repo_recipes
from app.services.content_safety_service import is_shareable_recipe
from app.db.models import UserModel
from app.db.repo_recipes import _row_to_recipe, _row_to_shared_recipe
from app.db.session import get_session
from app.models import Recipe, RecipePage
from app.api.recipe_pages import RecipePageQuery, read_page


router = APIRouter(prefix="/users", tags=["users"])


class PublicUserResponse(BaseModel):
    id: str
    email: str
    is_library_public: bool


@router.get("/blocks")
async def blocked_users(session: AsyncSession = Depends(get_session), current_user: UserModel = Depends(get_current_user)):
    rows = await repo_content_safety.list_blocks(session, current_user.id)
    return {"users": [{"id": str(row.id), "email": row.email} for row in rows]}


class ReportRecipeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipe_id: str = Field(min_length=1, max_length=255)
    reason: Literal["objectionable", "harassment", "privacy", "spam", "other"]
    notes: str | None = Field(default=None, max_length=2000)


@router.post("/reports", status_code=201)
async def report_recipe(body: ReportRecipeBody, session: AsyncSession = Depends(get_session),
                        current_user: UserModel = Depends(get_current_user)):
    row = await repo_content_safety.visible_shared_recipe(session, body.recipe_id, current_user.id)
    if row is None:
        raise HTTPException(404, "Shared recipe not found")
    if row.user_id == current_user.id:
        raise HTTPException(400, "You cannot report your own recipe")
    report = await repo_content_safety.create_report(session, current_user.id, row, body.reason,
        (body.notes or "").strip() or None, _row_to_shared_recipe(row).model_dump(mode="json"))
    return {"id": str(report.id), "status": "pending"}


@router.put("/recipe-authors/{recipe_id}/block")
async def block_recipe_author(recipe_id: str, session: AsyncSession = Depends(get_session),
                              current_user: UserModel = Depends(get_current_user)):
    row = await repo_content_safety.visible_shared_recipe(session, recipe_id, current_user.id)
    if row is None:
        raise HTTPException(404, "Shared recipe not found")
    await repo_content_safety.block_user(session, current_user.id, row.user_id)
    return {"ok": True}


@router.put("/{user_id}/block")
async def block_user(user_id: uuid.UUID, session: AsyncSession = Depends(get_session),
                     current_user: UserModel = Depends(get_current_user)):
    await repo_content_safety.block_user(session, current_user.id, user_id)
    return {"ok": True}


@router.delete("/{user_id}/block")
async def unblock_user(user_id: uuid.UUID, session: AsyncSession = Depends(get_session),
                       current_user: UserModel = Depends(get_current_user)):
    await repo_content_safety.unblock_user(session, current_user.id, user_id)
    return {"ok": True}



@router.get("/search", response_model=PublicUserResponse)
async def search_users(
    email: EmailStr = Query(..., description="Exact email to look up"),
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    user = await repo_users.search_public_library_user(session, str(email), current_user.id)
    if user is None:
        raise HTTPException(404, "No public library found for that email.")
    return PublicUserResponse(
        id=str(user.id),
        email=user.email,
        is_library_public=bool(user.is_library_public),
    )


async def require_shared_owner(session, user_id, caller_id):
    owner = await repo_users.get_user_by_id(session, user_id)
    if user_id == caller_id or owner is None or not bool(owner.is_library_public) or owner.library_sharing_suspended or await repo_content_safety.relationship_blocked(session, caller_id, user_id):
        raise HTTPException(404, "Library not found.")


@router.get("/{user_id}/recipes/page", response_model=RecipePage)
async def friend_library_page(user_id: uuid.UUID, query: RecipePageQuery = Depends(),
                              session: AsyncSession = Depends(get_session),
                              current_user: UserModel = Depends(get_current_user)):
    await require_shared_owner(session, user_id, current_user.id)
    return await read_page(session, current_user.id, query, owner_id=user_id)


class SharedRecipeDetail(Recipe):
    already_saved: bool = False


@router.get("/{user_id}/recipes/{recipe_id}", response_model=SharedRecipeDetail)
async def friend_recipe_detail(user_id: uuid.UUID, recipe_id: str,
                               session: AsyncSession = Depends(get_session),
                               current_user: UserModel = Depends(get_current_user)):
    await require_shared_owner(session, user_id, current_user.id)
    row = await repo_users.get_friend_library_recipe(session, user_id, recipe_id)
    recipe = _row_to_shared_recipe(row) if row is not None and is_shareable_recipe(row) else None
    if recipe is None:
        raise HTTPException(404, "Recipe not found.")
    saved = await session.execute(select(RecipeModel.id).where(
        RecipeModel.user_id == current_user.id,
        RecipeModel.is_library_hidden.is_(False),
        or_(RecipeModel.id == recipe_id, RecipeModel.catalog_source_recipe_id == recipe_id),
    ).limit(1))
    return SharedRecipeDetail(**recipe.model_copy(update={"raw_extraction_text": None}).model_dump(), already_saved=saved.scalar_one_or_none() is not None)


@router.get("/{user_id}/recipes", response_model=list[Recipe], deprecated=True)
async def friend_library_recipes(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    if user_id == current_user.id:
        raise HTTPException(404, "Library not found.")
    owner = await repo_users.get_user_by_id(session, user_id)
    if owner is None or not bool(owner.is_library_public) or owner.library_sharing_suspended or await repo_content_safety.relationship_blocked(session, current_user.id, user_id):
        raise HTTPException(404, "Library not found.")
    rows = await repo_users.list_friend_library_recipes(session, user_id)
    return [_row_to_shared_recipe(r) for r in rows if is_shareable_recipe(r)]


@router.post("/{user_id}/recipes/{recipe_id}/copy", response_model=Recipe)
async def copy_friend_recipe(
    user_id: uuid.UUID,
    recipe_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
    request: Request = None,
):
    created: list[bool] = []
    clone = await repo_users.copy_friend_recipe_to_user(
        session, user_id, recipe_id, current_user.id, created_outcome=created
    )
    if clone is None:
        raise HTTPException(404, "Recipe not available for copy.")
    if request is not None:
        request.state.analytics_skip = not bool(created)
    return _row_to_recipe(clone)
