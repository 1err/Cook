"""Shared auth/upload admission against an explicit disposable PostgreSQL DB."""
import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import select, update

from app.db.repo_request_limits import RequestLimit, RequestLimitExceeded, reserve_request_limits
from app.db.request_limit_models import RequestLimitModel
from test_postgres_integrations import pg_sessions


async def admit(factory, limits):
    try:
        async with factory.begin() as session:
            await reserve_request_limits(session, limits)
        return True
    except RequestLimitExceeded:
        return False


@pytest.mark.asyncio
async def test_concurrent_requests_share_one_allowance(pg_sessions):
    scope = f"test:{uuid4()}"
    limit = RequestLimit(scope, 86400, 5)
    results = await asyncio.gather(*(admit(pg_sessions, [limit]) for _ in range(24)))
    assert sum(results) == 5
    async with pg_sessions() as session:
        row = await session.get(RequestLimitModel, (scope, 86400))
        assert row.amount == 5


@pytest.mark.asyncio
async def test_rejected_account_rolls_back_global_reservation(pg_sessions):
    prefix = str(uuid4())
    global_limit = RequestLimit(f"a:{prefix}", 86400, 100)
    account_limit = RequestLimit(f"z:{prefix}", 86400, 1)
    assert await admit(pg_sessions, [global_limit, account_limit])
    assert not await admit(pg_sessions, [global_limit, account_limit])
    async with pg_sessions() as session:
        rows = (await session.execute(select(RequestLimitModel).where(
            RequestLimitModel.scope.in_([global_limit.scope, account_limit.scope])
        ))).scalars().all()
        assert len(rows) == 2 and all(row.amount == 1 for row in rows)


@pytest.mark.asyncio
async def test_upload_bytes_cannot_overspend_or_overflow_first_insert(pg_sessions):
    scope = f"bytes:{uuid4()}"
    assert not await admit(pg_sessions, [RequestLimit(scope, 86400, 10, amount=11)])
    results = await asyncio.gather(*(admit(pg_sessions, [
        RequestLimit(scope, 86400, 10, amount=3)
    ]) for _ in range(8)))
    assert sum(results) == 3
    async with pg_sessions() as session:
        assert (await session.get(RequestLimitModel, (scope, 86400))).amount == 9


@pytest.mark.asyncio
async def test_expired_window_resets_and_future_window_fails_closed(pg_sessions):
    scope = f"window:{uuid4()}"
    limit = RequestLimit(scope, 86400, 1)
    assert await admit(pg_sessions, [limit])
    async with pg_sessions.begin() as session:
        await session.execute(update(RequestLimitModel).where(RequestLimitModel.scope == scope).values(
            window_start=RequestLimitModel.window_start - 86400))
    assert await admit(pg_sessions, [limit])
    assert not await admit(pg_sessions, [limit])
    async with pg_sessions.begin() as session:
        await session.execute(update(RequestLimitModel).where(RequestLimitModel.scope == scope).values(
            window_start=RequestLimitModel.window_start + 86400))
    assert not await admit(pg_sessions, [limit])
