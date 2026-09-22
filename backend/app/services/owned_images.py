"""Reserve image ownership durably before starting storage work."""
import mimetypes
import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import case, func, select, update

from app.core.config import settings
from app.db import session as db
from app.db.account_models import OwnedImageModel
from app.db.repo_accounts import lock_user


async def reserve_owned_image(user_id, auth_version: int, content_type: str, base_url: str):
    image_id = uuid.uuid4()
    ext = mimetypes.guess_extension(content_type) or ".bin"
    key = f"recipes/{user_id}/{image_id.hex}{ext}"
    bucket, region = settings.S3_BUCKET_NAME, settings.AWS_REGION
    kind = "s3" if bucket and region else "local"
    file_url = (f"https://{bucket}.s3.{region}.amazonaws.com/{key}" if kind == "s3"
                else f"{base_url.rstrip('/')}/uploads/{key}")
    if db.async_session_maker is None:
        db.init_engine()
    async with db.async_session_maker.begin() as session:
        user = await lock_user(session, user_id)
        if user is None or user.auth_version != auth_version:
            raise HTTPException(401, "Session expired. Please sign in again.")
        now = (await session.execute(select(func.clock_timestamp()))).scalar_one()
        session.add(OwnedImageModel(id=image_id, owner_id=user_id, storage_kind=kind,
            bucket=bucket if kind == "s3" else "", region=region if kind == "s3" else "",
            object_key=key, file_url=file_url, state="pending_upload",
            next_attempt_at=now + timedelta(minutes=5)))
    return {"id": image_id, "object_key": key, "file_url": file_url, "storage_kind": kind}


async def finish_owned_upload(image_id):
    async with db.async_session_maker.begin() as session:
        # If deletion was requested while storage ran, the request remains queued.
        # Once cleanup starts, never reopen image reference admission: an older
        # worker may still be deleting the object. Invalidate its lease and queue
        # another idempotent delete after this late write has settled.
        await session.execute(update(OwnedImageModel).where(OwnedImageModel.id == image_id).values(
            state=case((OwnedImageModel.state.in_(["deleting", "deleted"]), "deleting"), else_="active"),
            lease_id=None, next_attempt_at=func.clock_timestamp() + timedelta(minutes=5)))
