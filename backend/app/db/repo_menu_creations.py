"""Durable menu sessions: one admission per UTC day, with idempotent retries."""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AIUsageCounterModel, MenuCreationModel
from app.db.repo_ai_usage import counter_statement
from app.db.repo_recipe_images import database_now, image_admin

DAILY_LIMIT = 1


def creation_scope(user_id: UUID) -> str:
    return f"menu:create:user:{user_id}"


def utc_window(now: datetime) -> tuple[int, datetime]:
    timestamp = int(now.timestamp())
    start = timestamp - timestamp % 86400
    return start, datetime.fromtimestamp(start + 86400, timezone.utc)


class MenuDailyLimitExceeded(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = max(1, retry_after)
        super().__init__("Your daily menu has been created. You can create another after the daily reset.")


async def menu_access(session: AsyncSession, user_id: UUID) -> dict:
    now = await database_now(session)
    start, resets_at = utc_window(now)
    admin = image_admin(user_id)
    used = (await session.execute(select(AIUsageCounterModel.request_count).where(
        AIUsageCounterModel.scope == creation_scope(user_id),
        AIUsageCounterModel.window_seconds == 86400,
        AIUsageCounterModel.window_start == start,
    ))).scalar_one_or_none() or 0
    remaining = max(0, DAILY_LIMIT - used)
    return {"allowed": admin or remaining > 0, "is_admin": admin,
            "daily_limit": None if admin else DAILY_LIMIT,
            "remaining": None if admin else remaining, "resets_at": resets_at}


async def find_creation(session: AsyncSession, user_id: UUID, request_id: UUID):
    return (await session.execute(select(MenuCreationModel).where(
        MenuCreationModel.user_id == user_id, MenuCreationModel.request_id == request_id,
    ))).scalar_one_or_none()


async def create_menu(session: AsyncSession, user_id: UUID, request_id: UUID) -> MenuCreationModel:
    """Caller commits once; any rejection rolls back both row and counter."""
    existing = await find_creation(session, user_id, request_id)
    if existing is not None:
        return existing
    now = await database_now(session)
    created = (await session.execute(insert(MenuCreationModel).values(
        user_id=user_id, request_id=request_id, created_at=now,
    ).on_conflict_do_nothing(index_elements=["user_id", "request_id"])
       .returning(MenuCreationModel.request_id))).scalar_one_or_none()
    if created is not None and not image_admin(user_id):
        start, resets_at = utc_window(now)
        counter = (await session.execute(counter_statement(creation_scope(user_id), 86400, start, DAILY_LIMIT))).scalar_one_or_none()
        if counter is None:
            raise MenuDailyLimitExceeded(int(resets_at.timestamp()) - int(now.timestamp()))
    row = await find_creation(session, user_id, request_id)
    assert row is not None
    return row
