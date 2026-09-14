"""Authenticated, stateless export of the user's selected grocery list."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db.models import UserModel
from app.db.session import get_session
from app.services import instacart_service

router = APIRouter(tags=["shopping"])


class InstacartItem(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    quantity: str = Field(default="", max_length=200)


class InstacartRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    items: list[InstacartItem] = Field(min_length=1, max_length=100)


class InstacartResponse(BaseModel):
    url: str


@router.post("/shopping-list/instacart", response_model=InstacartResponse)
async def create_instacart_link(
    body: InstacartRequest,
    _user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    # This stateless route only read the authenticated user before provider I/O.
    await session.close()
    try:
        url = await instacart_service.create_shopping_link(body)
    except instacart_service.InstacartError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from None
    return InstacartResponse(url=url)
