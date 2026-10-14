"""Exercise durable generation against a real SQL store and mocked provider HTTP."""
import base64
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from openai import AsyncOpenAI
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session


def feature_modules():
    assert importlib.util.find_spec("app.api.routes_recipe_images") is not None, "Image generation routes are missing"
    from app.api import routes_recipe_images as routes
    from app.db import repo_recipe_images as repo
    from app.services import recipe_image_service as service
    return routes, repo, service


@pytest.fixture
def image_app(monkeypatch, tmp_path):
    routes, repo, service = feature_modules()
    from app.api.auth import get_current_user
    from app.core.config import settings
    from app.db.models import AIUsageCounterModel, FeatureEntitlementModel, RecipeImageGenerationModel, UserModel
    from app.db.ai_cost_models import AICallLedgerModel, AIMonthlyBudgetModel, AIInflightLeaseModel
    from app.db.upload_budget_models import UploadBudgetModel
    from app.db import repo_ai_cost
    from app.db.repo_upload_budget import reserve_storage
    from app.db.session import get_session

    engine = create_engine("sqlite://")
    for model in (UserModel, AIUsageCounterModel, FeatureEntitlementModel, RecipeImageGenerationModel,
                  AICallLedgerModel, AIMonthlyBudgetModel, AIInflightLeaseModel, UploadBudgetModel):
        model.__table__.create(engine)
    from readiness_schema import create_readiness_schema
    create_readiness_schema(engine, tombstones_only=True)
    database = Session(engine, expire_on_commit=False)
    user_id = uuid4()
    database.add(UserModel(id=user_id, email="image-test@example.com"))
    database.commit()

    class AsyncSessionAdapter:
        def get_bind(self):
            return database.get_bind()

        def add(self, value):
            database.add(value)

        async def execute(self, statement):
            return database.execute(statement)

        async def commit(self):
            database.commit()

        async def rollback(self):
            database.rollback()

        async def close(self):
            database.close()

    now = [datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)]
    async def database_now(_session):
        return now[0]
    monkeypatch.setattr(repo, "database_now", database_now)
    monkeypatch.setattr(repo_ai_cost, 'db_now', database_now)
    async def acquire_lease(*args, **kwargs):
        pass  # Advisory-lock races run separately against actual PostgreSQL.
    monkeypatch.setattr(repo_ai_cost, 'acquire_lease', acquire_lease)
    async def finish_call(call_id, **usage):
        await repo_ai_cost.reconcile_call(AsyncSessionAdapter(), call_id, **usage)
        database.commit()
    monkeypatch.setattr(service, 'finish_provider_call', finish_call)
    async def cleanup(request_id):
        await repo_ai_cost.release_lease(AsyncSessionAdapter(), request_id)
        database.commit()
    monkeypatch.setattr(routes, 'cleanup_lease', cleanup)
    async def storage_budget(account, size):
        await reserve_storage(AsyncSessionAdapter(), account, size,
            global_count=settings.UPLOAD_GLOBAL_TOTAL_COUNT, account_count=settings.UPLOAD_ACCOUNT_TOTAL_COUNT,
            global_bytes=settings.UPLOAD_GLOBAL_TOTAL_BYTES, account_bytes=settings.UPLOAD_ACCOUNT_TOTAL_BYTES)
        database.commit()
    monkeypatch.setattr(routes, 'reserve_upload_allowance', storage_budget)
    async def owned_image(account, auth_version, content_type, base, *, namespace="recipes"):
        assert account == user_id and auth_version == 1
        key = f'{namespace}/{account}/{uuid4().hex}.png'
        return {'id': uuid4(), 'object_key': key, 'file_url': f'{base.rstrip("/")}/uploads/{key}', 'storage_kind': 'local'}
    monkeypatch.setattr(routes, 'reserve_owned_image', owned_image)
    async def finish_image(image_id):
        pass
    monkeypatch.setattr(routes, 'finish_owned_upload', finish_image)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-only-key")
    monkeypatch.setattr(settings, "AI_IMAGE_GENERATION_ENABLED", True)
    monkeypatch.setattr(settings, "AI_IMAGE_ACCESS_MODE", "registered")
    monkeypatch.setattr(settings, "AI_IMAGE_USER_REQUESTS_PER_MINUTE", 1)
    monkeypatch.setattr(settings, "AI_IMAGE_USER_REQUESTS_PER_DAY", 3)
    monkeypatch.setattr(settings, "AI_IMAGE_GLOBAL_REQUESTS_PER_MINUTE", 10)
    monkeypatch.setattr(settings, "AI_IMAGE_GLOBAL_REQUESTS_PER_DAY", 100)
    monkeypatch.setattr(settings, "AI_MONTHLY_BUDGET_USD", Decimal('29'))
    monkeypatch.setattr(settings, "AI_ACCOUNT_MONTHLY_BUDGET_USD", Decimal('3'))
    monkeypatch.setattr(settings, "AWS_REGION", "")
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "")
    monkeypatch.setattr(settings, "LOCAL_IMAGE_UPLOAD_DIR", str(tmp_path))
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=user_id, auth_version=1)
    app.dependency_overrides[get_session] = lambda: AsyncSessionAdapter()
    context = SimpleNamespace(app=app, database=database, user_id=user_id, now=now,
                              routes=routes, repo=repo, service=service, directory=tmp_path, session=AsyncSessionAdapter())
    yield context
    database.close()
    engine.dispose()


def payload(**overrides):
    return {"request_id": str(uuid4()), "title": "豆腐茄子煲", "ingredients": ["Tofu", "Eggplant"],
            "steps": ["Simmer together."], **overrides}


def client_for(context):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=context.app), base_url="http://api")


async def install_provider(monkeypatch, service, *, content=None, status=200):
    calls = []
    def respond(request):
        calls.append(json.loads(request.content))
        return httpx.Response(status, json=content if content is not None else {
            "created": 1, "data": [{"b64_json": base64.b64encode(b"\x89PNG\r\n\x1a\nfixture").decode()}],
            "usage": {"input_tokens": 100, "output_tokens": 196, "total_tokens": 296},
        })
    provider = AsyncOpenAI(api_key="test-only-key", max_retries=0,
                           http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    monkeypatch.setattr(service, "get_openai_client", lambda: provider)
    return provider, calls


@pytest.mark.asyncio
async def test_generation_uses_draft_and_stored_png_and_replays_without_spending(image_app, monkeypatch):
    from app.db.models import AIUsageCounterModel
    provider, calls = await install_provider(monkeypatch, image_app.service)
    body = payload()
    async with provider, client_for(image_app) as client:
        first = await client.post("/recipes/generate-image", json=body)
        replay = await client.post("/recipes/generate-image", json=body)
        recovered = await client.get(f"/recipes/image-generation/{body['request_id']}")
    assert first.status_code == replay.status_code == recovered.status_code == 200
    assert first.json() == replay.json() == recovered.json()
    assert first.json()["status"] == "completed"
    assert first.json()["file_url"].startswith("http://api/uploads/recipes/")
    assert len(list(image_app.directory.rglob("*.png"))) == 1
    assert len(calls) == 1
    assert calls[0]["model"] == "gpt-image-2"
    assert calls[0]["quality"] == "low"
    assert calls[0]["size"] == "1024x1024"
    assert calls[0]["n"] == 1
    assert "豆腐茄子煲" in calls[0]["prompt"]
    counters = image_app.database.scalars(select(AIUsageCounterModel)).all()
    assert len(counters) == 4
    assert all(row.request_count == 1 for row in counters)


@pytest.mark.asyncio
async def test_request_id_conflict_cannot_generate_again(image_app, monkeypatch):
    provider, calls = await install_provider(monkeypatch, image_app.service)
    body = payload()
    async with provider, client_for(image_app) as client:
        await client.post("/recipes/generate-image", json=body)
        conflict = await client.post("/recipes/generate-image", json={**body, "title": "Different dish"})
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "request_conflict"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_daily_and_minute_limits_do_not_create_admitted_requests(image_app, monkeypatch):
    from app.db.models import RecipeImageGenerationModel
    provider, calls = await install_provider(monkeypatch, image_app.service)
    async with provider, client_for(image_app) as client:
        assert (await client.post("/recipes/generate-image", json=payload())).status_code == 200
        limited = await client.post("/recipes/generate-image", json=payload())
        assert limited.status_code == 429
        assert limited.json()["detail"]["code"] == "rate_limited"
        assert limited.headers["retry-after"] == "60"
        for _ in range(2):
            image_app.now[0] += timedelta(minutes=1)
            assert (await client.post("/recipes/generate-image", json=payload())).status_code == 200
        image_app.now[0] += timedelta(minutes=1)
        daily = await client.post("/recipes/generate-image", json=payload())
        access = await client.get("/recipes/image-generation/access")
    assert daily.status_code == 429
    assert daily.json()["detail"]["code"] == "daily_limit"
    assert access.json()["remaining"] == 0
    assert access.json()["allowed"] is False
    assert access.json()["reason"] == "daily_limit"
    assert len(calls) == 3
    assert len(image_app.database.scalars(select(RecipeImageGenerationModel)).all()) == 3


@pytest.mark.asyncio
async def test_members_mode_uses_active_server_entitlement(image_app, monkeypatch):
    from app.core.config import settings
    from app.db.models import FeatureEntitlementModel
    monkeypatch.setattr(settings, "AI_IMAGE_ACCESS_MODE", "members")
    provider, calls = await install_provider(monkeypatch, image_app.service)
    async with provider, client_for(image_app) as client:
        denied = await client.post("/recipes/generate-image", json=payload())
        assert denied.status_code == 403
        assert denied.json()["detail"]["code"] == "membership_required"
        image_app.database.add(FeatureEntitlementModel(user_id=image_app.user_id,
            feature_key="recipe_image_generation", expires_at=image_app.now[0] - timedelta(seconds=1)))
        image_app.database.commit()
        assert (await client.get("/recipes/image-generation/access")).json()["allowed"] is False
        image_app.database.execute(update(FeatureEntitlementModel).values(expires_at=None))
        image_app.database.commit()
        assert (await client.get("/recipes/image-generation/access")).json()["allowed"] is True
        assert (await client.post("/recipes/generate-image", json=payload())).status_code == 200
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_response", [
    {"created": 1, "data": [{"url": "http://127.0.0.1/private"}]},
    {"created": 1, "data": [{"b64_json": "not-valid-base64"}]},
    {"created": 1, "data": [{"b64_json": base64.b64encode(b"<html>private prompt</html>").decode()}]},
])
async def test_invalid_provider_images_fail_terminally_and_never_fetch_urls(image_app, monkeypatch, provider_response):
    provider, calls = await install_provider(monkeypatch, image_app.service, content=provider_response)
    body = payload()
    async with provider, client_for(image_app) as client:
        first = await client.post("/recipes/generate-image", json=body)
        replay = await client.post("/recipes/generate-image", json=body)
    assert first.json()["status"] == replay.json()["status"] == "failed"
    assert first.json()["file_url"] is None
    assert first.json()["error_code"] == "generation_failed"
    assert len(calls) == 1
    assert not list(image_app.directory.rglob("*.png"))
    assert "private" not in first.text


@pytest.mark.asyncio
async def test_pending_replay_and_stale_recovery_are_terminal(image_app):
    from app.db.models import RecipeImageGenerationModel
    body = payload()
    request = image_app.routes.GenerateRecipeImageBody(**body)
    image_app.database.add(RecipeImageGenerationModel(user_id=image_app.user_id,
        request_id=request.request_id, request_hash=image_app.repo.request_hash(request.model_dump(mode="json", exclude={"request_id"})),
        status="pending", created_at=image_app.now[0], deadline_at=image_app.now[0] + timedelta(seconds=120)))
    image_app.database.commit()
    async with client_for(image_app) as client:
        pending = await client.post("/recipes/generate-image", json=body)
        assert pending.status_code == 202
        assert pending.json()["status"] == "pending"
        image_app.now[0] += timedelta(seconds=121)
        stale = await client.get(f"/recipes/image-generation/{body['request_id']}")
        replay = await client.post("/recipes/generate-image", json=body)
    assert stale.json()["status"] == replay.json()["status"] == "failed"
    assert stale.json()["error_code"] == "generation_interrupted"


@pytest.mark.asyncio
async def test_result_lookup_is_scoped_to_account(image_app):
    from app.db.models import RecipeImageGenerationModel, UserModel
    another_user = uuid4()
    request_id = uuid4()
    image_app.database.add(UserModel(id=another_user, email="another-account@example.com"))
    image_app.database.add(RecipeImageGenerationModel(user_id=another_user, request_id=request_id,
        request_hash="a" * 64, status="completed", file_url="https://test.invalid/another-account.png",
        created_at=image_app.now[0], deadline_at=image_app.now[0] + timedelta(seconds=120)))
    image_app.database.commit()
    async with client_for(image_app) as client:
        response = await client.get(f"/recipes/image-generation/{request_id}")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_recipe_status_route_hides_menu_artwork_requests(image_app):
    """Breaks if the legacy recipe status route leaks a menu-artwork candidate."""
    from app.db.models import RecipeImageGenerationModel

    request_id = uuid4()
    image_app.database.add(RecipeImageGenerationModel(
        user_id=image_app.user_id,
        request_id=request_id,
        request_hash="a" * 64,
        purpose="menu_artwork",
        status="completed",
        file_url="https://test.invalid/menu.png",
        storage_kind="s3",
        storage_key=f"menu-artwork/{image_app.user_id}/candidate.png",
        created_at=image_app.now[0],
        deadline_at=image_app.now[0] + timedelta(seconds=120),
    ))
    image_app.database.commit()

    async with client_for(image_app) as client:
        response = await client.get(f"/recipes/image-generation/{request_id}")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_no_database_connection_during_provider_or_storage(image_app, monkeypatch):
    events = []
    async def generate(recipe, *, ledger_call_id):
        assert not image_app.database.in_transaction()
        events.append("provider")
        return b"\x89PNG\r\n\x1a\nfixture"
    def save(data, content_type, object_key=None):
        assert not image_app.database.in_transaction()
        events.append("storage")
        return "/uploads/recipes/checked.png"
    monkeypatch.setattr(image_app.routes, "generate_recipe_image", generate)
    monkeypatch.setattr(image_app.routes, "save_recipe_image_local", save)
    async with client_for(image_app) as client:
        response = await client.post("/recipes/generate-image", json=payload())
    assert response.json()["status"] == "completed"
    assert events == ["provider", "storage"]


@pytest.mark.asyncio
async def test_provider_error_is_sanitized_and_not_retried(image_app, monkeypatch, caplog):
    provider, calls = await install_provider(monkeypatch, image_app.service, status=500, content={
        "error": {"message": "private prompt secret sk-secret", "type": "server_error", "code": "server_error"}})
    body = payload()
    async with provider, client_for(image_app) as client:
        first = await client.post("/recipes/generate-image", json=body)
        replay = await client.post("/recipes/generate-image", json=body)
    assert first.json()["status"] == replay.json()["status"] == "failed"
    assert len(calls) == 1
    assert "private prompt" not in first.text + caplog.text
    assert "sk-secret" not in first.text + caplog.text


@pytest.mark.asyncio
async def test_storage_failure_consumes_request_but_preserves_safe_error(image_app, monkeypatch, caplog):
    provider, calls = await install_provider(monkeypatch, image_app.service)
    def unavailable_storage(*args):
        raise RuntimeError("private storage credential")
    monkeypatch.setattr(image_app.routes, "save_recipe_image_local", unavailable_storage)
    body = payload()
    async with provider, client_for(image_app) as client:
        first = await client.post("/recipes/generate-image", json=body)
        replay = await client.post("/recipes/generate-image", json=body)
    assert first.json()["status"] == replay.json()["status"] == "failed"
    assert first.json()["error_code"] == "storage_failed"
    assert len(calls) == 1
    assert "private storage" not in first.text + caplog.text


@pytest.mark.asyncio
async def test_oversized_provider_output_is_not_stored(image_app, monkeypatch):
    monkeypatch.setattr(image_app.service, "MAX_IMAGE_BYTES", 12)
    provider, calls = await install_provider(monkeypatch, image_app.service)
    async with provider, client_for(image_app) as client:
        result = await client.post("/recipes/generate-image", json=payload())
    assert result.json()["status"] == "failed"
    assert result.json()["error_code"] == "generation_failed"
    assert not list(image_app.directory.rglob("*.png"))


@pytest.mark.asyncio
@pytest.mark.parametrize("configuration,expected", [
    ({"AI_IMAGE_GENERATION_ENABLED": False}, "disabled"),
    ({"OPENAI_API_KEY": ""}, "unavailable"),
])
async def test_disabled_or_unconfigured_generator_never_admits(image_app, monkeypatch, configuration, expected):
    from app.core.config import settings
    from app.db.models import AIUsageCounterModel, RecipeImageGenerationModel
    for key, value in configuration.items():
        monkeypatch.setattr(settings, key, value)
    async with client_for(image_app) as client:
        access = await client.get("/recipes/image-generation/access")
        denied = await client.post("/recipes/generate-image", json=payload())
    assert access.json()["enabled"] is False
    assert access.json()["reason"] == expected
    assert denied.status_code == 503
    assert denied.json()["detail"]["code"] == expected
    assert not image_app.database.scalars(select(RecipeImageGenerationModel)).all()
    assert not image_app.database.scalars(select(AIUsageCounterModel)).all()


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [
    {"title": " "}, {"title": "t" * 513}, {"description": "d" * 2001},
    {"ingredients": ["item"] * 41}, {"ingredients": ["x" * 101]},
    {"steps": ["step"] * 13}, {"steps": ["s" * 301]},
    {"model": "unrestricted-expensive-model"}, {"is_paid": True},
])
async def test_unbounded_inputs_and_client_privilege_claims_are_rejected(image_app, changes):
    from app.db.models import RecipeImageGenerationModel
    async with client_for(image_app) as client:
        response = await client.post("/recipes/generate-image", json=payload(**changes))
    assert response.status_code == 422
    assert not image_app.database.scalars(select(RecipeImageGenerationModel)).all()


@pytest.mark.asyncio
async def test_image_routes_require_authentication(image_app):
    from app.api.auth import get_current_user
    image_app.app.dependency_overrides.pop(get_current_user)
    async with client_for(image_app) as client:
        assert (await client.get("/recipes/image-generation/access")).status_code == 401
        assert (await client.get(f"/recipes/image-generation/{uuid4()}")).status_code == 401
        assert (await client.post("/recipes/generate-image", json=payload())).status_code == 401


@pytest.mark.asyncio
async def test_provider_timeout_is_bounded_terminal_and_sanitized(image_app, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "OPENAI_IMAGE_TIMEOUT_SECONDS", 1)
    calls = []
    async def timeout(request):
        calls.append(request)
        raise httpx.ReadTimeout("private provider details", request=request)
    provider = AsyncOpenAI(api_key="test-only-key", max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(timeout)))
    monkeypatch.setattr(image_app.service, "get_openai_client", lambda: provider)
    body = payload()
    async with provider, client_for(image_app) as client:
        first = await client.post("/recipes/generate-image", json=body)
        replay = await client.post("/recipes/generate-image", json=body)
    assert first.json()["status"] == replay.json()["status"] == "failed"
    assert first.json()["error_code"] == "generation_timeout"
    assert len(calls) == 1
    assert "private provider" not in first.text
