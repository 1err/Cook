from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.api import routes_cooking
from app.cooking import CookingConflict, CookingSessionCreate, CookingStepActionBody
from app.db.repo_cooking import _to_response
from tests.test_cooking_repository import (
    DISH_ID,
    MUTATION_ID,
    NOW,
    SESSION_ID,
    STEP_ID,
    USER_ID,
    active_model,
)


def user():
    return SimpleNamespace(id=USER_ID)


@pytest.mark.asyncio
async def test_create_route_scopes_recipe_ids_to_current_user(monkeypatch) -> None:
    expected = _to_response(active_model())
    create = AsyncMock(return_value=expected)
    monkeypatch.setattr(routes_cooking.repo_cooking, "create_session", create)
    db = SimpleNamespace()

    result = await routes_cooking.create_cooking_session(
        body=CookingSessionCreate(recipe_ids=["recipe-1"]),
        session=db,
        current_user=user(),
    )

    assert result == expected
    create.assert_awaited_once_with(db, USER_ID, ["recipe-1"])


@pytest.mark.asyncio
async def test_active_route_returns_null_without_a_session(monkeypatch) -> None:
    active = AsyncMock(return_value=None)
    monkeypatch.setattr(routes_cooking.repo_cooking, "get_active_session", active)

    result = await routes_cooking.get_active_cooking_session(
        session=SimpleNamespace(), current_user=user()
    )

    assert result is None


@pytest.mark.asyncio
async def test_action_route_passes_idempotency_and_revision_payload(monkeypatch) -> None:
    expected = _to_response(active_model())
    apply = AsyncMock(return_value=expected)
    monkeypatch.setattr(routes_cooking.repo_cooking, "apply_action", apply)
    body = CookingStepActionBody(
        action="complete",
        mutation_id=MUTATION_ID,
        device_id="device-a",
        occurred_at=NOW,
        expected_revision=1,
    )
    db = SimpleNamespace()

    result = await routes_cooking.apply_cooking_step_action(
        session_id=SESSION_ID,
        step_id=STEP_ID,
        body=body,
        session=db,
        current_user=user(),
    )

    assert result == expected
    apply.assert_awaited_once_with(db, USER_ID, SESSION_ID, STEP_ID, body)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("active_session_exists", 409),
        ("revision_conflict", 409),
        ("invalid_transition", 409),
        ("recipe_not_owned", 404),
        ("session_not_found", 404),
        ("dish_not_found", 404),
        ("step_not_found", 404),
    ],
)
async def test_conflicts_return_stable_private_error_shapes(
    monkeypatch, code: str, status: int
) -> None:
    create = AsyncMock(side_effect=CookingConflict(code, "Canonical message"))
    monkeypatch.setattr(routes_cooking.repo_cooking, "create_session", create)

    with pytest.raises(HTTPException) as exc_info:
        await routes_cooking.create_cooking_session(
            body=CookingSessionCreate(recipe_ids=["recipe-1"]),
            session=SimpleNamespace(),
            current_user=user(),
        )

    assert exc_info.value.status_code == status
    assert exc_info.value.detail == {"code": code, "message": "Canonical message"}


def test_router_exposes_the_complete_authenticated_surface() -> None:
    methods_by_path = {
        route.path: route.methods for route in routes_cooking.router.routes
    }

    assert methods_by_path == {
        "/cooking-session/active": {"GET"},
        "/cooking-session": {"POST"},
        "/cooking-session/{session_id}/dishes": {"POST"},
        "/cooking-session/{session_id}/dishes/{dish_id}": {"DELETE"},
        "/cooking-session/{session_id}/steps/{step_id}/actions": {"POST"},
        "/cooking-session/{session_id}/finish": {"POST"},
        "/cooking-session/{session_id}": {"DELETE"},
    }
