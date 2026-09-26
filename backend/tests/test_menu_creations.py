"""HTTP coverage for durable, account-scoped menu session admission."""
from datetime import timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from test_recipe_image_generation import image_app, client_for


@pytest.fixture
def menu_creation_app(image_app, monkeypatch):
    from app.api import routes_menu_creations
    from app.db import repo_menu_creations
    from app.db.models import MenuCreationModel
    MenuCreationModel.__table__.create(image_app.database.bind)
    image_app.app.include_router(routes_menu_creations.router)
    monkeypatch.setattr(repo_menu_creations, "database_now", image_app.repo.database_now)
    return image_app


@pytest.mark.asyncio
async def test_create_once_replay_after_limit_and_utc_reset(menu_creation_app):
    app = menu_creation_app
    first_id, second_id = str(uuid4()), str(uuid4())
    async with client_for(app) as client:
        access = await client.get('/menus/access')
        assert access.json() == {"allowed": True, "is_admin": False, "daily_limit": 1,
                                "remaining": 1, "resets_at": "2026-09-26T00:00:00Z"}
        first = await client.post('/menus/creations', json={"request_id": first_id})
        again = await client.post('/menus/creations', json={"request_id": first_id})
        assert first.status_code == 200 and first.json() == again.json()
        assert first.headers['cache-control'] == 'no-store'
        assert (await client.get('/menus/access')).json()['remaining'] == 0
        blocked = await client.post('/menus/creations', json={"request_id": second_id})
        assert blocked.status_code == 429
        assert blocked.json()['detail']['code'] == 'menu_daily_limit'
        assert int(blocked.headers['retry-after']) == 43200
        app.now[0] += timedelta(hours=12)
        assert (await client.get('/menus/access')).json()['remaining'] == 1
        # Yesterday's retry does not use today's allowance.
        assert (await client.post('/menus/creations', json={"request_id": first_id})).json() == first.json()
        assert (await client.get('/menus/access')).json()['remaining'] == 1
        assert (await client.post('/menus/creations', json={"request_id": second_id})).status_code == 200


@pytest.mark.asyncio
async def test_admin_creations_are_exempt_without_consuming_user_counter(menu_creation_app, monkeypatch):
    from app.core.config import settings
    from app.db.models import AIUsageCounterModel
    app = menu_creation_app
    monkeypatch.setattr(settings, 'ADMIN_USER_IDS', str(app.user_id))
    async with client_for(app) as client:
        result = (await client.get('/menus/access')).json()
        assert result['is_admin'] and result['allowed'] and result['daily_limit'] is None and result['remaining'] is None
        for _ in range(4):
            assert (await client.post('/menus/creations', json={"request_id": str(uuid4())})).status_code == 200
        assert not app.database.scalars(select(AIUsageCounterModel)).all()
        monkeypatch.setattr(settings, 'ADMIN_USER_IDS', '')
        assert (await client.get('/menus/access')).json()['remaining'] == 1


@pytest.mark.asyncio
async def test_same_uuid_is_owned_independently_by_each_account(menu_creation_app):
    from app.api.auth import get_current_user
    from app.db.models import UserModel, MenuCreationModel
    app = menu_creation_app
    request_id, other = str(uuid4()), uuid4()
    app.database.add(UserModel(id=other, email='menu-other@example.com'))
    app.database.commit()
    async with client_for(app) as client:
        assert (await client.post('/menus/creations', json={"request_id": request_id})).status_code == 200
        app.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=other, auth_version=1)
        assert (await client.get('/menus/access')).json()['remaining'] == 1
        assert (await client.post('/menus/creations', json={"request_id": request_id})).status_code == 200
    assert len(app.database.scalars(select(MenuCreationModel)).all()) == 2


@pytest.mark.asyncio
async def test_invalid_or_unauthenticated_creation_does_not_admit(menu_creation_app):
    from app.api.auth import get_current_user
    from app.db.models import MenuCreationModel
    app = menu_creation_app
    async with client_for(app) as client:
        for body in ({'request_id': 'invalid'}, {'request_id': str(uuid4()), 'is_admin': True}, {}):
            assert (await client.post('/menus/creations', json=body)).status_code == 422
        assert not app.database.scalars(select(MenuCreationModel)).all()
        app.app.dependency_overrides.pop(get_current_user)
        assert (await client.get('/menus/access')).status_code == 401
        assert (await client.post('/menus/creations', json={'request_id': str(uuid4())})).status_code == 401
