"""Atomically remove private account data and admit durable, conservative cleanup."""
import re
import uuid
from datetime import timedelta
from urllib.parse import urlsplit

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert

from app.core.config import settings
from app.db.account_models import OwnedImageModel, DeletedAccountModel
from app.db.models import AIUsageCounterModel, UserModel, RecipeModel, CookingSessionDishModel
from app.db.request_limit_models import RequestLimitModel
from app.db.upload_budget_models import UploadBudgetModel


def owned_s3_coordinates(url: str | None, owner_id) -> tuple[str, str, str] | None:
    """Legacy adoption requires the exact configured bucket and account namespace."""
    if not url or not settings.S3_BUCKET_NAME or not settings.AWS_REGION:
        return None
    parsed = urlsplit(url)
    host = f"{settings.S3_BUCKET_NAME}.s3.{settings.AWS_REGION}.amazonaws.com"
    pattern = rf"recipes/{re.escape(str(owner_id))}/[a-f0-9]{{32}}\.(?:png|jpg|jpeg|gif|webp)"
    key = parsed.path.removeprefix("/")
    if (parsed.scheme != "https" or parsed.netloc != host or parsed.query or parsed.fragment
            or not re.fullmatch(pattern, key)):
        return None
    return settings.S3_BUCKET_NAME, settings.AWS_REGION, key


async def delete_user_and_queue_cleanup(session, user) -> None:
    # Adopt old S3 uploads only where ownership is provable. Old local uploads
    # lacked ownership information and are retained for a separate inventory.
    urls = (await session.execute(select(RecipeModel.thumbnail_url).where(
        RecipeModel.user_id == user.id, RecipeModel.thumbnail_url.is_not(None)))).scalars().all()
    for url in set(urls):
        owned = owned_s3_coordinates(url, user.id)
        if owned:
            bucket, region, key = owned
            await session.execute(insert(OwnedImageModel).values(id=uuid.uuid4(), owner_id=user.id,
                storage_kind="s3", bucket=bucket, region=region, object_key=key, file_url=url,
                state="active", cleanup_requested=True, attempts=0).on_conflict_do_nothing())
    await session.execute(update(OwnedImageModel).where(OwnedImageModel.owner_id == user.id,
        OwnedImageModel.state != "deleted").values(cleanup_requested=True))
    account = str(user.id)
    await session.execute(delete(AIUsageCounterModel).where(AIUsageCounterModel.scope.in_(
        [f"user:{account}", f"image:user:{account}", f"menu:create:user:{account}"])))
    await session.execute(delete(UploadBudgetModel).where(UploadBudgetModel.scope == f"user:{account}"))
    # Monetary ledgers and account/global money reservations remain untouched so
    # already-admitted calls can reconcile and deletion cannot refund app spend.
    from app.api.abuse import private_scope
    scopes = [private_scope(kind, value) for kind, value in (
        ("login-account", user.email), ("register-account", user.email),
        ("account-email-address", user.email), ("upload-count", account), ("upload-bytes", account),
        ("store-account", account),
    )]
    await session.execute(delete(RequestLimitModel).where(RequestLimitModel.scope.in_(scopes)))
    # Email may be claimed by a new account later. Only UUID-derived scopes
    # belong to this tombstone; address-scoped admission is cleaned once above.
    recurring_scopes = [private_scope(kind, account) for kind in ("upload-count", "upload-bytes", "store-account")]
    session.add(DeletedAccountModel(user_id=user.id, request_scopes=recurring_scopes))
    # Database FK cascades remove identities, action links, sessions, recipes,
    # plans and cooking state in this transaction; the image queue survives it.
    await session.execute(delete(UserModel).where(UserModel.id == user.id))
    await session.flush()


def image_reference_condition(column, row):
    canonical = func.split_part(func.split_part(column, "?", 1), "#", 1)
    if row.storage_kind == "local":
        # Local image links may be relative or use another approved API hostname.
        return canonical.endswith(f"/uploads/{row.object_key}", autoescape=True)
    return canonical == row.file_url


async def claim_cleanup(session):
    now = (await session.execute(select(func.clock_timestamp()))).scalar_one()
    row = (await session.execute(select(OwnedImageModel).where(
        OwnedImageModel.cleanup_requested.is_(True), OwnedImageModel.state != "deleted",
        OwnedImageModel.next_attempt_at <= now).order_by(OwnedImageModel.next_attempt_at)
        .with_for_update(skip_locked=True).limit(1))).scalar_one_or_none()
    if row is None:
        return None
    # SELECTs happen after the row lock. Triggers on every image-reference writer
    # take that same lock before they can commit a new reference.
    referenced = any([
        (await session.execute(select(RecipeModel.id).where(image_reference_condition(RecipeModel.thumbnail_url, row)).limit(1))).first(),
        (await session.execute(select(CookingSessionDishModel.id).where(image_reference_condition(CookingSessionDishModel.thumbnail_url, row)).limit(1))).first(),
    ])
    if referenced:
        row.next_attempt_at = now + timedelta(hours=24)
        return None
    row.state = "deleting"
    row.lease_id = uuid.uuid4()
    row.attempts += 1
    row.next_attempt_at = now + timedelta(minutes=5)
    await session.flush()
    return {name: getattr(row, name) for name in (
        "id", "owner_id", "storage_kind", "bucket", "region", "object_key", "lease_id", "attempts")}


async def finish_cleanup(session, item, success: bool):
    values = ({"state": "deleted", "lease_id": None} if success else {
        "next_attempt_at": func.clock_timestamp() + timedelta(seconds=min(86400, 30 * 2 ** min(item["attempts"], 11)))})
    await session.execute(update(OwnedImageModel).where(OwnedImageModel.id == item["id"],
        OwnedImageModel.lease_id == item["lease_id"], OwnedImageModel.state == "deleting").values(**values))


async def sweep_deleted_counters(session):
    row = (await session.execute(select(DeletedAccountModel).where(
        DeletedAccountModel.next_attempt_at <= func.clock_timestamp())
        .order_by(DeletedAccountModel.next_attempt_at).with_for_update(skip_locked=True).limit(1))).scalar_one_or_none()
    if row is None:
        return
    account = str(row.user_id)
    await session.execute(delete(AIUsageCounterModel).where(AIUsageCounterModel.scope.in_(
        [f"user:{account}", f"image:user:{account}", f"menu:create:user:{account}"])))
    await session.execute(delete(UploadBudgetModel).where(UploadBudgetModel.scope == f"user:{account}"))
    await session.execute(delete(RequestLimitModel).where(RequestLimitModel.scope.in_(row.request_scopes)))
    row.next_attempt_at = func.clock_timestamp() + timedelta(hours=24)
