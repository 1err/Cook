"""Opt-in full-menu admission races using real PostgreSQL and fixture image bytes."""
import asyncio
import base64
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from fastapi import Depends, FastAPI
import httpx
import pytest
from sqlalchemy import select

from test_postgres_integrations import pg_sessions, add_user


@pytest.mark.asyncio
@pytest.mark.parametrize('same_id', [False, True])
async def test_full_menu_parallel_requests_admit_one_menu_and_provider_call(pg_sessions, monkeypatch, tmp_path, same_id):
    from app.api import routes_menu_artwork
    from app.api.auth import get_current_user
    from app.core.config import settings
    from app.db import session as db
    from app.db.models import UserModel, RecipeModel, MenuCreationModel, RecipeImageGenerationModel, AIUsageCounterModel
    from app.db.ai_cost_models import AICallLedgerModel, AIInflightLeaseModel
    from app.db.repo_menu_creations import creation_scope
    from app.db.session import get_session
    from app.services import menu_artwork_service

    owner, shared_id, recipe_id = await add_user(pg_sessions), uuid4(), str(uuid4())
    async with pg_sessions.begin() as session:
        session.add(RecipeModel(id=recipe_id, user_id=owner, title='番茄炒蛋', ingredients='[]'))
    for name, value in {
        'OPENAI_API_KEY': 'fixture-only', 'OPENAI_IMAGE_MODEL': 'gpt-image-2',
        'AI_IMAGE_GENERATION_ENABLED': True, 'AI_IMAGE_ACCESS_MODE': 'registered',
        'AI_MONTHLY_BUDGET_USD': Decimal('29'), 'AI_ACCOUNT_MONTHLY_BUDGET_USD': Decimal('3'),
        'LOCAL_IMAGE_UPLOAD_DIR': str(tmp_path), 'AWS_REGION': '', 'S3_BUCKET_NAME': '',
        'AI_IMAGE_GLOBAL_REQUESTS_PER_MINUTE': 1000, 'AI_IMAGE_GLOBAL_REQUESTS_PER_DAY': 1000,
        'AI_IMAGE_USER_REQUESTS_PER_MINUTE': 1000, 'AI_IMAGE_USER_REQUESTS_PER_DAY': 1000,
    }.items():
        monkeypatch.setattr(settings, name, value)
    monkeypatch.setattr(db, 'async_session_maker', pg_sessions)
    calls = []
    async def generate(**options):
        calls.append(options)
        # Observe the transaction from a new connection, as an external provider
        # would: creation, image request and reservation are already committed.
        async with pg_sessions() as session:
            assert len((await session.execute(select(MenuCreationModel).where(MenuCreationModel.user_id == owner))).scalars().all()) == 1
            assert len((await session.execute(select(RecipeImageGenerationModel).where(RecipeImageGenerationModel.user_id == owner))).scalars().all()) == 1
            lease = (await session.execute(select(AIInflightLeaseModel).where(AIInflightLeaseModel.account_id == str(owner)))).scalars().one()
            assert lease is not None
        await asyncio.sleep(.03)
        return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode())],
                               usage={'input_tokens': 400, 'output_tokens': 300}, _request_id='fixture-full-menu')
    monkeypatch.setattr(menu_artwork_service, 'get_openai_client', lambda: SimpleNamespace(images=SimpleNamespace(generate=generate)))
    app = FastAPI(); app.include_router(routes_menu_artwork.router)
    async def session_dependency():
        async with pg_sessions() as session:
            yield session
    async def user_dependency(session=Depends(get_session)):
        return await session.get(UserModel, owner)
    app.dependency_overrides[get_session] = session_dependency
    app.dependency_overrides[get_current_user] = user_dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://api') as client:
        responses = await asyncio.gather(*(client.post('/menus/artwork', json={
            'request_id': str(shared_id if same_id else uuid4()), 'mode': 'full-menu-v1',
            'recipes': [{'recipe_id': recipe_id, 'name': '番茄炒蛋'}],
        }) for _ in range(8)))
    if same_id:
        assert all(response.status_code in {200, 202} for response in responses)
    else:
        assert sum(response.status_code == 200 for response in responses) == 1
        assert sum(response.status_code == 429 and response.json()['detail']['code'] == 'menu_daily_limit'
                   for response in responses) == 7
    assert len(calls) == 1
    async with pg_sessions() as session:
        rows = (await session.execute(select(RecipeImageGenerationModel).where(RecipeImageGenerationModel.user_id == owner))).scalars().all()
        assert len(rows) == 1 and rows[0].status == 'completed'
        assert (rows[0].deadline_at - rows[0].created_at).total_seconds() == 255
        counter = (await session.execute(select(AIUsageCounterModel).where(AIUsageCounterModel.scope == creation_scope(owner)))).scalar_one()
        assert counter.request_count == 1
        ledgers = (await session.execute(select(AICallLedgerModel).where(AICallLedgerModel.account_id == str(owner)))).scalars().all()
        assert len(ledgers) == 1 and ledgers[0].status == 'completed' and ledgers[0].operation == 'menu_artwork'
        assert not (await session.execute(select(AIInflightLeaseModel).where(AIInflightLeaseModel.account_id == str(owner)))).scalars().all()
