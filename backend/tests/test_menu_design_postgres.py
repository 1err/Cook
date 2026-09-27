"""Design and photo HTTP routes against real migrated ownership and AI accounting."""
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4
import json

from fastapi import Depends, FastAPI
import httpx
import pytest
from sqlalchemy import select

from test_postgres_integrations import pg_sessions, add_user
from test_menu_designs import DESIGN


@pytest.mark.asyncio
async def test_design_and_recipe_photo_real_postgres_contract(pg_sessions, monkeypatch, tmp_path):
    from app.api import routes_menu_designs, routes_menu_recipe_images
    from app.api.auth import get_current_user
    from app.core.config import settings
    from app.core import ai_context
    from app.db.models import UserModel, MenuCreationModel, RecipeModel, AIUsageCounterModel
    from app.db.ai_cost_models import AICallLedgerModel, AIInflightLeaseModel
    from app.db.account_models import OwnedImageModel
    from app.db.repo_menu_creations import create_menu, creation_scope
    from app.db.session import get_session
    from app.services import menu_design_service
    owner = await add_user(pg_sessions)
    creation_id, recipe_id = uuid4(), str(uuid4())
    key = f'recipes/{owner}/{uuid4().hex}.png'
    url = 'http://api/uploads/' + key
    async with pg_sessions.begin() as session:
        await create_menu(session, owner, creation_id)
        session.add(RecipeModel(id=recipe_id, user_id=owner, title='Do not send this private dish name', ingredients='[]', thumbnail_url=url))
        session.add(OwnedImageModel(owner_id=owner, storage_kind='local', bucket='', region='', object_key=key, file_url=url, state='active'))
    photo = tmp_path / key; photo.parent.mkdir(parents=True); photo.write_bytes(b'\x89PNG\r\n\x1a\nfixture')
    for name, value in {'OPENAI_API_KEY': 'fixture-only', 'OPENAI_MODEL': 'gpt-4o-mini', 'AI_PRICE_MODEL': 'gpt-4o-mini',
        'AI_PRICE_VERSION': 'test-reviewed', 'AI_INPUT_USD_PER_MILLION_TOKENS': Decimal('.15'),
        'AI_OUTPUT_USD_PER_MILLION_TOKENS': Decimal('.60'), 'AI_MONTHLY_BUDGET_USD': Decimal('29'),
        'AI_ACCOUNT_MONTHLY_BUDGET_USD': Decimal('3'), 'LOCAL_IMAGE_UPLOAD_DIR': str(tmp_path),
        'AI_GLOBAL_REQUESTS_PER_MINUTE': 1000, 'AI_GLOBAL_REQUESTS_PER_DAY': 1000}.items():
        monkeypatch.setattr(settings, name, value)
    monkeypatch.setattr(ai_context, 'session_factory', lambda: pg_sessions)
    calls = []
    async def generate(**options):
        assert pg_sessions.kw['bind'].pool.checkedout() == 0
        calls.append(options)
        assert 'Do not send this private dish name' not in json.dumps(options)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(DESIGN)), finish_reason='stop')],
            usage=SimpleNamespace(prompt_tokens=300, completion_tokens=250), _request_id='fixture-menu-design')
    monkeypatch.setattr(menu_design_service, 'get_openai_client', lambda: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=generate))))
    app = FastAPI(); app.include_router(routes_menu_designs.router); app.include_router(routes_menu_recipe_images.router)
    async def session_dependency():
        async with pg_sessions() as session:
            yield session
    async def user_dependency(session=Depends(get_session)):
        return await session.get(UserModel, owner)
    app.dependency_overrides[get_session] = session_dependency
    app.dependency_overrides[get_current_user] = user_dependency
    payload = {'menu_creation_id': str(creation_id), 'brief': 'A vibrant cafe', 'content': {'item_count': 8, 'section_count': 2, 'photo_count': 4, 'language': 'en'}}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://api') as client:
        for _ in range(2):
            response = await client.post('/menus/designs', json=payload)
            assert response.status_code == 200, response.text
        result = await client.get('/menus/recipe-images/' + recipe_id)
        assert result.status_code == 200 and result.content == photo.read_bytes()
    assert len(calls) == 2
    async with pg_sessions() as session:
        creations = (await session.execute(select(MenuCreationModel).where(MenuCreationModel.user_id == owner))).scalars().all()
        assert len(creations) == 1
        counter = (await session.execute(select(AIUsageCounterModel).where(AIUsageCounterModel.scope == creation_scope(owner)))).scalar_one()
        assert counter.request_count == 1
        ledgers = (await session.execute(select(AICallLedgerModel).where(AICallLedgerModel.account_id == str(owner)))).scalars().all()
        assert len(ledgers) == 2 and all(row.status == 'completed' and row.operation == 'menu_design' for row in ledgers)
        assert not (await session.execute(select(AIInflightLeaseModel).where(AIInflightLeaseModel.account_id == str(owner)))).scalars().all()
