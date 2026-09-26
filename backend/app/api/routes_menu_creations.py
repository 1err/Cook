"""Authenticate and admit a menu session before local editing or export."""
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db.models import UserModel
from app.db import repo_menu_creations
from app.db.session import get_session

router = APIRouter(prefix="/menus", tags=["menus"])
logger = logging.getLogger(__name__)


class MenuAccessResponse(BaseModel):
    allowed: bool
    is_admin: bool
    daily_limit: int | None
    remaining: int | None
    resets_at: datetime


class MenuCreationBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID


class MenuCreationResponse(BaseModel):
    request_id: UUID
    created_at: datetime


def unavailable() -> HTTPException:
    return HTTPException(503, {"code": "menu_unavailable", "message": "Menus are temporarily unavailable. Please try again."},
                         headers={"Cache-Control": "no-store", "Retry-After": "30"})


@router.get("/access", response_model=MenuAccessResponse)
async def menu_access(response: Response, session: AsyncSession = Depends(get_session),
                      user: UserModel = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    try:
        result = await repo_menu_creations.menu_access(session, user.id)
        await session.close()
        return result
    except SQLAlchemyError:
        await session.rollback()
        logger.warning("menu_access_database_unavailable")
        raise unavailable() from None


@router.post("/creations", response_model=MenuCreationResponse)
async def create_menu(body: MenuCreationBody, response: Response,
                      session: AsyncSession = Depends(get_session), user: UserModel = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    try:
        row = await repo_menu_creations.create_menu(session, user.id, body.request_id)
        result = MenuCreationResponse(request_id=row.request_id, created_at=row.created_at)
        await session.commit()
        await session.close()
        return result
    except repo_menu_creations.MenuDailyLimitExceeded as exc:
        await session.rollback()
        raise HTTPException(429, {"code": "menu_daily_limit", "message": str(exc)},
                            headers={"Cache-Control": "no-store", "Retry-After": str(exc.retry_after)}) from None
    except SQLAlchemyError:
        await session.rollback()
        logger.warning("menu_creation_database_unavailable")
        raise unavailable() from None
