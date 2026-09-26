"""Retryable account image cleanup and counter/token maintenance across replicas."""
import asyncio
import logging
import re

import boto3
from botocore.config import Config
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.db import session as db
from app.db.repo_account_cleanup import claim_cleanup, finish_cleanup, sweep_deleted_counters
from app.db.repo_accounts import prune_expired_auth
from app.services.storage_service import get_local_upload_root

logger = logging.getLogger(__name__)
_task = None
_stop = None


def delete_owned_object(item):
    # Coordinates must remain a server-generated namespace even if an operator
    # accidentally writes an invalid queue entry. Never fetch/delete a URL.
    owner = re.escape(str(item["owner_id"]))
    pattern = rf"(?:recipes/{owner}/[a-f0-9]{{32}}\.(?:png|jpg|jpeg|gif|webp)|menu-artwork/{owner}/[a-f0-9]{{32}}\.png)"
    if not re.fullmatch(pattern, item["object_key"]):
        raise ValueError("Invalid owned object key")
    if item["storage_kind"] == "local":
        root = get_local_upload_root()
        candidate = root / item["object_key"]
        path = candidate.resolve()
        if (not path.is_relative_to(root)
                or any(component.is_symlink() for component in (candidate, *candidate.parents) if component != root.parent)):
            raise ValueError("Invalid owned local path")
        path.unlink(missing_ok=True)
    elif item["storage_kind"] == "s3":
        if item["bucket"] != settings.S3_BUCKET_NAME or item["region"] != settings.AWS_REGION:
            raise ValueError("Owned storage destination is no longer configured")
        client = boto3.client("s3", region_name=item["region"],
            config=Config(connect_timeout=5, read_timeout=15, retries={"total_max_attempts": 1}))
        try:
            client.delete_object(Bucket=item["bucket"], Key=item["object_key"])
        finally:
            client.close()
    else:
        raise ValueError("Invalid owned storage kind")


async def process_one(factory=None):
    factory = factory or db.async_session_maker
    if factory is None:
        return False
    async with factory.begin() as session:
        item = await claim_cleanup(session)
    if item is None:
        return False
    success = False
    try:
        await run_in_threadpool(delete_owned_object, item)
        success = True
    except Exception:
        logger.warning("account_image_cleanup_retry")
    async with factory.begin() as session:
        await finish_cleanup(session, item, success)
    return True


async def _run():
    while not _stop.is_set():
        try:
            if db.async_session_maker is not None:
                async with db.async_session_maker.begin() as session:
                    await prune_expired_auth(session)
                    await sweep_deleted_counters(session)
                # Bounded work per cycle keeps cleanup from dominating the pool.
                for _ in range(10):
                    if _stop.is_set() or not await process_one():
                        break
        except Exception:
            logger.warning("account_cleanup_unavailable")
        try:
            await asyncio.wait_for(_stop.wait(), settings.ACCOUNT_CLEANUP_POLL_SECONDS)
        except asyncio.TimeoutError:
            pass


def start_account_cleanup():
    global _task, _stop
    if not settings.ACCOUNT_CLEANUP_ENABLED or (_task is not None and not _task.done()):
        return
    _stop = asyncio.Event()
    _task = asyncio.create_task(_run())


async def shutdown_account_cleanup():
    global _task
    if _task is None:
        return
    _stop.set()
    # Storage calls have at most 20 seconds of configured network timeout. Allow
    # them to settle; durable leases make interruption retryable at next startup.
    try:
        await asyncio.wait_for(asyncio.shield(_task), timeout=25)
    except asyncio.TimeoutError:
        _task.cancel()
        await asyncio.gather(_task, return_exceptions=True)
    finally:
        _task = None
