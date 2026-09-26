"""Account-scoped artwork storage and bounded retrieval without URL fetching."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Literal
from uuid import UUID, uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings
from app.services.recipe_image_service import MAX_IMAGE_BYTES, ImageGenerationError
from app.services.storage_service import get_local_upload_root, matches_image_signature


@dataclass(frozen=True)
class StoredMenuArtwork:
    file_url: str
    storage_kind: Literal["local", "s3"]
    storage_key: str


class MenuArtworkStorageError(ImageGenerationError):
    def __init__(self, status_code: int = 503):
        super().__init__("asset_unavailable", "Menu artwork is unavailable. Please try again.", status_code)


def _account_prefix(account_id: str) -> str:
    try:
        account = str(UUID(account_id))
    except (ValueError, AttributeError, TypeError):
        raise MenuArtworkStorageError() from None
    return f"menu-artwork/{account}/"


def _validate_key(storage_key: str, account_id: str) -> None:
    prefix = _account_prefix(account_id)
    if not isinstance(storage_key, str) or "\\" in storage_key or "\0" in storage_key:
        raise MenuArtworkStorageError()
    path = PurePosixPath(storage_key)
    if (not storage_key.startswith(prefix) or path.is_absolute()
            or len(path.parts) != 3 or ".." in path.parts
            or path.as_posix() != storage_key or path.suffix != ".png"):
        raise MenuArtworkStorageError()


def _local_path(storage_key: str, account_id: str) -> Path:
    root = get_local_upload_root()
    account_root = root / _account_prefix(account_id)
    path = (root / storage_key).resolve()
    # Do not follow a symlink out of this account's directory, even if its
    # target remains somewhere else inside the upload root.
    if not path.is_relative_to(root) or not path.is_relative_to(account_root):
        raise MenuArtworkStorageError()
    return path


def _validate_png(content: bytes) -> bytes:
    if (not content or len(content) > MAX_IMAGE_BYTES
            or not matches_image_signature(content, "image/png")):
        raise MenuArtworkStorageError()
    return content


def _s3_client():
    if not settings.AWS_REGION or not settings.S3_BUCKET_NAME:
        raise MenuArtworkStorageError()
    return boto3.client("s3", region_name=settings.AWS_REGION,
        config=Config(connect_timeout=5, read_timeout=15, retries={"total_max_attempts": 1}))


def save_menu_artwork(content: bytes, account_id: str, storage_key: str | None = None) -> StoredMenuArtwork:
    """Called in a bounded worker pool, storing exactly the validated PNG."""
    _validate_png(content)
    key = storage_key or f"{_account_prefix(account_id)}{uuid4().hex}.png"
    _validate_key(key, account_id)
    try:
        if settings.AWS_REGION and settings.S3_BUCKET_NAME:
            client = _s3_client()
            try:
                client.put_object(Bucket=settings.S3_BUCKET_NAME, Key=key,
                    ContentType="image/png", ContentLength=len(content), Body=content)
            finally:
                client.close()
            return StoredMenuArtwork(
                f"https://{settings.S3_BUCKET_NAME}.s3.{settings.AWS_REGION}.amazonaws.com/{key}", "s3", key)
        path = _local_path(key, account_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as target:
            target.write(content)
        return StoredMenuArtwork(f"/uploads/{key}", "local", key)
    except MenuArtworkStorageError:
        raise
    except Exception:
        raise MenuArtworkStorageError() from None


def read_menu_artwork(storage_kind: str, storage_key: str, account_id: str) -> bytes:
    """Read only a saved descriptor, capped before PNG signature validation."""
    _validate_key(storage_key, account_id)
    try:
        if storage_kind == "local":
            path = _local_path(storage_key, account_id)
            if not path.is_file():
                raise MenuArtworkStorageError(404)
            with path.open("rb") as source:
                return _validate_png(source.read(MAX_IMAGE_BYTES + 1))
        if storage_kind != "s3":
            raise MenuArtworkStorageError()
        client = _s3_client()
        try:
            result = client.get_object(Bucket=settings.S3_BUCKET_NAME, Key=storage_key)
            body = result["Body"]
            try:
                return _validate_png(body.read(MAX_IMAGE_BYTES + 1))
            finally:
                body.close()
        finally:
            client.close()
    except MenuArtworkStorageError:
        raise
    except FileNotFoundError:
        raise MenuArtworkStorageError(404) from None
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        raise MenuArtworkStorageError(404 if code in {"NoSuchKey", "404", "NotFound"} else 503) from None
    except Exception:
        raise MenuArtworkStorageError() from None
