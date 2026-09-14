"""External work must not retain an authenticated request's SQL connection."""
from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import QueuePool

from app.api import ai_budget, auth, routes_instacart, routes_recipes, routes_shopping
from app.db.models import AIUsageCounterModel, RecipeModel, UserModel
from app.db.repo_ai_usage import counter_statement
from app.db.session import get_session
from app.models import Recipe
from app.video_import import VideoTextResult


USER_ID = UUID("10000000-0000-0000-0000-00000000000b")


class SqlSession:
    """Async interface over real local ORM transactions and connection pooling."""

    def __init__(self, session):
        self.sync = session

    async def execute(self, statement):
        return self.sync.execute(statement)

    async def commit(self):
        self.sync.commit()

    async def rollback(self):
        self.sync.rollback()

    async def close(self):
        self.sync.close()


@pytest.fixture
def boundary_app(monkeypatch, tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'boundaries.db'}", poolclass=QueuePool,
        connect_args={"check_same_thread": False},
    )
    for model in (UserModel, RecipeModel, AIUsageCounterModel):
        model.__table__.create(engine)
    with Session(engine) as setup:
        setup.add(UserModel(id=USER_ID, email="boundary@example.com"))
        setup.add(RecipeModel(
            id="owned-recipe", user_id=USER_ID, title="Soup", ingredients="[]",
            total_time_minutes=10,
        ))
        setup.commit()

    app = FastAPI()
    for router in (routes_recipes.router, routes_instacart.router, routes_shopping.router):
        app.include_router(router)
    sessions = []

    async def local_session():
        with Session(engine, expire_on_commit=False, autoflush=False) as sync:
            session = SqlSession(sync)
            sessions.append(session)
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_session] = local_session
    monkeypatch.setattr(auth, "decode_access_token", lambda token: {"sub": str(USER_ID)})
    monkeypatch.setattr(ai_budget, "is_llm_enabled", lambda: False)

    def assert_released():
        assert sessions, "authentication must run a real SQL read"
        assert not sessions[-1].sync.in_transaction(), "provider entered with an open SQL transaction"
        assert engine.pool.checkedout() == 0, "provider retained a checked-out SQL connection"

    yield SimpleNamespace(app=app, assert_released=assert_released, engine=engine)
    engine.dispose()


def client_for(boundary):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=boundary.app), base_url="http://api",
        headers={"Authorization": "Bearer synthetic-test-token"},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("paid_ai", [False, True])
async def test_tutorial_releases_owned_recipe_read_before_estimation(monkeypatch, boundary_app, paid_ai):
    monkeypatch.setattr(ai_budget, "is_llm_enabled", lambda: paid_ai)

    async def reserve(session, account_id):
        await session.execute(counter_statement(f"user:{account_id}", 60, 120, 10))

    async def estimate(steps):
        boundary_app.assert_released()
        return steps

    monkeypatch.setattr(ai_budget, "reserve_ai_budget", reserve)
    monkeypatch.setattr(routes_recipes, "estimate_tutorial_step_metadata", estimate)
    async with client_for(boundary_app) as client:
        response = await client.post("/recipes/owned-recipe/tutorial/estimate", json={"steps": ["Simmer broth"]})
    assert response.status_code == 200
    assert response.json()["steps"][0]["text"] == "Simmer broth"
    with Session(boundary_app.engine) as verify:
        assert verify.get(RecipeModel, "owned-recipe").title == "Soup"
        counters = verify.execute(select(AIUsageCounterModel)).scalars().all()
        assert len(counters) == int(paid_ai)


@pytest.mark.asyncio
@pytest.mark.parametrize("s3", [False, True])
async def test_image_storage_releases_auth_read_before_storage(monkeypatch, boundary_app, s3):
    monkeypatch.setattr(routes_recipes.settings, "AWS_REGION", "test-region" if s3 else "")
    monkeypatch.setattr(routes_recipes.settings, "S3_BUCKET_NAME", "test-bucket" if s3 else "")
    data = b"\x89PNG\r\n\x1a\nsynthetic-image"

    def save(content, content_type, *owner):
        boundary_app.assert_released()
        assert content == data and content_type == "image/png"
        if s3:
            assert owner == (str(USER_ID),)
            return "https://images.example.test/recipe.png"
        return "/uploads/recipe.png"

    monkeypatch.setattr(routes_recipes, "save_recipe_image_s3" if s3 else "save_recipe_image_local", save)
    async with client_for(boundary_app) as client:
        response = await client.post("/recipes/upload-image", files={"file": ("recipe.png", data, "image/png")})
    assert response.status_code == 200
    assert response.json()["file_url"].endswith("/recipe.png")


@pytest.mark.asyncio
async def test_instacart_releases_auth_read_before_provider(monkeypatch, boundary_app):
    async def create(body):
        boundary_app.assert_released()
        assert body.items[0].quantity == "1 cup"
        return "https://www.instacart.com/store/recipes/123"

    monkeypatch.setattr(routes_instacart.instacart_service, "create_shopping_link", create)
    async with client_for(boundary_app) as client:
        response = await client.post("/shopping-list/instacart", json={
            "title": "Groceries", "items": [{"name": "rice", "quantity": "1 cup"}],
        })
    assert response.status_code == 200
    assert response.json() == {"url": "https://www.instacart.com/store/recipes/123"}


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["link", "transcript", "refine"])
async def test_keyless_admission_releases_auth_before_stateless_work(monkeypatch, boundary_app, operation):
    async def fetch(source):
        boundary_app.assert_released()
        return VideoTextResult(status="ok", text="Simmer the broth.", source=source)

    async def extract(text):
        boundary_app.assert_released()
        return Recipe(id="draft", title="Soup", ingredients=[], steps=["Simmer the broth."])

    async def refine(items):
        boundary_app.assert_released()
        return {"purchase_items": [{"name": "rice", "suggested_purchase": "1 cup"}]}

    monkeypatch.setattr(routes_recipes, "fetch_video_text", fetch)
    monkeypatch.setattr(routes_recipes, "extract_recipe_from_text", extract)
    monkeypatch.setattr(routes_shopping, "refine_shopping_list", refine)
    requests = {
        "link": ("/recipes/parse/link", {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}),
        "transcript": ("/recipes/parse/transcript", {"transcript": "Simmer broth"}),
        "refine": ("/shopping-list/refine", {"items": [{"name": "rice", "quantity": "1 cup"}]}),
    }
    path, body = requests[operation]
    async with client_for(boundary_app) as client:
        response = await client.post(path, json=body)
    assert response.status_code == 200
