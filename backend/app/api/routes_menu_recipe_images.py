"""Authenticated export bytes for a caller's recipe and owned photo receipt."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.auth import get_current_user
from app.db.account_models import OwnedImageModel
from app.db.models import RecipeModel, UserModel
from app.db.session import get_session
from app.services.menu_recipe_images import MenuRecipeImageUnavailable, read_owned_recipe_image

router = APIRouter(prefix="/menus/recipe-images", tags=["menus"])


def unavailable(status=404):
    return HTTPException(status, {"code": "recipe_image_unavailable", "message": "This recipe photo is not available for menu export."},
                         headers={"Cache-Control": "no-store"})


@router.get("/{recipe_id}")
async def menu_recipe_image(recipe_id: str, session: AsyncSession = Depends(get_session),
                            user: UserModel = Depends(get_current_user)):
    user_id = user.id
    try:
        receipt = (await session.execute(select(OwnedImageModel).join(RecipeModel,
            RecipeModel.thumbnail_url == OwnedImageModel.file_url).where(
                RecipeModel.id == recipe_id, RecipeModel.user_id == user_id,
                OwnedImageModel.owner_id == user_id, OwnedImageModel.state == "active",
                OwnedImageModel.cleanup_requested.is_(False),
            ))).scalar_one_or_none()
        if receipt is None:
            raise unavailable()
        coordinates = {key: getattr(receipt, key) for key in ("storage_kind", "object_key", "bucket", "region")}
        await session.close()
    except SQLAlchemyError:
        await session.rollback()
        raise unavailable(503) from None
    try:
        content, content_type = await run_in_threadpool(read_owned_recipe_image, account_id=str(user_id), **coordinates)
    except MenuRecipeImageUnavailable as exc:
        raise unavailable(exc.status_code) from None
    return Response(content=content, media_type=content_type,
                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
