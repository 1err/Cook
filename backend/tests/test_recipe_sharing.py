"""Original shared-library behavior with retained erasure and historical schema."""
from uuid import uuid4

import pytest
from sqlalchemy import text, update
from sqlalchemy.orm import Session

from app.api import admin, routes_users
from app.db.models import RecipeModel, UserModel, UserBlockModel, ContentReportModel, RecipeMediaReviewModel
from test_account_deletion import deletion_app, client


@pytest.fixture
def safety_app(deletion_app, monkeypatch):
    context = deletion_app
    context.app.include_router(routes_users.router)
    context.app.include_router(admin.router)
    monkeypatch.setattr(admin, 'is_admin', lambda current: current.id == context.owner)
    monkeypatch.setattr('app.api.routes_recipes.can_manage_public_catalog', lambda current: True)
    with Session(context.engine) as session:
        session.execute(update(UserModel).values(is_library_public=True))
        session.execute(update(RecipeModel).values(is_public_catalog=True, raw_extraction_text='Private import guidance'))
        session.commit()
    return context


@pytest.mark.asyncio
async def test_shared_photos_and_copy_are_immediately_available_without_review(safety_app):
    with Session(safety_app.engine) as session:
        row = session.get(RecipeModel, str(safety_app.owner))
        row.rejected_media_digest = 'b' * 64
        session.commit()
    async with client(safety_app, 'other') as viewer:
        friend = (await viewer.get(f'/users/{safety_app.owner}/recipes/{safety_app.owner}')).json()
        catalog = next(row for row in (await viewer.get('/recipes/catalog')).json() if row['id'] == str(safety_app.owner))
        for shared in (friend, catalog):
            assert shared['thumbnail_url'].endswith('/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')
            assert shared['steps'][0]['image_url'].endswith('/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png')
            assert shared['raw_extraction_text'] is None
            assert 'shared_media_status' not in shared
        copied = await viewer.post(f'/recipes/catalog/{safety_app.owner}/copy')
        assert copied.status_code == 200
        assert copied.json()['thumbnail_url'] == friend['thumbnail_url']
        assert copied.json()['steps'][0]['image_url'] == friend['steps'][0]['image_url']
        restored = await viewer.post(f'/users/{safety_app.owner}/recipes/{safety_app.owner}/copy')
        assert restored.status_code == 200 and restored.json()['id'] == copied.json()['id']
    with Session(safety_app.engine) as session:
        assert session.execute(text('SELECT count(*) FROM recipe_media_reviews')).scalar_one() == 0

@pytest.mark.asyncio
async def test_historical_blocks_and_holds_do_not_change_original_sharing(safety_app):
    with Session(safety_app.engine) as session:
        session.add(UserBlockModel(user_id=safety_app.other, blocked_user_id=safety_app.owner))
        session.execute(update(UserModel).where(UserModel.id == safety_app.owner).values(library_sharing_suspended=True))
        session.execute(update(RecipeModel).where(RecipeModel.id == str(safety_app.owner)).values(catalog_suspended=True, title='Ｋｉｌｌ\nyourself'))
        session.commit()
    async with client(safety_app, 'other') as viewer:
        assert (await viewer.get('/users/search', params={'email': 'owner@example.com'})).status_code == 200
        assert (await viewer.get(f'/users/{safety_app.owner}/recipes')).status_code == 200
        assert (await viewer.get(f'/users/{safety_app.owner}/recipes/{safety_app.owner}')).status_code == 200
        assert str(safety_app.owner) in {row['id'] for row in (await viewer.get('/recipes/catalog')).json()}
        assert (await viewer.post(f'/users/{safety_app.owner}/recipes/{safety_app.owner}/copy')).status_code == 200
    async with client(safety_app, 'owner') as owner:
        assert (await owner.patch(f'/recipes/{safety_app.owner}', json={'title': 'kill yourself'})).status_code == 200
        assert (await owner.post('/auth/library-visibility', json={'is_public': True})).status_code == 200
        assert (await owner.post(f'/recipes/{safety_app.owner}/catalog', json={'is_public': True})).status_code == 200

@pytest.mark.asyncio
@pytest.mark.parametrize('method,path', [
    ('get', '/users/blocks'), ('post', '/users/reports'),
    ('put', '/users/00000000-0000-0000-0000-000000000001/block'),
    ('delete', '/users/00000000-0000-0000-0000-000000000001/block'),
    ('put', '/users/recipe-authors/example/block'), ('get', '/admin/content-reports'),
    ('post', '/admin/content-reports/00000000-0000-0000-0000-000000000001/resolve'),
    ('get', '/admin/media-reviews'),
    ('post', '/admin/media-reviews/00000000-0000-0000-0000-000000000001/review'),
])
async def test_retired_report_block_and_media_review_routes_are_absent(safety_app, method, path):
    paths = set(safety_app.app.openapi()['paths'])
    assert not any(route == '/users/blocks' or route == '/users/reports' or route.endswith('/block')
                   or route.startswith('/admin/content-reports') or route.startswith('/admin/media-reviews')
                   for route in paths)
    async with client(safety_app, 'owner') as owner:
        assert (await getattr(owner, method)(path)).status_code == 404

@pytest.mark.asyncio
async def test_deleting_account_still_erases_historical_report_block_and_review_data(safety_app):
    with Session(safety_app.engine) as session:
        session.add(UserBlockModel(user_id=safety_app.other, blocked_user_id=safety_app.owner))
        session.add(ContentReportModel(reporter_id=safety_app.other, owner_id=safety_app.owner,
            recipe_id=str(safety_app.owner), reason='privacy', content_snapshot={'title': 'Historical'}))
        session.add(RecipeMediaReviewModel(owner_id=safety_app.owner, recipe_id=str(safety_app.owner),
            media_digest='a' * 64, content_snapshot={'title': 'Historical'}))
        session.commit()
    async with client(safety_app, 'owner') as owner:
        assert (await owner.request('DELETE', '/auth/me', json={'password': 'owner-password'})).status_code == 200
    with Session(safety_app.engine) as session:
        for table in ('user_blocks', 'content_reports', 'recipe_media_reviews'):
            assert session.execute(text(f'SELECT count(*) FROM {table}')).scalar_one() == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('surface', ['catalog', 'friend'])
async def test_original_external_cover_and_step_photos_are_copied(safety_app, surface):
    import json
    cover, step_photo = 'https://photos.example.com/cover.png', 'https://photos.example.com/step.png'
    with Session(safety_app.engine) as session:
        row = session.get(RecipeModel, str(safety_app.owner))
        row.thumbnail_url = cover
        row.steps = json.dumps([{'text': 'Cook', 'image_url': step_photo}])
        session.commit()
    path = f'/recipes/catalog/{safety_app.owner}/copy' if surface == 'catalog' else f'/users/{safety_app.owner}/recipes/{safety_app.owner}/copy'
    async with client(safety_app, 'other') as viewer:
        copied = await viewer.post(path)
        assert copied.status_code == 200
        assert copied.json()['thumbnail_url'] == cover
        assert copied.json()['steps'][0]['image_url'] == step_photo
        assert copied.json()['raw_extraction_text'] is None


@pytest.mark.asyncio
async def test_shared_recipe_changes_show_new_photos_without_creating_review(safety_app):
    cover = 'https://photos.example.com/new-cover.png'
    async with client(safety_app, 'owner') as owner, client(safety_app, 'other') as viewer:
        assert (await owner.patch(f'/recipes/{safety_app.owner}', json={'thumbnail_url': cover})).status_code == 200
        assert (await owner.post('/auth/library-visibility', json={'is_public': True})).status_code == 200
        detail = (await viewer.get(f'/users/{safety_app.owner}/recipes/{safety_app.owner}')).json()
        assert detail['thumbnail_url'] == cover
    with Session(safety_app.engine) as session:
        assert session.execute(text('SELECT count(*) FROM recipe_media_reviews')).scalar_one() == 0
