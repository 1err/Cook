"""One explicit AI design attempt within an already admitted menu session."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import ConfigDict, Field, field_validator
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.ai_budget import enforce_ai_budget
from app.api.auth import get_current_user
from app.core.config import settings
from app.core.llm import is_llm_enabled
from app.db.models import UserModel
from app.db.repo_menu_creations import find_creation
from app.db.session import get_session
from app.services.menu_design_service import (
    StrictModel, MenuDesign, MenuDesignContent, MenuDesignPreferences,
    MenuDesignUnavailable, generate_menu_design,
)

router = APIRouter(prefix="/menus", tags=["menus"])
# Reuse the complete budget/lease/context lifetime, including cancellation.
menu_design_budget = asynccontextmanager(enforce_ai_budget)


class GenerateMenuDesignBody(StrictModel):
    # UUID strings are the HTTP wire format; other design inputs remain strict.
    model_config = ConfigDict(extra="forbid", strict=False)
    menu_creation_id: UUID
    brief: str = Field(min_length=1, max_length=1200)
    preferences: MenuDesignPreferences = Field(default_factory=MenuDesignPreferences)
    content: MenuDesignContent

    @field_validator("brief")
    @classmethod
    def nonblank_brief(cls, value):
        if not value.strip():
            raise ValueError("Describe the visual style for this menu")
        return value.strip()


@router.post("/designs", response_model=MenuDesign)
async def create_menu_design(body: GenerateMenuDesignBody, response: Response,
                             session: AsyncSession = Depends(get_session),
                             user: UserModel = Depends(get_current_user)):
    user_id = user.id
    response.headers["Cache-Control"] = "no-store"
    try:
        async with asyncio.timeout(settings.AI_OPERATION_TIMEOUT_SECONDS):
            # Check owner before consuming any AI attempt; replaying a design does
            # not create a menu or alter the separate one-menu-per-day admission.
            if await find_creation(session, user_id, body.menu_creation_id) is None:
                raise HTTPException(404, {"code": "menu_not_found", "message": "This menu session is no longer available."},
                                    headers={"Cache-Control": "no-store"})
            await session.close()
            if not is_llm_enabled():
                raise MenuDesignUnavailable()
            async with menu_design_budget(session, SimpleNamespace(id=user_id)):
                return await generate_menu_design(body.brief, body.preferences, body.content)
    except MenuDesignUnavailable as exc:
        raise HTTPException(503, {"code": exc.code, "message": str(exc)},
                            headers={"Cache-Control": "no-store"}) from None
    except (TimeoutError, SQLAlchemyError):
        try:
            async with asyncio.timeout(5):
                await session.rollback()
        except Exception:
            pass
        raise HTTPException(503, {"code": "design_unavailable", "message": "We could not design this menu. Please try again."},
                            headers={"Cache-Control": "no-store"}) from None
