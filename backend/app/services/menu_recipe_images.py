"""Read exportable recipe photos from recorded ownership coordinates, never URLs."""
import re
from uuid import UUID

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings
from app.services.recipe_image_service import MAX_IMAGE_BYTES
from app.services.storage_service import get_local_upload_root, matches_image_signature

TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}


class MenuRecipeImageUnavailable(Exception):
    def __init__(self, status_code=503):
        self.status_code = status_code
        super().__init__("This recipe photo is not available for menu export.")


def read_owned_recipe_image(*, account_id: str, storage_kind: str, object_key: str, bucket: str, region: str) -> tuple[bytes, str]:
    account = str(UUID(account_id))
    match = re.fullmatch(rf"recipes/{re.escape(account)}/[a-f0-9]{{32}}\.(png|jpg|jpeg|gif|webp)", object_key)
    if not match:
        raise MenuRecipeImageUnavailable()
    content_type = TYPES[match.group(1)]
    try:
        if storage_kind == "local":
            root = get_local_upload_root()
            candidate = root / object_key
            path = candidate.resolve()
            if (not path.is_relative_to(root / "recipes" / account)
                    or any(part.is_symlink() for part in (candidate, candidate.parent, candidate.parent.parent))):
                raise MenuRecipeImageUnavailable()
            with path.open("rb") as source:
                content = source.read(MAX_IMAGE_BYTES + 1)
        elif storage_kind == "s3":
            if not settings.S3_BUCKET_NAME or not settings.AWS_REGION or bucket != settings.S3_BUCKET_NAME or region != settings.AWS_REGION:
                raise MenuRecipeImageUnavailable()
            client = boto3.client("s3", region_name=region,
                config=Config(connect_timeout=5, read_timeout=15, retries={"total_max_attempts": 1}))
            try:
                result = client.get_object(Bucket=bucket, Key=object_key)
                source = result["Body"]
                try:
                    content = source.read(MAX_IMAGE_BYTES + 1)
                finally:
                    source.close()
            finally:
                client.close()
        else:
            raise MenuRecipeImageUnavailable()
        if not content or len(content) > MAX_IMAGE_BYTES or not matches_image_signature(content, content_type):
            raise MenuRecipeImageUnavailable()
        return content, content_type
    except MenuRecipeImageUnavailable:
        raise
    except FileNotFoundError:
        raise MenuRecipeImageUnavailable(404) from None
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        raise MenuRecipeImageUnavailable(404 if code in {"NoSuchKey", "404", "NotFound"} else 503) from None
    except Exception:
        raise MenuRecipeImageUnavailable() from None
