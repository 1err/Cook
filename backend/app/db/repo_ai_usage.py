"""Atomic AI admission counters; PostgreSQL owns the clock and shared limits."""
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import AIUsageCounterModel


class AIUsageLimitExceeded(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = max(1, retry_after)
        super().__init__("AI usage limit reached. Please try again after the limit resets.")


def counter_statement(scope: str, window_seconds: int, window_start: int, limit: int):
    """A rejected or stale contender returns no row and cannot modify a bucket."""
    table = AIUsageCounterModel.__table__
    statement = insert(table).values(scope=scope, window_seconds=window_seconds,
                                    window_start=window_start, request_count=1)
    new_window = table.c.window_start < statement.excluded.window_start
    return statement.on_conflict_do_update(
        index_elements=[table.c.scope, table.c.window_seconds],
        set_={"window_start": statement.excluded.window_start,
              "request_count": case((new_window, 1), else_=table.c.request_count + 1)},
        where=or_(new_window, and_(table.c.window_start == statement.excluded.window_start,
                                  table.c.request_count < limit)),
    ).returning(table.c.request_count)


async def reserve_ai_budget(session: AsyncSession, account_id: str) -> None:
    """Reserve all four counters in one transaction; caller commits before AI work.

    Requests admitted but later failing still count, preventing expensive retry
    loops. The independent per-call ledger reserves currency before each provider
    call; these four counters remain operation-level abuse limits.
    """
    now = (await session.execute(select(func.clock_timestamp()))).scalar_one()
    timestamp = int(now.timestamp())
    # Identical lock order across workers avoids deadlocks between global/user caps.
    limits = (
        ("global", 60, settings.AI_GLOBAL_REQUESTS_PER_MINUTE),
        ("global", 86400, settings.AI_GLOBAL_REQUESTS_PER_DAY),
        (f"user:{account_id}", 60, settings.AI_USER_REQUESTS_PER_MINUTE),
        (f"user:{account_id}", 86400, settings.AI_USER_REQUESTS_PER_DAY),
    )
    for scope, period, limit in limits:
        start = timestamp - timestamp % period
        result = await session.execute(counter_statement(scope, period, start, limit))
        if result.scalar_one_or_none() is None:
            raise AIUsageLimitExceeded(start + period - timestamp)
