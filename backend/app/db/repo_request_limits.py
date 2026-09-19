"""Cross-replica admission in one short transaction, using the database clock."""
from dataclasses import dataclass
import time

from sqlalchemy import and_, case, delete, func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert

from app.db.request_limit_models import RequestLimitModel


@dataclass(frozen=True)
class RequestLimit:
    scope: str
    window_seconds: int
    limit: int
    amount: int = 1

    def __post_init__(self):
        if not self.scope or len(self.scope) > 100 or min(self.window_seconds, self.limit, self.amount) < 1:
            raise ValueError("Invalid request limit")


class RequestLimitExceeded(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = max(1, retry_after)
        super().__init__("Request limit reached. Please try again later.")


async def reserve_request_limits(session, limits: list[RequestLimit]) -> None:
    now = int((await session.execute(select(func.clock_timestamp()))).scalar_one().timestamp())
    table = RequestLimitModel.__table__
    for item in sorted(limits, key=lambda item: (item.scope, item.window_seconds)):
        start = now - now % item.window_seconds
        if item.amount > item.limit:
            raise RequestLimitExceeded(start + item.window_seconds - now)
        statement = insert(table).values(scope=item.scope, window_seconds=item.window_seconds,
                                        window_start=start, amount=item.amount)
        newer = table.c.window_start < start
        statement = statement.on_conflict_do_update(
            index_elements=[table.c.scope, table.c.window_seconds],
            set_={"window_start": start, "amount": case((newer, item.amount), else_=table.c.amount + item.amount)},
            where=or_(newer, and_(table.c.window_start == start, table.c.amount <= item.limit - item.amount)),
        ).returning(table.c.amount)
        if (await session.execute(statement)).scalar_one_or_none() is None:
            raise RequestLimitExceeded(start + item.window_seconds - now)


_next_prune = 0.0


async def reserve_with_factory(limits: list[RequestLimit]) -> None:
    # Dynamic lookup keeps worker/test factories replaceable and avoids stale imports.
    from app.db import session as db
    if db.async_session_maker is None:
        db.init_engine()
    async with db.async_session_maker.begin() as session:
        await reserve_request_limits(session, limits)
    global _next_prune
    if time.monotonic() >= _next_prune:
        _next_prune = time.monotonic() + 60
        # Cleanup is independent of admission; a pruning failure cannot turn an
        # already admitted operation into an apparent rejection/retry loop.
        from sqlalchemy.exc import SQLAlchemyError
        try:
            async with db.async_session_maker.begin() as session:
                table = RequestLimitModel.__table__
                cutoff = func.extract("epoch", func.clock_timestamp()) - 86400
                expired = select(table.c.scope, table.c.window_seconds).where(
                    table.c.window_start + table.c.window_seconds < cutoff
                ).order_by(table.c.window_start).limit(1000).with_for_update(skip_locked=True)
                await session.execute(delete(table).where(tuple_(table.c.scope, table.c.window_seconds).in_(expired)))
        except SQLAlchemyError:
            import logging
            logging.getLogger(__name__).warning("request_limit_prune_failed")
