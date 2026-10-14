"""Canonical photo-set identity; customer media is private until reviewed."""
import hashlib
import json
import re
from urllib.parse import urlsplit

from app.core.config import settings


def is_immutable_app_media_url(value: str | None) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        return False
    key = r"recipes/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[a-f0-9]{32}\.(?:png|jpg|jpeg|jpe|gif|webp)"
    local_origin = (settings.PUBLIC_API_ORIGIN or "").rstrip("/")
    if local_origin and value.startswith(local_origin + "/uploads/"):
        return bool(re.fullmatch("/uploads/" + key, parsed.path))
    bucket, region = (settings.S3_BUCKET_NAME or "").strip(), (settings.AWS_REGION or "").strip()
    return bool(bucket and region and parsed.scheme == "https"
                and parsed.netloc == f"{bucket}.s3.{region}.amazonaws.com"
                and re.fullmatch("/" + key, parsed.path))


def has_immutable_app_media(recipe) -> bool:
    steps = getattr(recipe, "steps", [])
    if isinstance(steps, str):
        try:
            steps = json.loads(steps)
        except ValueError:
            steps = []
    urls = [getattr(recipe, "thumbnail_url", None)] + [
        step.get("image_url") if isinstance(step, dict) else getattr(step, "image_url", None) for step in steps]
    return any(is_immutable_app_media_url(url) for url in urls)


def recipe_media_digest(recipe) -> str | None:
    thumbnail = getattr(recipe, 'thumbnail_url', None)
    steps = getattr(recipe, 'steps', [])
    if isinstance(steps, str):
        try:
            steps = json.loads(steps)
        except ValueError:
            steps = []
    urls = [step.get('image_url') if isinstance(step, dict) else getattr(step, 'image_url', None)
            for step in steps if isinstance(step, dict) or hasattr(step, 'image_url')]
    if not thumbnail and not any(urls):
        return None
    canonical = json.dumps({'thumbnail_url': thumbnail or None, 'step_image_urls': urls},
                           ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


def shared_media_status(recipe) -> str:
    digest = recipe_media_digest(recipe)
    if digest is None:
        return 'none'
    if getattr(recipe, 'approved_media_digest', None) == digest:
        return 'approved'
    if getattr(recipe, 'rejected_media_digest', None) == digest:
        return 'rejected'
    return 'pending'



def immutable_media_predicate(column):
    """Canonical uploaded thumbnail eligibility for bounded summary queries."""
    from sqlalchemy import false, or_
    key = r"recipes/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[a-f0-9]{32}\.(png|jpg|jpeg|jpe|gif|webp)"
    patterns = []
    if settings.PUBLIC_API_ORIGIN:
        patterns.append('^' + re.escape(settings.PUBLIC_API_ORIGIN.rstrip('/') + '/uploads/') + key + '$')
    if settings.S3_BUCKET_NAME and settings.AWS_REGION:
        origin = f'https://{settings.S3_BUCKET_NAME}.s3.{settings.AWS_REGION}.amazonaws.com/'
        patterns.append('^' + re.escape(origin) + key + '$')
    return or_(*(column.op('~')(pattern) for pattern in patterns)) if patterns else false()
