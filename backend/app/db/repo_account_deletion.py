"""Atomic account erasure with a durable, narrowly owned media cleanup intent."""
from __future__ import annotations

import json
from uuid import UUID
from urllib.parse import urlsplit

from sqlalchemy import Text, cast, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import (
    AccountMediaCleanupModel, AIUsageCounterModel, CookingSessionDishModel,
    ContentReportModel, CookingSessionStepModel, RecipeMediaReviewModel, RecipeModel, UserModel,
)
from app.db.repo_auth import lock_account_erasure_barrier, lock_user_for_media_write
from app.services.storage_service import get_local_upload_root
from app.db.repo_account_cleanup import delete_user_and_queue_cleanup


def is_owned_media_url(value: str | None, account_id: UUID, bucket: str | None) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    prefix = f"/recipes/{account_id}/"
    if parsed.path.startswith(f"/uploads{prefix}"):
        return True
    host = (parsed.hostname or "").lower()
    return bool(bucket and host.startswith(f"{bucket.lower()}.s3.")
                and host.endswith(".amazonaws.com") and parsed.path.startswith(prefix))


async def delete_account(session: AsyncSession, account_id: UUID) -> bool:
    await lock_account_erasure_barrier(session)
    if not await lock_user_for_media_write(session, account_id):
        return False
    bucket = (settings.S3_BUCKET_NAME or "").strip() or None
    region = (settings.AWS_REGION or "").strip() or None
    # Copies and cook snapshots retain their text, but must not keep links to
    # the erased account's stored images. Historical random keys lack ownership
    # evidence and are deliberately outside automatic deletion.
    marker = str(account_id)
    rows = (await session.execute(select(RecipeModel).where(
        RecipeModel.user_id != account_id,
        or_(RecipeModel.thumbnail_url.contains(marker), RecipeModel.steps.contains(marker)),
    ).with_for_update())).scalars().all()
    for row in rows:
        if is_owned_media_url(row.thumbnail_url, account_id, bucket):
            row.thumbnail_url = None
        try:
            steps = json.loads(row.steps)
        except (TypeError, ValueError):
            continue
        changed = False
        if isinstance(steps, list):
            for step in steps:
                if isinstance(step, dict) and is_owned_media_url(step.get("image_url"), account_id, bucket):
                    step["image_url"] = None
                    changed = True
        if changed:
            row.steps = json.dumps(steps, ensure_ascii=False)
    for model in (ContentReportModel, RecipeMediaReviewModel):
        retained = (await session.execute(select(model).where(
            model.owner_id != account_id, cast(model.content_snapshot, Text).contains(marker),
        ).with_for_update())).scalars().all()
        for row in retained:
            snapshot = dict(row.content_snapshot)
            if is_owned_media_url(snapshot.get("thumbnail_url"), account_id, bucket):
                snapshot["thumbnail_url"] = None
            snapshot["steps"] = [
                {**step, "image_url": None} if isinstance(step, dict) and is_owned_media_url(step.get("image_url"), account_id, bucket) else step
                for step in snapshot.get("steps", [])
            ]
            row.content_snapshot = snapshot
    for model, field in ((CookingSessionDishModel, "thumbnail_url"), (CookingSessionStepModel, "image_url")):
        column = getattr(model, field)
        snapshots = (await session.execute(select(model).where(column.contains(marker)).with_for_update())).scalars().all()
        for row in snapshots:
            if is_owned_media_url(getattr(row, field), account_id, bucket):
                setattr(row, field, None)
    session.add(AccountMediaCleanupModel(account_id=account_id,
        local_upload_root=str(get_local_upload_root()),
        s3_bucket=bucket if region else None, s3_region=region if bucket else None))
    await session.flush()
    await session.execute(delete(AIUsageCounterModel).where(
        AIUsageCounterModel.scope.in_([f"user:{account_id}", f"image:user:{account_id}"]),
    ))
    # Review notes are authored by the deleting moderator; reports about other
    # accounts remain reviewable, with this author's contribution removed.
    await session.execute(update(ContentReportModel).where(ContentReportModel.reviewer_id == account_id)
                          .values(reviewer_id=None, resolution_notes=None))
    await session.execute(update(RecipeMediaReviewModel).where(RecipeMediaReviewModel.reviewer_id == account_id)
                          .values(reviewer_id=None, review_notes=None))
    user = (await session.execute(select(UserModel).where(UserModel.id == account_id))).scalar_one()
    await delete_user_and_queue_cleanup(session, user)
    return True
