"""Durable image admission, account entitlements, and independent atomic quotas."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from types import SimpleNamespace
from typing import Literal

from sqlalchemy import DateTime, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.admin import is_admin
from app.core.ai_cost import configured_image_price, IMAGE_OUTPUT_TOKEN_BOUND, MENU_ARTWORK_OUTPUT_TOKEN_BOUND, usd_to_nano
from app.db import repo_ai_cost
from app.db.ai_cost_models import AIMonthlyBudgetModel
from app.db.upload_budget_models import UploadBudgetModel
from app.db.models import AIUsageCounterModel, FeatureEntitlementModel, RecipeImageGenerationModel
from app.db.repo_ai_usage import counter_statement, AIUsageLimitExceeded
from app.services.recipe_image_service import ImageGenerationError, image_input_bound
from app.services.menu_artwork_service import menu_artwork_input_bound

FEATURE_KEY = "recipe_image_generation"
ImagePurpose = Literal["recipe_cover", "menu_artwork"]
ImageStorageKind = Literal["local", "s3"]


def image_admin(user_id: UUID) -> bool:
    return is_admin(SimpleNamespace(id=user_id))


def daily_limit(user_id: UUID) -> int:
    return settings.AI_IMAGE_ADMIN_REQUESTS_PER_DAY if image_admin(user_id) else settings.AI_IMAGE_USER_REQUESTS_PER_DAY


async def check_storage_capacity(session, user_id):
    rows = (await session.execute(select(UploadBudgetModel).where(
        UploadBudgetModel.scope.in_(['global', f'user:{user_id}'])))).scalars().all()
    for row in rows:
        count_cap, byte_cap = ((settings.UPLOAD_GLOBAL_TOTAL_COUNT, settings.UPLOAD_GLOBAL_TOTAL_BYTES)
            if row.scope == 'global' else (settings.UPLOAD_ACCOUNT_TOTAL_COUNT, settings.UPLOAD_ACCOUNT_TOTAL_BYTES))
        if row.object_count >= count_cap or row.byte_count >= byte_cap:
            raise ImageGenerationError('storage_limit', 'Your image storage allowance is full. Contact support before generating more images.', 429)


async def database_now(session: AsyncSession) -> datetime:
    return (await session.execute(select(func.clock_timestamp(type_=DateTime(timezone=True))))).scalar_one()


def request_hash(recipe: dict) -> str:
    return hashlib.sha256(json.dumps(recipe, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def _configured_access() -> str | None:
    if not settings.AI_IMAGE_GENERATION_ENABLED:
        return "disabled"
    if not (settings.OPENAI_API_KEY or "").strip():
        return "unavailable"
    try:
        configured_image_price(settings)
    except ValueError:
        return 'unavailable'
    if settings.AI_MONTHLY_BUDGET_USD <= 0:
        return 'unavailable'
    return None


async def _has_entitlement(session: AsyncSession, user_id: UUID, now: datetime) -> bool:
    if settings.AI_IMAGE_ACCESS_MODE == "registered" or image_admin(user_id):
        return True
    grant = await session.execute(select(FeatureEntitlementModel.user_id).where(
        FeatureEntitlementModel.user_id == user_id,
        FeatureEntitlementModel.feature_key == FEATURE_KEY,
        or_(FeatureEntitlementModel.expires_at.is_(None), FeatureEntitlementModel.expires_at > now),
    ))
    return grant.scalar_one_or_none() is not None


async def image_access(session: AsyncSession, user_id: UUID) -> dict:
    now = await database_now(session)
    timestamp = int(now.timestamp())
    start = timestamp - timestamp % 86400
    counters = (await session.execute(select(AIUsageCounterModel).where(
        AIUsageCounterModel.scope.in_(["image:global", f"image:user:{user_id}"]),
        AIUsageCounterModel.window_seconds == 86400,
        AIUsageCounterModel.window_start == start,
    ))).scalars().all()
    used = {row.scope: row.request_count for row in counters}
    limit = daily_limit(user_id)
    remaining = max(0, limit - used.get(f"image:user:{user_id}", 0))
    reason = _configured_access()
    if reason is None and not await _has_entitlement(session, user_id, now):
        reason = "membership_required"
    if reason is None and remaining == 0:
        reason = "daily_limit"
    if reason is None and used.get("image:global", 0) >= settings.AI_IMAGE_GLOBAL_REQUESTS_PER_DAY:
        reason = "global_limit"
    if reason is None:
        money = (await session.execute(select(AIMonthlyBudgetModel).where(
            AIMonthlyBudgetModel.month == now.date().replace(day=1),
            AIMonthlyBudgetModel.scope.in_(['global', f'user:{user_id}'])))).scalars().all()
        for row in money:
            cap = settings.AI_MONTHLY_BUDGET_USD if row.scope == 'global' or image_admin(user_id) else settings.AI_ACCOUNT_MONTHLY_BUDGET_USD
            if row.spent_nano + row.reserved_nano >= usd_to_nano(cap):
                reason = 'global_limit' if row.scope == 'global' else 'unavailable'
        if not image_admin(user_id) and settings.AI_ACCOUNT_MONTHLY_BUDGET_USD <= 0:
            reason = 'unavailable'
        try:
            await check_storage_capacity(session, user_id)
        except ImageGenerationError:
            reason = 'unavailable'
    return {
        "enabled": _configured_access() is None,
        "allowed": reason is None,
        "reason": reason,
        "daily_limit": limit,
        "remaining": remaining,
        "resets_at": datetime.fromtimestamp(start + 86400, timezone.utc),
    }


async def _find_existing_request(
    session: AsyncSession,
    user_id: UUID,
    request_id: UUID,
) -> RecipeImageGenerationModel | None:
    where = (
        RecipeImageGenerationModel.user_id == user_id,
        RecipeImageGenerationModel.request_id == request_id,
    )
    return (await session.execute(select(RecipeImageGenerationModel).where(*where)
                                  .execution_options(populate_existing=True))).scalar_one_or_none()


async def find_request(session: AsyncSession, user_id: UUID, request_id: UUID,
                       *, purpose: ImagePurpose = "recipe_cover",
                       now: datetime | None = None) -> RecipeImageGenerationModel | None:
    now = now or await database_now(session)
    where = (
        RecipeImageGenerationModel.user_id == user_id,
        RecipeImageGenerationModel.request_id == request_id,
        RecipeImageGenerationModel.purpose == purpose,
    )
    # Conditional UPDATE cannot overwrite a completion that committed while this
    # read waited. A process crash/ambiguous timeout never authorizes a retry.
    await session.execute(
        update(RecipeImageGenerationModel)
        .where(
            *where,
            RecipeImageGenerationModel.status == "pending",
            RecipeImageGenerationModel.deadline_at <= now,
        )
        .values(status="failed", error_code="generation_interrupted")
        .execution_options(synchronize_session=False)
    )
    return (await session.execute(select(RecipeImageGenerationModel).where(*where)
                                  .execution_options(populate_existing=True))).scalar_one_or_none()


def _validate_replay(row: RecipeImageGenerationModel, digest: str, purpose: ImagePurpose) -> None:
    if row.purpose != purpose:
        raise ImageGenerationError(
            "request_conflict",
            "This image request ID was already used for a different image request.",
            409,
        )
    if row.request_hash != digest:
        raise ImageGenerationError(
            "request_conflict",
            "This image request ID was already used for a different recipe.",
            409,
        )


async def begin_generation(session: AsyncSession, user_id: UUID, request_id: UUID,
                           recipe: dict, *, purpose: ImagePurpose = "recipe_cover",
                           ) -> tuple[RecipeImageGenerationModel, bool]:
    """Caller commits before provider work; every rejection rolls back all caps."""
    now = await database_now(session)
    digest = request_hash(recipe)
    existing = await _find_existing_request(session, user_id, request_id)
    if existing is not None:
        _validate_replay(existing, digest, purpose)
        existing = await find_request(
            session, user_id, request_id, purpose=purpose, now=now
        )
        assert existing is not None
        return existing, False
    reason = _configured_access()
    if reason is not None:
        raise ImageGenerationError(reason, "AI images are temporarily unavailable.")
    if not await _has_entitlement(session, user_id, now):
        raise ImageGenerationError("membership_required", "AI images require an active membership.", 403)
    await check_storage_capacity(session, user_id)

    ledger_call_id = uuid4()
    created = await session.execute(insert(RecipeImageGenerationModel).values(
        user_id=user_id, request_id=request_id, request_hash=digest, purpose=purpose,
        status="pending", created_at=now, ledger_call_id=ledger_call_id,
        deadline_at=now + timedelta(seconds=settings.OPENAI_IMAGE_TIMEOUT_SECONDS + 75),
    ).on_conflict_do_nothing(index_elements=["user_id", "request_id"]).returning(RecipeImageGenerationModel.request_id))
    if created.scalar_one_or_none() is None:
        # A contender may have committed between our read and atomic INSERT.
        existing = await _find_existing_request(session, user_id, request_id)
        assert existing is not None
        _validate_replay(existing, digest, purpose)
        existing = await find_request(session, user_id, request_id, purpose=purpose)
        assert existing is not None
        return existing, False

    timestamp = int(now.timestamp())
    limits = (
        ("image:global", 60, settings.AI_IMAGE_GLOBAL_REQUESTS_PER_MINUTE, "global_limit"),
        ("image:global", 86400, settings.AI_IMAGE_GLOBAL_REQUESTS_PER_DAY, "global_limit"),
        (f"image:user:{user_id}", 60, settings.AI_IMAGE_USER_REQUESTS_PER_MINUTE, "rate_limited"),
        (f"image:user:{user_id}", 86400, daily_limit(user_id), "daily_limit"),
    )
    for scope, period, limit, code in limits:
        start = timestamp - timestamp % period
        result = await session.execute(counter_statement(scope, period, start, limit))
        if result.scalar_one_or_none() is None:
            message = "Your daily AI image allowance is used up." if code == "daily_limit" else "AI image requests are limited. Please try again later."
            raise ImageGenerationError(code, message, 429, start + period - timestamp)
    try:
        # Same durable transaction as request/counters: rejected money or lease
        # admission cannot consume a daily allowance. Share global text/video
        # concurrency and money controls, while keeping image attempt caps separate.
        await repo_ai_cost.acquire_lease(session, str(user_id), ledger_call_id,
            global_limit=settings.AI_GLOBAL_MAX_INFLIGHT, account_limit=settings.AI_USER_MAX_INFLIGHT,
            ttl=settings.OPENAI_IMAGE_TIMEOUT_SECONDS + 75)
    except AIUsageLimitExceeded as exc:
        raise ImageGenerationError('rate_limited', 'AI generation is busy. Please try again shortly.', 429, exc.retry_after) from None
    try:
        await repo_ai_cost.reserve_call(session, call_id=ledger_call_id, request_id=request_id,
            account_id=str(user_id), operation="menu_artwork" if purpose == "menu_artwork" else FEATURE_KEY,
            price=configured_image_price(settings),
            input_bound=menu_artwork_input_bound(recipe) if purpose == "menu_artwork" else image_input_bound(recipe),
            output_bound=MENU_ARTWORK_OUTPUT_TOKEN_BOUND if purpose == "menu_artwork" else IMAGE_OUTPUT_TOKEN_BOUND,
            global_cap=usd_to_nano(settings.AI_MONTHLY_BUDGET_USD),
            account_cap=usd_to_nano(settings.AI_MONTHLY_BUDGET_USD if image_admin(user_id)
                                    else settings.AI_ACCOUNT_MONTHLY_BUDGET_USD))
    except AIUsageLimitExceeded as exc:
        raise ImageGenerationError('budget_limit', 'The monthly AI allowance cannot cover another image. Please try again after it resets.', 429, exc.retry_after) from None
    row = await find_request(session, user_id, request_id, purpose=purpose, now=now)
    assert row is not None
    return row, True


async def finish_generation(session: AsyncSession, user_id: UUID, request_id: UUID,
                            *, purpose: ImagePurpose = "recipe_cover",
                            file_url: str | None = None, error_code: str | None = None,
                            storage_kind: ImageStorageKind | None = None,
                            storage_key: str | None = None) -> RecipeImageGenerationModel:
    now = await database_now(session)
    await session.execute(update(RecipeImageGenerationModel).where(
        RecipeImageGenerationModel.user_id == user_id,
        RecipeImageGenerationModel.request_id == request_id,
        RecipeImageGenerationModel.purpose == purpose,
        RecipeImageGenerationModel.status == "pending",
        RecipeImageGenerationModel.deadline_at > now,
    ).values(
        status="completed" if file_url else "failed",
        file_url=file_url,
        error_code=error_code,
        storage_kind=storage_kind,
        storage_key=storage_key,
    ).execution_options(synchronize_session=False))
    row = await find_request(session, user_id, request_id, purpose=purpose, now=now)
    assert row is not None
    return row
