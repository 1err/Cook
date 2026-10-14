"""Storage erasure deletes owned S3 versions and retries partial provider failure."""
from uuid import UUID

import pytest
from app.services import account_deletion_service as cleanup


OWNER = UUID('10000000-0000-0000-0000-000000000001')
OWNED = f'recipes/{OWNER}/'+('a'*32)+'.png'
OTHER = 'recipes/10000000-0000-0000-0000-000000000002/'+('b'*32)+'.png'


class VersionedStorage:
    def __init__(self, fail=False):
        self.objects = {(OWNED, 'old'): b'old photo', (OWNED, 'new'): b'new photo',
                        (OWNED, 'marker'): None, (OTHER, 'keep'): b'other account'}
        self.fail = fail

    def get_paginator(self, operation):
        assert operation == 'list_object_versions'
        return self

    def paginate(self, *, Bucket, Prefix):
        assert Bucket == 'isolated-test-bucket'
        versions = [{'Key': key, 'VersionId': version} for (key, version), data in self.objects.items() if key.startswith(Prefix) and data is not None]
        markers = [{'Key': key, 'VersionId': version} for (key, version), data in self.objects.items() if key.startswith(Prefix) and data is None]
        yield {'Versions': versions, 'DeleteMarkers': markers}

    def delete_objects(self, *, Bucket, Delete):
        if self.fail:
            return {'Errors': [{'Code': 'AccessDenied'}]}
        for item in Delete['Objects']:
            self.objects.pop((item['Key'], item['VersionId']))
        return {}

    def delete_object(self, *, Bucket, Key):
        self.objects[(Key, "ordinary-delete-marker")] = None

    def close(self):
        pass


def test_owned_s3_versions_and_delete_markers_are_erased_while_other_account_is_retained(monkeypatch, tmp_path):
    storage = VersionedStorage()
    monkeypatch.setattr(cleanup.boto3, 'client', lambda *args, **kwargs: storage)
    cleanup.erase_account_media(OWNER, str(tmp_path), 'isolated-test-bucket', 'us-east-1')
    assert storage.objects == {(OTHER, 'keep'): b'other account'}


def test_partial_s3_deletion_is_not_reported_as_success_and_can_retry(monkeypatch, tmp_path):
    storage = VersionedStorage(fail=True)
    monkeypatch.setattr(cleanup.boto3, 'client', lambda *args, **kwargs: storage)
    with pytest.raises(OSError, match='incomplete'):
        cleanup.erase_account_media(OWNER, str(tmp_path), 'isolated-test-bucket', 'us-east-1')
    assert storage.objects[(OWNED, 'new')] == b'new photo'
    storage.fail = False
    cleanup.erase_account_media(OWNER, str(tmp_path), 'isolated-test-bucket', 'us-east-1')
    assert storage.objects == {(OTHER, 'keep'): b'other account'}



def test_account_prefix_cleanup_also_erases_menu_artwork_versions_and_local_files(monkeypatch, tmp_path):
    menu = f"menu-artwork/{OWNER}/" + "c" * 32 + ".png"
    storage = VersionedStorage()
    storage.objects[(menu, "old-menu")] = b"private menu artwork"
    directory = tmp_path / "menu-artwork" / str(OWNER)
    directory.mkdir(parents=True)
    (directory / "unsaved.png").write_bytes(b"private unsaved art")
    monkeypatch.setattr(cleanup.boto3, "client", lambda *args, **kwargs: storage)
    cleanup.erase_account_media(OWNER, str(tmp_path), "isolated-test-bucket", "us-east-1")
    assert not directory.exists()
    assert storage.objects == {(OTHER, "keep"): b"other account"}


def test_late_owned_upload_cleanup_erases_new_version_after_prefix_intent_drained(monkeypatch, tmp_path):
    from app.jobs.account_cleanup import delete_owned_object
    from app.core.config import settings
    storage = VersionedStorage()
    monkeypatch.setattr(cleanup.boto3, "client", lambda *args, **kwargs: storage)
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "isolated-test-bucket")
    monkeypatch.setattr(settings, "AWS_REGION", "us-east-1")
    cleanup.erase_account_media(OWNER, str(tmp_path), "isolated-test-bucket", "us-east-1")
    storage.objects[(OWNED, "late-upload")] = b"late private upload"
    delete_owned_object({"owner_id": OWNER, "storage_kind": "s3", "bucket": "isolated-test-bucket", "region": "us-east-1", "object_key": OWNED})
    assert storage.objects == {(OTHER, "keep"): b"other account"}
