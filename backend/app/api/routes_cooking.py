"""Authenticated cooking-session routes."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.cooking import (
    CookingConflict,
    CookingDishesAdd,
    CookingSession,
    CookingSessionCreate,
    CookingStepActionBody,
)
from app.db import repo_cooking
from app.db.models import UserModel
from app.db.session import get_session


router = APIRouter(prefix="/cooking-session", tags=["cooking-session"])
_NOT_FOUND_CODES = frozenset(
    {"recipe_not_owned", "session_not_found", "dish_not_found", "step_not_found"}
)


def _raise_http_conflict(error: CookingConflict) -> None:
    status_code = 404 if error.code in _NOT_FOUND_CODES else 409
    raise HTTPException(
        status_code=status_code,
        detail={"code": error.code, "message": error.message},
    ) from error


@router.get("/active", response_model=CookingSession | None)
async def get_active_cooking_session(
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    return await repo_cooking.get_active_session(session, current_user.id)


@router.post("", response_model=CookingSession)
async def create_cooking_session(
    body: CookingSessionCreate,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    try:
        return await repo_cooking.create_session(session, current_user.id, body.recipe_ids)
    except CookingConflict as error:
        _raise_http_conflict(error)


@router.post("/{session_id}/dishes", response_model=CookingSession)
async def add_cooking_dishes(
    session_id: UUID,
    body: CookingDishesAdd,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    try:
        return await repo_cooking.add_dishes(
            session, current_user.id, session_id, body.recipe_ids
        )
    except CookingConflict as error:
        _raise_http_conflict(error)


@router.delete("/{session_id}/dishes/{dish_id}", response_model=CookingSession | None)
async def remove_cooking_dish(
    session_id: UUID,
    dish_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    try:
        return await repo_cooking.remove_dish(session, current_user.id, session_id, dish_id)
    except CookingConflict as error:
        _raise_http_conflict(error)


@router.post("/{session_id}/steps/{step_id}/actions", response_model=CookingSession)
async def apply_cooking_step_action(
    session_id: UUID,
    step_id: UUID,
    body: CookingStepActionBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    try:
        return await repo_cooking.apply_action(
            session, current_user.id, session_id, step_id, body
        )
    except CookingConflict as error:
        _raise_http_conflict(error)


@router.post("/{session_id}/finish")
async def finish_cooking_session(
    session_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    try:
        return await repo_cooking.finish_session(session, current_user.id, session_id)
    except CookingConflict as error:
        _raise_http_conflict(error)


@router.delete("/{session_id}")
async def discard_cooking_session(
    session_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    try:
        return await repo_cooking.discard_session(session, current_user.id, session_id)
    except CookingConflict as error:
        _raise_http_conflict(error)
