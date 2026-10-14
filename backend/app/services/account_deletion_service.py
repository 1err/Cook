"""Idempotent account-prefix media erasure with database-backed retries."""
from __future__ import annotations

import logging
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

import boto3
from botocore.config import Config
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.db import session as db_session
from app.db.models import AccountMediaCleanupModel

logger = logging.getLogger(__name__)


def erase_account_media(account_id: UUID, local_upload_root: str,
                        s3_bucket: str | None, s3_region: str | None) -> None:
    """Only the account UUID prefix is eligible; random legacy keys are untouched."""
    owner = str(UUID(str(account_id)))
    root = Path(local_upload_root).resolve()
    for namespace in ("recipes", "menu-artwork"):
        owned = root / namespace / owner
        if owned.is_symlink() or not owned.resolve().is_relative_to(root):
            raise ValueError("Unsafe account media path")
        if owned.exists():
            shutil.rmtree(owned)
    if not s3_bucket or not s3_region:
        return
    client = boto3.client("s3", region_name=s3_region,
        config=Config(connect_timeout=5, read_timeout=15, retries={"total_max_attempts": 1}))
    try:
        # Include menu assets and every historical version/deletion marker.
        for namespace in ("recipes", "menu-artwork"):
            prefix = f"{namespace}/{owner}/"
            for page in client.get_paginator("list_object_versions").paginate(Bucket=s3_bucket, Prefix=prefix):
                objects = [{"Key": item["Key"], "VersionId": item["VersionId"]}
                           for group in ("Versions", "DeleteMarkers") for item in page.get(group, [])]
                if any(not item["Key"].startswith(prefix) for item in objects):
                    raise ValueError("Storage returned an object outside the owned prefix")
                for start in range(0, len(objects), 1000):
                    result = client.delete_objects(Bucket=s3_bucket, Delete={"Objects": objects[start:start+1000], "Quiet": True})
                    if result.get("Errors"):
                        raise OSError("Account media deletion was incomplete")
    finally:
        client.close()


async def process_one_cleanup(session: AsyncSession) -> bool:
    now = datetime.now(timezone.utc)
    row = (await session.execute(select(AccountMediaCleanupModel).where(
        AccountMediaCleanupModel.available_at <= now,
    ).order_by(AccountMediaCleanupModel.available_at).limit(1).with_for_update(skip_locked=True))).scalars().one_or_none()
    if row is None:
        return False
    try:
        await run_in_threadpool(erase_account_media, row.account_id, row.local_upload_root, row.s3_bucket, row.s3_region)
    except Exception as exc:
        row.attempts += 1
        row.available_at = now + timedelta(seconds=min(3600, 60 * 2 ** min(row.attempts - 1, 6)))
        # No account email, image URL, storage error body or secret in logs.
        logger.warning("account_media_cleanup_retry attempts=%d error_type=%s", row.attempts, type(exc).__name__)
        await session.flush()
    else:
        await session.execute(delete(AccountMediaCleanupModel).where(AccountMediaCleanupModel.account_id == row.account_id))
    return True


async def run_account_media_cleanup() -> None:
    factory = db_session.async_session_maker
    if factory is None:
        return
    # A small bounded batch per tick; SKIP LOCKED permits safe multiple replicas.
    for _ in range(20):
        async with factory() as session:
            try:
                found = await process_one_cleanup(session)
                await session.commit()
            except Exception as exc:
                await session.rollback()
                logger.warning("account_media_cleanup_worker_failed error_type=%s", type(exc).__name__)
                return
        if not found:
            return
