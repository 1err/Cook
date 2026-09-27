"""Authenticated photos export only recorded account-owned storage, without URL fetching."""
import io
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select

from test_recipe_image_generation import image_app, client_for

PNG = b'\x89PNG\r\n\x1a\nfixture'


@pytest.fixture
def photo_app(image_app):
    from app.api import routes_menu_recipe_images
    from app.db.account_models import OwnedImageModel
    from app.db.models import RecipeModel
    for model in (OwnedImageModel, RecipeModel):
        model.__table__.create(image_app.database.bind)
    image_app.app.include_router(routes_menu_recipe_images.router)
    image_app.photo_routes = routes_menu_recipe_images
    return image_app


def owned_photo(app, *, recipe_owner=None, image_owner=None, state='active', thumbnail=None):
    from app.db.account_models import OwnedImageModel
    from app.db.models import RecipeModel
    recipe_id = str(uuid4())
    image_owner = image_owner or app.user_id
    key = f'recipes/{image_owner}/{uuid4().hex}.png'
    url = f'http://api/uploads/{key}'
    app.database.add(OwnedImageModel(owner_id=image_owner, storage_kind='local', bucket='', region='',
        object_key=key, file_url=url, state=state))
    app.database.add(RecipeModel(id=recipe_id, user_id=recipe_owner or app.user_id, title='Private recipe title', ingredients='[]', thumbnail_url=thumbnail or url))
    app.database.commit()
    path = app.directory / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PNG)
    return recipe_id, key


@pytest.mark.asyncio
async def test_owner_gets_binary_photo_after_database_connection_closed(photo_app, monkeypatch):
    from app.services.menu_recipe_images import read_owned_recipe_image
    recipe_id, key = owned_photo(photo_app)
    def read(**coordinates):
        assert not photo_app.database.in_transaction()
        assert coordinates['object_key'] == key
        return read_owned_recipe_image(**coordinates)
    monkeypatch.setattr(photo_app.photo_routes, 'read_owned_recipe_image', read)
    async with client_for(photo_app) as client:
        result = await client.get(f'/menus/recipe-images/{recipe_id}')
    assert result.status_code == 200 and result.content == PNG
    assert result.headers['content-type'] == 'image/png'
    assert result.headers['cache-control'] == 'no-store' and result.headers['x-content-type-options'] == 'nosniff'


@pytest.mark.asyncio
@pytest.mark.parametrize('changes', [{'recipe_owner': uuid4()}, {'image_owner': uuid4()}, {'state': 'pending_upload'}, {'state': 'deleting'}, {'state': 'deleted'}, {'thumbnail': 'http://127.0.0.1/private'}, {'thumbnail': 'https://external.example/photo.png'}])
async def test_unowned_inactive_or_external_images_never_reach_storage(photo_app, monkeypatch, changes):
    recipe_id, _ = owned_photo(photo_app, **changes)
    def forbidden(**kwargs):
        raise AssertionError('Untrusted photo must not reach any storage transport')
    monkeypatch.setattr(photo_app.photo_routes, 'read_owned_recipe_image', forbidden)
    async with client_for(photo_app) as client:
        result = await client.get(f'/menus/recipe-images/{recipe_id}')
    assert result.status_code == 404
    assert 'Private recipe title' not in result.text


@pytest.mark.asyncio
async def test_photo_authentication_required(photo_app):
    from app.api.auth import get_current_user
    recipe_id, _ = owned_photo(photo_app)
    photo_app.app.dependency_overrides.pop(get_current_user)
    async with client_for(photo_app) as client:
        assert (await client.get(f'/menus/recipe-images/{recipe_id}')).status_code == 401


@pytest.mark.parametrize('key', ['../../secret.png', 'http://127.0.0.1/secret.png', 'recipes/{owner}/image.svg', 'recipes/other/' + 'a' * 32 + '.png'])
def test_storage_rejects_invalid_coordinates_before_any_io(monkeypatch, key):
    from app.services import menu_recipe_images as storage
    owner = str(uuid4())
    monkeypatch.setattr(storage.boto3, 'client', lambda *args, **kwargs: pytest.fail('No S3 request permitted'))
    with pytest.raises(storage.MenuRecipeImageUnavailable):
        storage.read_owned_recipe_image(account_id=owner, storage_kind='s3', object_key=key.format(owner=owner), bucket='x', region='x')


def test_local_storage_rejects_cross_account_symlink(monkeypatch, tmp_path):
    from app.services import menu_recipe_images as storage
    owner = str(uuid4())
    other = tmp_path / 'recipes' / str(uuid4())
    other.mkdir(parents=True)
    filename = uuid4().hex + '.png'
    (other / filename).write_bytes(PNG)
    (tmp_path / 'recipes' / owner).symlink_to(other, target_is_directory=True)
    monkeypatch.setattr(storage.settings, 'LOCAL_IMAGE_UPLOAD_DIR', str(tmp_path))
    with pytest.raises(storage.MenuRecipeImageUnavailable):
        storage.read_owned_recipe_image(account_id=owner, storage_kind='local', object_key=f'recipes/{owner}/{filename}', bucket='', region='')


@pytest.mark.parametrize('suffix,content,mime', [('png', PNG, 'image/png'), ('jpg', b'\xff\xd8\xfffixture', 'image/jpeg'), ('webp', b'RIFFabcdWEBPfixture', 'image/webp'), ('gif', b'GIF89afixture', 'image/gif')])
def test_s3_storage_reads_only_exact_configured_receipt_and_closes(monkeypatch, suffix, content, mime):
    from app.services import menu_recipe_images as storage
    owner = str(uuid4()); key = f'recipes/{owner}/{uuid4().hex}.{suffix}'
    events = []
    class Body(io.BytesIO):
        def read(self, size=-1):
            events.append(('read', size)); return super().read(size)
        def close(self):
            events.append('body-close'); super().close()
    class S3:
        def get_object(self, **kwargs):
            assert kwargs == {'Bucket': 'fixture', 'Key': key}
            return {'Body': Body(content)}
        def close(self): events.append('client-close')
    monkeypatch.setattr(storage.settings, 'S3_BUCKET_NAME', 'fixture')
    monkeypatch.setattr(storage.settings, 'AWS_REGION', 'fixture-region')
    monkeypatch.setattr(storage.boto3, 'client', lambda *args, **kwargs: S3())
    assert storage.read_owned_recipe_image(account_id=owner, storage_kind='s3', object_key=key, bucket='fixture', region='fixture-region') == (content, mime)
    assert events == [('read', 10 * 1024 * 1024 + 1), 'body-close', 'client-close']
    with pytest.raises(storage.MenuRecipeImageUnavailable):
        storage.read_owned_recipe_image(account_id=owner, storage_kind='s3', object_key=key, bucket='untrusted', region='fixture-region')


@pytest.mark.parametrize('content', [b'<svg onload="alert(1)"/>', PNG + b'x' * (10 * 1024 * 1024)])
def test_local_bad_signature_and_oversize_fail_closed(monkeypatch, tmp_path, content):
    from app.services import menu_recipe_images as storage
    owner = str(uuid4()); key = f'recipes/{owner}/{uuid4().hex}.png'
    path = tmp_path / key; path.parent.mkdir(parents=True); path.write_bytes(content)
    monkeypatch.setattr(storage.settings, 'LOCAL_IMAGE_UPLOAD_DIR', str(tmp_path))
    with pytest.raises(storage.MenuRecipeImageUnavailable):
        storage.read_owned_recipe_image(account_id=owner, storage_kind='local', object_key=key, bucket='', region='')
