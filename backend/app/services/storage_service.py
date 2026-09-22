"""
Validated recipe image storage, with one bounded upload through the backend.
Uses AWS_REGION and S3_BUCKET_NAME from app config (env).
When S3 is not configured, saves files under the local upload root and returns a public file_url only.
"""
import mimetypes
import uuid
from pathlib import Path

import boto3
from botocore.config import Config

from app.core.config import settings


def get_local_upload_root() -> Path:
    raw = (settings.LOCAL_IMAGE_UPLOAD_DIR or "").strip()
    if raw:
        p = Path(raw)
        return p.resolve() if p.is_absolute() else (Path.cwd() / p).resolve()
    return (Path.cwd() / "uploads").resolve()


def save_recipe_image_local(content: bytes, content_type: str, object_key: str | None = None) -> str:
    """
    Write image bytes to local disk. Returns URL path segment starting with /uploads/...
    """
    root = get_local_upload_root()
    recipes_dir = root / "recipes"
    recipes_dir.mkdir(parents=True, exist_ok=True)
    ext = mimetypes.guess_extension(content_type) or ".bin"
    key = f"{uuid.uuid4().hex}{ext}"
    relative = object_key or f"recipes/{key}"
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return f"/uploads/{relative}"


def save_recipe_image_s3(content: bytes, content_type: str, account_id: str, object_key: str | None = None) -> str:
    """Persist exactly the bytes validated by the route; no reusable PUT grant."""
    if not settings.AWS_REGION or not settings.S3_BUCKET_NAME:
        raise ValueError(
            "AWS_REGION and S3_BUCKET_NAME must be set for image uploads. "
            "Configure them in .env or environment."
        )

    s3_client = boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        config=Config(connect_timeout=5, read_timeout=15, retries={"total_max_attempts": 1}),
    )

    file_id = uuid.uuid4().hex
    ext = mimetypes.guess_extension(content_type) or ""
    key = object_key or f"recipes/{account_id}/{file_id}{ext}"

    try:
        s3_client.put_object(Bucket=settings.S3_BUCKET_NAME, Key=key,
                             ContentType=content_type, ContentLength=len(content), Body=content)
    finally:
        s3_client.close()
    return f"https://{settings.S3_BUCKET_NAME}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"


def matches_image_signature(content: bytes, content_type: str) -> bool:
    """Reject mislabeled active content. This is a signature check, not decoding."""
    if content_type == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/gif":
        return content.startswith((b"GIF87a", b"GIF89a"))
    return (content_type == "image/webp" and content.startswith(b"RIFF")
            and content[8:12] == b"WEBP")
