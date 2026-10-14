"""Private reports, bilateral blocking and moderation of shared recipes."""
import json
from uuid import uuid4

import pytest
from sqlalchemy import text, update
from sqlalchemy.orm import Session

from app.api import admin, routes_users
from app.db.models import RecipeModel, UserModel
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
async def test_blocking_hides_friend_library_both_directions_and_unblock_restores(safety_app):
    async with client(safety_app, 'owner') as owner, client(safety_app, 'other') as other:
        response = await owner.put(f'/users/{safety_app.other}/block')
        assert response.status_code == 200
        assert (await owner.get('/users/blocks')).json() == {'users': [{'id': str(safety_app.other), 'email': 'other@example.com'}]}
        for api, target, email in ((owner, safety_app.other, 'other@example.com'), (other, safety_app.owner, 'owner@example.com')):
            assert (await api.get('/users/search', params={'email': email})).status_code == 404
            assert (await api.get(f'/users/{target}/recipes')).status_code == 404
            assert (await api.get(f'/users/{target}/recipes/{target}')).status_code == 404
            assert (await api.post(f'/users/{target}/recipes/{target}/copy')).status_code == 404
        assert (await owner.get(f'/recipes/{safety_app.owner}')).status_code == 200
        assert (await owner.delete(f'/users/{safety_app.other}/block')).status_code == 200
        assert (await other.get(f'/users/{safety_app.owner}/recipes')).status_code == 200


@pytest.mark.asyncio
async def test_block_author_hides_catalog_and_prevents_future_copy(safety_app):
    async with client(safety_app, 'other') as api:
        assert (await api.put(f'/users/recipe-authors/{safety_app.owner}/block')).status_code == 200
        catalog = await api.get('/recipes/catalog')
        assert str(safety_app.owner) not in {row['id'] for row in catalog.json()}
        assert (await api.post(f'/recipes/catalog/{safety_app.owner}/copy')).status_code == 404


@pytest.mark.asyncio
async def test_block_requires_login_and_cannot_block_self_or_unknown_account(safety_app):
    async with client(safety_app) as anonymous, client(safety_app, 'owner') as api:
        assert (await anonymous.put(f'/users/{safety_app.other}/block')).status_code == 401
        assert (await api.put(f'/users/{safety_app.owner}/block')).status_code == 400
        assert (await api.put(f'/users/{uuid4()}/block')).status_code == 404


@pytest.mark.asyncio
async def test_report_is_private_and_visible_only_to_admin(safety_app):
    async with client(safety_app, 'other') as reporter, client(safety_app, 'owner') as reviewer:
        report = await reporter.post('/users/reports', json={'recipe_id': str(safety_app.owner), 'reason': 'privacy', 'notes': 'Please review exposed personal details'})
        assert report.status_code == 201
        assert report.json()['status'] == 'pending'
        assert (await reporter.get('/admin/content-reports')).status_code == 403
        assert (await reporter.get('/users/reports')).status_code in (404, 405)
        reports = (await reviewer.get('/admin/content-reports')).json()
        row = next(row for row in reports['reports'] if row['id'] == report.json()['id'])
        assert row['reporter_id'] == str(safety_app.other)
        assert row['reason'] == 'privacy'
        assert row['notes'] == 'Please review exposed personal details'
        assert 'Private import guidance' not in json.dumps(reports)


@pytest.mark.asyncio
async def test_report_rejects_hidden_recipe_self_report_and_unbounded_notes(safety_app):
    with Session(safety_app.engine) as session:
        session.execute(update(UserModel).where(UserModel.id == safety_app.owner).values(is_library_public=False))
        session.execute(update(RecipeModel).where(RecipeModel.user_id == safety_app.owner).values(is_public_catalog=False))
        session.commit()
    async with client(safety_app, 'other') as api:
        assert (await api.post('/users/reports', json={'recipe_id': str(safety_app.owner), 'reason': 'privacy'})).status_code == 404
        assert (await api.post('/users/reports', json={'recipe_id': str(safety_app.other), 'reason': 'spam'})).status_code == 400
        assert (await api.post('/users/reports', json={'recipe_id': str(safety_app.other), 'reason': 'spam', 'notes': 'a'*2001})).status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['remove_catalog', 'disable_library'])
async def test_admin_moderation_removes_visibility_and_prevents_author_republishing(safety_app, action):
    async with client(safety_app, 'other') as reporter, client(safety_app, 'owner') as admin_api:
        report = await reporter.post('/users/reports', json={'recipe_id': str(safety_app.owner), 'reason': 'objectionable'})
        report_id = report.json()['id']
        assert (await reporter.post(f'/admin/content-reports/{report_id}/resolve', json={'action': action})).status_code == 403
        resolution = await admin_api.post(f'/admin/content-reports/{report_id}/resolve', json={'action': action, 'notes': 'Reviewed shared content'})
        assert resolution.status_code == 200
        assert resolution.json()['status'] == 'resolved'
        assert resolution.json()['resolution'] == action
        if action == 'remove_catalog':
            assert (await admin_api.post(f'/recipes/{safety_app.owner}/catalog', json={'is_public': True})).status_code == 403
            assert str(safety_app.owner) not in {r['id'] for r in (await reporter.get('/recipes/catalog')).json()}
        else:
            assert (await admin_api.post('/auth/library-visibility', json={'is_public': True})).status_code == 403
            assert (await reporter.get(f'/users/{safety_app.owner}/recipes')).status_code == 404
        assert (await admin_api.get(f'/recipes/{safety_app.owner}')).status_code == 200


@pytest.mark.asyncio
async def test_explicit_text_filter_blocks_sharing_but_preserves_private_recipe(safety_app):
    with Session(safety_app.engine) as session:
        session.execute(update(UserModel).where(UserModel.id == safety_app.owner).values(is_library_public=False))
        session.execute(update(RecipeModel).where(RecipeModel.user_id == safety_app.owner).values(is_public_catalog=False, title='Kill yourself'))
        session.commit()
    async with client(safety_app, 'owner') as api:
        assert (await api.post('/auth/library-visibility', json={'is_public': True})).status_code == 422
        assert (await api.post(f'/recipes/{safety_app.owner}/catalog', json={'is_public': True})).status_code == 422
        private = await api.get(f'/recipes/{safety_app.owner}')
        assert private.status_code == 200 and private.json()['title'] == 'Kill yourself'
        assert (await api.patch(f'/recipes/{safety_app.owner}', json={'title': 'Roast chicken breast'})).status_code == 200
        assert (await api.post('/auth/library-visibility', json={'is_public': True})).status_code == 200
        blocked_edit = await api.patch(f'/recipes/{safety_app.owner}', json={'description': 'kill yourself'})
        assert blocked_edit.status_code == 422
        assert (await api.get(f'/recipes/{safety_app.owner}')).json()['description'] is None


@pytest.mark.asyncio
async def test_account_deletion_erases_owned_blocks_and_reports(safety_app):
    async with client(safety_app, 'other') as reporter, client(safety_app, 'owner') as owner:
        assert (await reporter.post('/users/reports', json={'recipe_id': str(safety_app.owner), 'reason': 'spam'})).status_code == 201
        assert (await reporter.put(f'/users/{safety_app.owner}/block')).status_code == 200
        assert (await owner.request('DELETE', '/auth/me', json={'password': 'owner-password'})).status_code == 200
    with Session(safety_app.engine) as session:
        assert session.execute(text('SELECT count(*) FROM user_blocks')).scalar_one() == 0
        assert session.execute(text('SELECT count(*) FROM content_reports')).scalar_one() == 0


@pytest.mark.asyncio
async def test_combined_moderation_removes_both_shared_surfaces(safety_app):
    async with client(safety_app, 'other') as reporter, client(safety_app, 'owner') as reviewer:
        report = await reporter.post('/users/reports', json={'recipe_id': str(safety_app.owner), 'reason': 'harassment'})
        result = await reviewer.post(f"/admin/content-reports/{report.json()['id']}/resolve", json={'action': 'remove_shared_content'})
        assert result.status_code == 200
        assert str(safety_app.owner) not in {row['id'] for row in (await reporter.get('/recipes/catalog')).json()}
        assert (await reporter.get(f'/users/{safety_app.owner}/recipes')).status_code == 404
        assert (await reviewer.post('/auth/library-visibility', json={'is_public': True})).status_code == 403
        assert (await reviewer.post(f'/recipes/{safety_app.owner}/catalog', json={'is_public': True})).status_code == 403


@pytest.mark.asyncio
async def test_shared_photos_are_hidden_until_admin_approves_current_digest(safety_app):
    async with client(safety_app, 'owner') as owner, client(safety_app, 'other') as viewer:
        # Re-enabling sharing queues the existing owner images for review.
        assert (await owner.post('/auth/library-visibility', json={'is_public': True})).status_code == 200
        own = (await owner.get(f'/recipes/{safety_app.owner}')).json()
        shared = next(r for r in (await viewer.get(f'/users/{safety_app.owner}/recipes')).json() if r['id'] == str(safety_app.owner))
        assert own['thumbnail_url'] is not None
        assert shared['thumbnail_url'] is None
        assert all(step['image_url'] is None for step in shared['steps'])
        assert shared['shared_media_status'] == 'pending'
        assert (await viewer.get('/admin/media-reviews')).status_code == 403
        review = next(r for r in (await owner.get('/admin/media-reviews')).json()['reviews'] if r['recipe_id'] == str(safety_app.owner))
        assert review['recipe']['thumbnail_url'] == own['thumbnail_url']
        assert review['recipe']['raw_extraction_text'] is None
        approved = await owner.post(f"/admin/media-reviews/{review['id']}/review", json={'decision': 'approve', 'media_digest': review['media_digest']})
        assert approved.status_code == 200
        shared = next(r for r in (await viewer.get('/recipes/catalog')).json() if r['id'] == str(safety_app.owner))
        assert shared['thumbnail_url'] == own['thumbnail_url']
        assert shared['shared_media_status'] == 'approved'
        copied = await viewer.post(f'/recipes/catalog/{safety_app.owner}/copy')
        assert copied.json()['thumbnail_url'] == own['thumbnail_url']


@pytest.mark.asyncio
async def test_changed_photos_cancel_old_review_and_cannot_be_approved_with_stale_digest(safety_app):
    async with client(safety_app, 'owner') as owner, client(safety_app, 'other') as viewer:
        await owner.post('/auth/library-visibility', json={'is_public': True})
        old = next(r for r in (await owner.get('/admin/media-reviews')).json()['reviews'] if r['recipe_id'] == str(safety_app.owner))
        assert (await owner.patch(f'/recipes/{safety_app.owner}', json={'thumbnail_url': f'http://api/uploads/recipes/{safety_app.owner}/dddddddddddddddddddddddddddddddd.png'})).status_code == 200
        stale = await owner.post(f"/admin/media-reviews/{old['id']}/review", json={'decision': 'approve', 'media_digest': old['media_digest']})
        assert stale.status_code in (404, 409)
        fresh = next(r for r in (await owner.get('/admin/media-reviews')).json()['reviews'] if r['recipe_id'] == str(safety_app.owner))
        mismatch = await owner.post(f"/admin/media-reviews/{fresh['id']}/review", json={'decision': 'approve', 'media_digest': old['media_digest']})
        assert mismatch.status_code == 409
        rejected = await owner.post(f"/admin/media-reviews/{fresh['id']}/review", json={'decision': 'reject', 'media_digest': fresh['media_digest'], 'notes': 'Image is not suitable for sharing'})
        assert rejected.status_code == 200
        shared = next(r for r in (await viewer.get(f'/users/{safety_app.owner}/recipes')).json() if r['id'] == str(safety_app.owner))
        assert shared['thumbnail_url'] is None and shared['shared_media_status'] == 'rejected'
        assert (await owner.get(f'/recipes/{safety_app.owner}')).json()['thumbnail_url'].endswith('/dddddddddddddddddddddddddddddddd.png')


@pytest.mark.asyncio
async def test_actor_header_guard_applies_to_block_and_report_mutations(safety_app):
    async with client(safety_app, 'other') as api:
        api.headers['X-Chef-World-Account-ID'] = str(safety_app.owner)
        assert (await api.put(f'/users/{safety_app.owner}/block')).status_code == 409
        assert (await api.post('/users/reports', json={'recipe_id': str(safety_app.owner), 'reason': 'privacy'})).status_code == 409
    with Session(safety_app.engine) as session:
        assert session.execute(text('SELECT count(*) FROM user_blocks')).scalar_one() == 0
        assert session.execute(text('SELECT count(*) FROM content_reports')).scalar_one() == 0


@pytest.mark.asyncio
async def test_reverting_to_previous_approved_photo_set_restores_review_decision(safety_app):
    async with client(safety_app, 'owner') as owner, client(safety_app, 'other') as viewer:
        original = (await owner.get(f'/recipes/{safety_app.owner}')).json()['thumbnail_url']
        await owner.post('/auth/library-visibility', json={'is_public': True})
        first = next(r for r in (await owner.get('/admin/media-reviews')).json()['reviews'] if r['recipe_id'] == str(safety_app.owner))
        assert (await owner.post(f"/admin/media-reviews/{first['id']}/review", json={'decision': 'approve', 'media_digest': first['media_digest']})).status_code == 200
        await owner.patch(f'/recipes/{safety_app.owner}', json={'thumbnail_url': f'http://api/uploads/recipes/{safety_app.owner}/'+('d'*32)+'.png'})
        second = next(r for r in (await owner.get('/admin/media-reviews')).json()['reviews'] if r['recipe_id'] == str(safety_app.owner))
        assert (await owner.post(f"/admin/media-reviews/{second['id']}/review", json={'decision': 'approve', 'media_digest': second['media_digest']})).status_code == 200
        assert (await owner.patch(f'/recipes/{safety_app.owner}', json={'thumbnail_url': original})).status_code == 200
        shared = next(r for r in (await viewer.get('/recipes/catalog')).json() if r['id'] == str(safety_app.owner))
        assert shared['shared_media_status'] == 'approved' and shared['thumbnail_url'] == original


@pytest.mark.asyncio
async def test_approved_mixed_media_copy_keeps_only_reviewed_immutable_images(safety_app):
    external = 'https://mutable.example.com/photo.png'
    with Session(safety_app.engine) as session:
        session.execute(update(RecipeModel).where(RecipeModel.user_id == safety_app.owner).values(thumbnail_url=external))
        session.commit()
    async with client(safety_app, 'owner') as owner, client(safety_app, 'other') as viewer:
        await owner.post('/auth/library-visibility', json={'is_public': True})
        pending = next(r for r in (await owner.get('/admin/media-reviews')).json()['reviews'] if r['recipe_id'] == str(safety_app.owner))
        assert external not in pending['eligible_media_urls']
        assert len(pending['eligible_media_urls']) == 1
        assert (await owner.post(f"/admin/media-reviews/{pending['id']}/review", json={'decision': 'approve', 'media_digest': pending['media_digest']})).status_code == 200
        assert (await owner.get(f'/recipes/{safety_app.owner}')).json()['thumbnail_url'] == external
        copied = (await viewer.post(f'/recipes/catalog/{safety_app.owner}/copy')).json()
        assert copied['thumbnail_url'] is None
        assert copied['shared_media_status'] == 'approved'
        assert copied['steps'][0]['image_url'] is not None
        assert (await viewer.post('/auth/library-visibility', json={'is_public': True})).status_code == 200
        shared_copy = next(r for r in (await owner.get(f'/users/{safety_app.other}/recipes')).json() if r['id'] == copied['id'])
        assert shared_copy['thumbnail_url'] is None and shared_copy['steps'][0]['image_url'] is not None


@pytest.mark.asyncio
async def test_existing_explicitly_unsafe_shared_rows_are_hidden_without_erasing_private_data(safety_app):
    with Session(safety_app.engine) as session:
        session.execute(update(RecipeModel).where(RecipeModel.user_id == safety_app.owner).values(title='Kill yourself'))
        session.commit()
    async with client(safety_app, 'other') as viewer, client(safety_app, 'owner') as owner:
        assert str(safety_app.owner) not in {r['id'] for r in (await viewer.get('/recipes/catalog')).json()}
        assert (await viewer.get(f'/users/{safety_app.owner}/recipes')).json() == []
        assert (await viewer.post(f'/recipes/catalog/{safety_app.owner}/copy')).status_code == 404
        assert (await viewer.post(f'/users/{safety_app.owner}/recipes/{safety_app.owner}/copy')).status_code == 404
        assert (await owner.get(f'/recipes/{safety_app.owner}')).json()['title'] == 'Kill yourself'


@pytest.mark.asyncio
async def test_explicit_threat_filter_handles_actual_newlines_in_shared_text(safety_app):
    async with client(safety_app, 'owner') as api:
        response = await api.patch(f'/recipes/{safety_app.owner}', json={'title': 'kill\nyourself'})
    assert response.status_code == 422
