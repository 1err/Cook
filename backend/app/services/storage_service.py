"""
S3 presigned URL generation for direct browser uploads.
Uses AWS_REGION and S3_BUCKET_NAME from app config (env).
"""
import mimetypes
import uuid

import boto3

from app.core.config import settings


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
