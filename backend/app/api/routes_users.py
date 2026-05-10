"""Friend library sharing routes.

GET  /users/search?email=...                            — find a user by email if their library is public
GET  /users/{user_id}/recipes                           — list a user's recipes if their library is public
POST /users/{user_id}/recipes/{recipe_id}/copy          — clone into the caller's library
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db import repo_users
from app.db.models import UserModel
from app.db.session import get_session


router = APIRouter(prefix="/users", tags=["users"])


class PublicUserResponse(BaseModel):
    id: str
    email: str
    is_library_public: bool


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
