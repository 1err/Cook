"""Current-account erasure and durable media cleanup behavior."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import JSON, MetaData, Uuid, create_engine, event, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.api import auth, routes_recipes
from app.core.security import hash_password
from app.db.models import (
    Base, AIUsageCounterModel, AuthIdentityModel, CookingSessionModel,
    CookingSessionDishModel, CookingSessionStepModel, CookingSessionMutationModel,
    FeatureEntitlementModel, MealPlanModel, RecipeImageGenerationModel, RecipeModel, UserModel,
)
from app.db.session import get_session


class SqlSession:
    def __init__(self, sync):
        self.sync = sync

    def get_bind(self):
        return self.sync.get_bind()

    async def execute(self, statement, params=None):
        return self.sync.execute(statement, params)

    async def get(self, model, key):
        return self.sync.get(model, key)

    async def commit(self):
        self.sync.commit()

    async def rollback(self):
        self.sync.rollback()

    async def close(self):
        self.sync.close()

    async def flush(self):
        self.sync.flush()

    def add(self, row):
        self.sync.add(row)

    async def delete(self, row):
        self.sync.delete(row)


@pytest.fixture
def deletion_app(monkeypatch, tmp_path):
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        copied = table.to_metadata(metadata)
        for column in copied.columns:
            if isinstance(column.type, postgresql.JSONB):
                column.type = JSON()
            elif isinstance(column.type, postgresql.UUID):
                column.type = Uuid()
    engine = create_engine('sqlite://')
    event.listen(engine, 'connect', lambda dbapi, _: dbapi.execute('PRAGMA foreign_keys=ON'))
    metadata.create_all(engine)
    owner, other = uuid4(), uuid4()
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        session.add_all([UserModel(id=owner, email='owner@example.com'), UserModel(id=other, email='other@example.com')])
        session.flush()
        for user in (owner, other):
            session.add(AuthIdentityModel(user_id=user, provider='local', provider_user_id=f'{user}@example.test', password_hash=hash_password('owner-password' if user == owner else 'other-password')))
            session.add(RecipeModel(id=str(user), user_id=user, title='Keep recipe text', ingredients='[]', thumbnail_url=f'http://api/uploads/recipes/{owner}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', steps='[{"text":"Cook","image_url":"http://api/uploads/recipes/'+str(owner)+'/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png"}]'))
            session.add(MealPlanModel(user_id=user, date='2026-10-13', recipe_ids='{}'))
            session.add(FeatureEntitlementModel(user_id=user, feature_key='recipe_image_generation'))
            session.add(RecipeImageGenerationModel(user_id=user, request_id=uuid4(), request_hash='a'*64, status='completed', file_url=f'http://api/uploads/recipes/{user}/generated.png', deadline_at=now+timedelta(minutes=1)))
            session.add(AIUsageCounterModel(scope=f'user:{user}', window_seconds=60, window_start=0, request_count=1))
            session.add(AIUsageCounterModel(scope=f'image:user:{user}', window_seconds=60, window_start=0, request_count=1))
            active = CookingSessionModel(user_id=user, version=1)
            active.dishes = [CookingSessionDishModel(id=uuid4(), recipe_id=str(user), position=0, title='Keep snapshot', ingredients=[], equipment=[], tips=[], thumbnail_url=f'http://api/uploads/recipes/{owner}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', steps=[CookingSessionStepModel(id=uuid4(), recipe_step_id=uuid4(), position=0, text='Cook', duration_seconds=60, duration_source='stated', attention_type='hands_on', action_type='prep', state='ready', revision=1, image_url=f'http://api/uploads/recipes/{owner}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png')])]
            active.mutations = [CookingSessionMutationModel(mutation_id=uuid4(), device_id='test-device')]
            session.add(active)
        session.add(AIUsageCounterModel(scope='global', window_seconds=60, window_start=0, request_count=2))
        session.commit()
    monkeypatch.setattr(auth.settings, 'LOCAL_IMAGE_UPLOAD_DIR', str(tmp_path))
    monkeypatch.setattr(auth.settings, 'AWS_REGION', '')
    monkeypatch.setattr(auth.settings, 'PUBLIC_API_ORIGIN', 'http://api')
    monkeypatch.setattr(auth.settings, 'S3_BUCKET_NAME', '')
    monkeypatch.setattr(auth, 'decode_access_token', lambda token: {'sub': str(owner if token == 'owner' else other)} if token in ('owner', 'other') else None)
    app = FastAPI()
    app.include_router(auth.router)
    app.include_router(routes_recipes.router)
    async def local_session():
        with Session(engine, expire_on_commit=False, autoflush=False) as sync:
            session = SqlSession(sync)
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
    app.dependency_overrides[get_session] = local_session
    yield SimpleNamespace(app=app, engine=engine, owner=owner, other=other, directory=tmp_path)
    engine.dispose()


def client(context, token=None):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=context.app), base_url='http://api', headers={'Authorization': f'Bearer {token}'} if token else {})


@pytest.mark.asyncio
async def test_deletion_requires_authentication(deletion_app):
    async with client(deletion_app) as api:
        response = await api.request('DELETE', '/auth/me', json={'password': 'owner-password'})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_wrong_password_preserves_current_account_and_cookie(deletion_app):
    async with client(deletion_app, 'owner') as api:
        response = await api.request('DELETE', '/auth/me', json={'password': 'other-password'})
        still_authenticated = await api.get('/auth/me')
    assert response.status_code == 403
    assert still_authenticated.status_code == 200
    assert 'set-cookie' not in response.headers
    with Session(deletion_app.engine) as session:
        assert session.get(UserModel, deletion_app.owner) is not None


@pytest.mark.asyncio
async def test_deletion_cannot_target_another_account(deletion_app):
    async with client(deletion_app, 'owner') as api:
        response = await api.request('DELETE', '/auth/me', json={'password': 'owner-password', 'user_id': str(deletion_app.other)})
    assert response.status_code == 422
    with Session(deletion_app.engine) as session:
        assert session.get(UserModel, deletion_app.owner) is not None
        assert session.get(UserModel, deletion_app.other) is not None


@pytest.mark.asyncio
async def test_deletion_cascades_and_revokes_old_token_but_preserves_other_account(deletion_app):
    async with client(deletion_app, 'owner') as api:
        response = await api.request('DELETE', '/auth/me', json={'password': 'owner-password'})
        stale = await api.get('/auth/me')
    assert response.status_code == 200
    assert response.json() == {'ok': True}
    assert 'Max-Age=0' in response.headers['set-cookie']
    assert stale.status_code == 401
    with Session(deletion_app.engine) as session:
        assert session.get(UserModel, deletion_app.owner) is None
        assert session.get(UserModel, deletion_app.other) is not None
        for model in (AuthIdentityModel, RecipeModel, MealPlanModel, CookingSessionModel, FeatureEntitlementModel, RecipeImageGenerationModel):
            assert len(session.scalars(select(model)).all()) == 1
        for model in (CookingSessionDishModel, CookingSessionStepModel, CookingSessionMutationModel):
            assert len(session.scalars(select(model)).all()) == 1
        assert set(session.scalars(select(AIUsageCounterModel.scope)).all()) == {'global', f'user:{deletion_app.other}', f'image:user:{deletion_app.other}'}
        copy = session.get(RecipeModel, str(deletion_app.other))
        assert copy.title == 'Keep recipe text'
        assert copy.thumbnail_url is None
        assert 'Cook' in copy.steps and str(deletion_app.owner) not in copy.steps
        dish = session.scalars(select(CookingSessionDishModel)).one()
        step = session.scalars(select(CookingSessionStepModel)).one()
        assert dish.title == 'Keep snapshot' and dish.thumbnail_url is None
        assert step.text == 'Cook' and step.image_url is None
        assert session.execute(text('SELECT count(*) FROM account_media_cleanup')).scalar_one() == 1


@pytest.mark.asyncio
async def test_cleanup_retry_removes_owned_unsaved_media_but_keeps_other_and_legacy_files(deletion_app, monkeypatch):
    from app.services import account_deletion_service as cleanup
    owned = deletion_app.directory / 'recipes' / str(deletion_app.owner)
    other = deletion_app.directory / 'recipes' / str(deletion_app.other)
    owned.mkdir(parents=True)
    other.mkdir(parents=True)
    (owned / 'unsaved.png').write_bytes(b'private')
    (other / 'keep.png').write_bytes(b'other')
    legacy = deletion_app.directory / 'recipes' / 'legacy.png'
    legacy.write_bytes(b'unattributable')
    async with client(deletion_app, 'owner') as api:
        assert (await api.request('DELETE', '/auth/me', json={'password': 'owner-password'})).status_code == 200
    original = cleanup.erase_account_media
    def unavailable(*args, **kwargs):
        raise OSError('storage offline')
    monkeypatch.setattr(cleanup, 'erase_account_media', unavailable)
    with Session(deletion_app.engine) as sync:
        assert await cleanup.process_one_cleanup(SqlSession(sync)) is True
        sync.commit()
        assert sync.execute(text('SELECT attempts FROM account_media_cleanup')).scalar_one() == 1
        assert owned.exists()
        sync.execute(text("UPDATE account_media_cleanup SET available_at = '2000-01-01'"))
        sync.commit()
        monkeypatch.setattr(cleanup, 'erase_account_media', original)
        assert await cleanup.process_one_cleanup(SqlSession(sync)) is True
        sync.commit()
        assert sync.execute(text('SELECT count(*) FROM account_media_cleanup')).scalar_one() == 0
    assert not owned.exists()
    assert (other / 'keep.png').read_bytes() == b'other'
    assert legacy.read_bytes() == b'unattributable'


@pytest.mark.asyncio
async def test_expected_account_header_prevents_cross_tab_cookie_account_deletion(deletion_app):
    async with client(deletion_app, 'other') as api:
        response = await api.request('DELETE', '/auth/me', json={'password': 'other-password'},
                                     headers={'X-Chef-World-Account-ID': str(deletion_app.owner)})
    assert response.status_code == 409
    with Session(deletion_app.engine) as session:
        assert session.get(UserModel, deletion_app.owner) is not None
        assert session.get(UserModel, deletion_app.other) is not None


@pytest.mark.asyncio
async def test_header_bound_deletion_does_not_overwrite_a_new_browser_login_cookie(deletion_app):
    async with client(deletion_app, 'owner') as api:
        response = await api.request('DELETE', '/auth/me', json={'password': 'owner-password'},
                                     headers={'X-Chef-World-Account-ID': str(deletion_app.owner)})
    assert response.status_code == 200
    assert 'set-cookie' not in response.headers


@pytest.mark.asyncio
async def test_erasure_detaches_copied_review_media_and_removes_moderator_notes(deletion_app):
    from app.db.models import ContentReportModel, RecipeMediaReviewModel
    snapshot = {'id': str(deletion_app.other), 'title': 'Retained copy',
                'thumbnail_url': f'http://api/uploads/recipes/{deletion_app.owner}/'+('a'*32)+'.png',
                'steps': [{'text': 'Keep instructions', 'image_url': f'http://api/uploads/recipes/{deletion_app.owner}/'+('b'*32)+'.png'}]}
    report_id, media_id = uuid4(), uuid4()
    with Session(deletion_app.engine) as session:
        session.add(ContentReportModel(id=report_id, reporter_id=deletion_app.other, owner_id=deletion_app.other,
            recipe_id=str(deletion_app.other), reason='privacy', status='resolved', resolution='dismiss',
            content_snapshot=snapshot, reviewer_id=deletion_app.owner, resolution_notes='Private moderator note'))
        session.add(RecipeMediaReviewModel(id=media_id, owner_id=deletion_app.other, recipe_id=str(deletion_app.other),
            media_digest='a'*64, content_snapshot=snapshot, status='approved', reviewer_id=deletion_app.owner,
            review_notes='Private photo-review note'))
        session.commit()
    async with client(deletion_app, 'owner') as api:
        assert (await api.request('DELETE', '/auth/me', json={'password': 'owner-password'})).status_code == 200
    with Session(deletion_app.engine) as session:
        report, media = session.get(ContentReportModel, report_id), session.get(RecipeMediaReviewModel, media_id)
        assert report.reviewer_id is None and report.resolution_notes is None
        assert media.reviewer_id is None and media.review_notes is None
        for row in (report, media):
            assert row.content_snapshot['thumbnail_url'] is None
            assert row.content_snapshot['steps'][0]['image_url'] is None
            assert row.content_snapshot['title'] == 'Retained copy'



@pytest.mark.asyncio
async def test_stale_logout_actor_header_preserves_new_browser_account(deletion_app):
    async with client(deletion_app) as api:
        api.cookies.set("access_token", "other")
        response = await api.post("/auth/logout", headers={"X-Chef-World-Account-ID": str(deletion_app.owner)})
        assert response.status_code == 409
        assert "set-cookie" not in response.headers
        current = await api.get("/auth/me")
        assert current.status_code == 200 and current.json()["id"] == str(deletion_app.other)



@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{"password": ""}, {"password": "owner-password", "user_id": "another-account"}])
async def test_deployed_delete_route_validates_body_before_account_erasure(deletion_app, body, monkeypatch):
    from app.api import account_routes
    deletion_app.app.include_router(account_routes.router)
    monkeypatch.setattr(account_routes, "decode_access_token", auth.decode_access_token)
    async with client(deletion_app, "owner") as api:
        response = await api.request("DELETE", "/auth/account", json=body)
        assert response.status_code == 422
        assert (await api.get("/auth/me")).status_code == 200
    with Session(deletion_app.engine) as session:
        assert session.get(UserModel, deletion_app.owner) is not None
