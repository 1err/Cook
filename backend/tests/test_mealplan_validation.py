from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI

from app.api import routes_mealplan
from app.models import MealPlan


@pytest.fixture
def planner_app(monkeypatch):
    app = FastAPI()
    app.include_router(routes_mealplan.router)
    app.dependency_overrides[routes_mealplan.get_session] = lambda: object()
    app.dependency_overrides[routes_mealplan.get_current_user] = lambda: SimpleNamespace(id=UUID(int=9))

    async def put(session, date, slots, user_id):
        return MealPlan(id=date, date=date, **slots)

    async def read(session, start, end, user_id):
        return []

    monkeypatch.setattr(routes_mealplan.repo_mealplan, "put_meal_plan", put)
    monkeypatch.setattr(routes_mealplan.repo_mealplan, "get_meal_plans_in_range", read)
    return app


@pytest.mark.asyncio
async def test_legacy_recipe_ids_are_kept_in_dinner_slot(planner_app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=planner_app), base_url="http://test") as client:
        response = await client.put("/meal-plan/2026-09-14", json={"recipe_ids": ["recipe-1"]})
    assert response.status_code == 200
    assert response.json()["dinner"] == ["recipe-1"]


@pytest.mark.asyncio
async def test_explicit_slots_take_precedence_over_legacy_ids(planner_app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=planner_app), base_url="http://test") as client:
        response = await client.put("/meal-plan/2026-09-14", json={"recipe_ids": ["old"], "breakfast": ["new"]})
    assert response.json()["breakfast"] == ["new"]
    assert response.json()["dinner"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("date", ["not-a-date", "2026-02-30", "2026-09-140000"])
async def test_invalid_planner_dates_fail_before_database_write(planner_app, date):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=planner_app), base_url="http://test") as client:
        response = await client.put(f"/meal-plan/{date}", json={"dinner": []})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_reversed_date_range_is_rejected(planner_app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=planner_app), base_url="http://test") as client:
        response = await client.get("/meal-plan", params={"start": "2026-09-15", "end": "2026-09-14"})
    assert response.status_code == 400
