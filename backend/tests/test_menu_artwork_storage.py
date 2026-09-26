"""Descriptors stay account scoped and reads consume bounded PNG bytes."""
import importlib.util
import io
from uuid import uuid4

import pytest

PNG = b"\x89PNG\r\n\x1a\nfixture"


@pytest.fixture
def storage(monkeypatch, tmp_path):
    assert importlib.util.find_spec("app.services.menu_artwork_storage"), "Menu artwork storage is missing"
    from app.services import menu_artwork_storage
    from app.core.config import settings
    monkeypatch.setattr(settings, "LOCAL_IMAGE_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "AWS_REGION", "")
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "")
    return menu_artwork_storage


@pytest.fixture
def account():
    return str(uuid4())


def test_local_roundtrip_scoped_random_descriptor(storage, account):
    saved = storage.save_menu_artwork(PNG, account)
    assert saved.storage_kind == "local" and saved.storage_key.startswith(f"menu-artwork/{account}/")
    assert saved.file_url == f"/uploads/{saved.storage_key}"
    assert storage.read_menu_artwork("local", saved.storage_key, account) == PNG
    assert storage.save_menu_artwork(PNG, account).storage_key != saved.storage_key


@pytest.mark.parametrize("key", ["../private.png", "/tmp/private.png", "menu-artwork/{account}/../private.png",
    "menu-artwork/{account}/../../private.png", "menu-artwork/{account}/./private.png",
    "menu-artwork/{account}/nested//private.png", "menu-artwork/{account}2/private.png",
    "menu-artwork/other/private.png", "menu-artwork/{account}/bad\\file.png", "https://private.invalid/file.png"])
@pytest.mark.parametrize("kind", ["local", "s3"])
def test_invalid_descriptor_never_reads(storage, account, key, kind, monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("Invalid key reached S3")
    monkeypatch.setattr(storage.boto3, "client", unexpected)
    with pytest.raises(storage.MenuArtworkStorageError):
        storage.read_menu_artwork(kind, key.format(account=account), account)


def test_local_symlink_escape_rejected(storage, account, tmp_path):
    other = tmp_path / "other-account.png"
    other.write_bytes(PNG)
    directory = tmp_path / "menu-artwork" / account
    directory.mkdir(parents=True)
    (directory / "escape.png").symlink_to(other)
    with pytest.raises(storage.MenuArtworkStorageError):
        storage.read_menu_artwork("local", f"menu-artwork/{account}/escape.png", account)


def test_save_rejects_symlink_account_directory(storage, account, tmp_path):
    other = tmp_path / "other-account"
    other.mkdir()
    (tmp_path / "menu-artwork").mkdir()
    (tmp_path / "menu-artwork" / account).symlink_to(other, target_is_directory=True)
    with pytest.raises(storage.MenuArtworkStorageError):
        storage.save_menu_artwork(PNG, account)
    assert not list(other.iterdir())


@pytest.mark.parametrize("content", [b"<html>private</html>", b"", b"\x89PNG\r\n\x1a\n" + b"x" * (10 * 1024 * 1024)], ids=["html", "empty", "oversized"])
def test_save_and_read_reject_invalid_png(storage, account, tmp_path, content):
    with pytest.raises(storage.MenuArtworkStorageError):
        storage.save_menu_artwork(content, account)
    target = tmp_path / "menu-artwork" / account / "bad.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    with pytest.raises(storage.MenuArtworkStorageError):
        storage.read_menu_artwork("local", f"menu-artwork/{account}/bad.png", account)


def test_missing_file_and_unknown_storage(storage, account):
    with pytest.raises(storage.MenuArtworkStorageError) as exc:
        storage.read_menu_artwork("local", f"menu-artwork/{account}/missing.png", account)
    assert exc.value.status_code == 404
    with pytest.raises(storage.MenuArtworkStorageError):
        storage.read_menu_artwork("url", "https://private.invalid", account)


class TrackedBody(io.BytesIO):
    def __init__(self, value, fail=False):
        super().__init__(value)
        self.read_sizes, self.fail = [], fail

    def read(self, size=-1):
        self.read_sizes.append(size)
        if self.fail:
            raise RuntimeError("private credential body")
        return super().read(size)


class FakeS3:
    def __init__(self, body, failure=None):
        self.body, self.failure = body, failure
        self.closed, self.puts, self.gets = False, [], []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)
        if self.failure:
            raise RuntimeError(self.failure)

    def get_object(self, **kwargs):
        self.gets.append(kwargs)
        if self.failure:
            raise RuntimeError(self.failure)
        return {"Body": self.body}

    def close(self):
        self.closed = True


def configure_s3(storage, monkeypatch, fake):
    from app.core.config import settings
    monkeypatch.setattr(settings, "AWS_REGION", "test-region")
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "test-bucket")
    def client(service, **kwargs):
        assert service == "s3" and kwargs["region_name"] == "test-region"
        assert kwargs["config"].retries == {"total_max_attempts": 1}
        assert kwargs["config"].connect_timeout <= 5 and kwargs["config"].read_timeout <= 15
        return fake
    monkeypatch.setattr(storage.boto3, "client", client)


def test_s3_save_and_bounded_read_close_resources(storage, account, monkeypatch):
    body = TrackedBody(PNG)
    fake = FakeS3(body)
    configure_s3(storage, monkeypatch, fake)
    saved = storage.save_menu_artwork(PNG, account)
    assert saved.storage_kind == "s3" and saved.storage_key.startswith(f"menu-artwork/{account}/")
    assert saved.file_url == f"https://test-bucket.s3.test-region.amazonaws.com/{saved.storage_key}"
    assert fake.closed and fake.puts[0] == {"Bucket": "test-bucket", "Key": saved.storage_key,
        "ContentType": "image/png", "ContentLength": len(PNG), "Body": PNG}
    fake.closed = False
    assert storage.read_menu_artwork("s3", saved.storage_key, account) == PNG
    assert fake.gets == [{"Bucket": "test-bucket", "Key": saved.storage_key}]
    assert body.read_sizes == [10 * 1024 * 1024 + 1] and body.closed and fake.closed


@pytest.mark.parametrize("failure", ["get", "read", "oversized", "signature"])
def test_s3_failures_close_and_sanitize(storage, account, monkeypatch, failure):
    body = TrackedBody(PNG if failure != "signature" else b"<html>secret</html>", fail=failure == "read")
    if failure == "oversized":
        body = TrackedBody(PNG + b"x" * (10 * 1024 * 1024))
    fake = FakeS3(body, "private credentials" if failure == "get" else None)
    configure_s3(storage, monkeypatch, fake)
    with pytest.raises(storage.MenuArtworkStorageError) as exc:
        storage.read_menu_artwork("s3", f"menu-artwork/{account}/image.png", account)
    assert "private" not in str(exc.value) and fake.closed
    if failure != "get":
        assert body.closed and body.read_sizes == [10 * 1024 * 1024 + 1]


def test_s3_failed_put_closes_client(storage, account, monkeypatch):
    fake = FakeS3(TrackedBody(PNG), "private credentials")
    configure_s3(storage, monkeypatch, fake)
    with pytest.raises(storage.MenuArtworkStorageError) as exc:
        storage.save_menu_artwork(PNG, account)
    assert fake.closed and "private" not in str(exc.value)


def test_local_read_is_bounded_before_validation(storage, account, monkeypatch):
    from pathlib import Path
    saved = storage.save_menu_artwork(PNG, account)
    original_open, reads = Path.open, []
    class TrackedFile:
        def __init__(self, handle):
            self.handle = handle
        def __enter__(self):
            return self
        def __exit__(self, *args):
            self.handle.close()
        def read(self, size):
            reads.append(size)
            return self.handle.read(size)
    def tracked_open(path, *args, **kwargs):
        return TrackedFile(original_open(path, *args, **kwargs))
    monkeypatch.setattr(Path, "open", tracked_open)
    assert storage.read_menu_artwork("local", saved.storage_key, account) == PNG
    assert reads == [10 * 1024 * 1024 + 1]


def test_s3_missing_key_maps_to_404_and_closes(storage, account, monkeypatch):
    from botocore.exceptions import ClientError
    fake = FakeS3(TrackedBody(PNG))
    def missing(**kwargs):
        raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "private key"}}, "GetObject")
    fake.get_object = missing
    configure_s3(storage, monkeypatch, fake)
    with pytest.raises(storage.MenuArtworkStorageError) as exc:
        storage.read_menu_artwork("s3", f"menu-artwork/{account}/missing.png", account)
    assert exc.value.status_code == 404 and fake.closed
    assert "private" not in str(exc.value)
