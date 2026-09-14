from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI

from app.api import routes_recipes
from app.models import Recipe


@pytest.fixture
def recipe_app(monkeypatch):
    app = FastAPI()
    app.include_router(routes_recipes.router)
    app.dependency_overrides[routes_recipes.get_session] = lambda: object()
    app.dependency_overrides[routes_recipes.get_current_user] = lambda: SimpleNamespace(id=UUID(int=9))

    async def save(session, recipe, user_id):
        return recipe

    async def read(*args):
        return Recipe(id="existing", title="Original recipe", ingredients=[])

    monkeypatch.setattr(routes_recipes.repo_recipes, "save_recipe", save)
    monkeypatch.setattr(routes_recipes.repo_recipes, "get_recipe", read)
    return app


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [
    ("id", "x" * 256), ("title", "x" * 1025), ("total_time_minutes", 2**31),
])
async def test_post_rejects_values_outside_database_storage_bounds(recipe_app, field, value):
    payload = {"id": "new", "title": "Valid", "ingredients": [], field: value}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=recipe_app), base_url="http://test") as client:
        response = await client.post("/recipes", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{"title": None}, {"ingredients": None}, {"title": "x" * 1025}])
async def test_invalid_patch_is_a_client_validation_error(recipe_app, payload):
    transport = httpx.ASGITransport(app=recipe_app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.patch("/recipes/existing", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_empty_patch_leaves_required_fields_unchanged(recipe_app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=recipe_app), base_url="http://test") as client:
        response = await client.patch("/recipes/existing", json={})
    assert response.status_code == 200
    assert response.json()["title"] == "Original recipe"


def test_legacy_response_models_remain_permissive():
    assert Recipe(id="legacy", title="", ingredients=[]).title == ""
