"""
S3 presigned URL generation for direct browser uploads.
Uses AWS_REGION and S3_BUCKET_NAME from app config (env).
When S3 is not configured, saves files under the local upload root and returns a public file_url only.
"""
import mimetypes
import uuid
from pathlib import Path

import boto3

from app.core.config import settings


def get_local_upload_root() -> Path:
    raw = (settings.LOCAL_IMAGE_UPLOAD_DIR or "").strip()
    if raw:
        p = Path(raw)
        return p.resolve() if p.is_absolute() else (Path.cwd() / p).resolve()
    return (Path.cwd() / "uploads").resolve()


def save_recipe_image_local(content: bytes, content_type: str) -> str:
    """
    Write image bytes to local disk. Returns URL path segment starting with /uploads/...
    """
    root = get_local_upload_root()
    recipes_dir = root / "recipes"
    recipes_dir.mkdir(parents=True, exist_ok=True)
    ext = mimetypes.guess_extension(content_type) or ".bin"
    key = f"{uuid.uuid4().hex}{ext}"
    path = recipes_dir / key
    path.write_bytes(content)
    return f"/uploads/recipes/{key}"


def generate_image_upload_url(content_type: str) -> dict[str, str]:
    """
    Generate a presigned URL that allows the browser to upload
    an image directly to S3.
    """
    if not settings.AWS_REGION or not settings.S3_BUCKET_NAME:
        raise ValueError(
            "AWS_REGION and S3_BUCKET_NAME must be set for image uploads. "
            "Configure them in .env or environment."
        )

    s3_client = boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
    )

    file_id = uuid.uuid4().hex
    ext = mimetypes.guess_extension(content_type) or ""
    key = f"recipes/{file_id}{ext}"

    url = s3_client.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": settings.S3_BUCKET_NAME,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=300,
    )

    public_url = f"https://{settings.S3_BUCKET_NAME}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"

    return {
        "upload_url": url,
        "file_url": public_url,
    }
