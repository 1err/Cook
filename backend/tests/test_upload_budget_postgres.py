import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.db.repo_upload_budget import UploadAllowanceExceeded, reserve_storage
from app.db.upload_budget_models import UploadBudgetModel
from test_postgres_integrations import pg_sessions


async def reserve(factory, account, global_scope, *, size=3, global_count=100,
                  account_count=100, global_bytes=100, account_bytes=100):
    try:
        async with factory.begin() as session:
            await reserve_storage(session, account, size, global_count=global_count,
                account_count=account_count, global_bytes=global_bytes,
                account_bytes=account_bytes, global_scope=global_scope)
        return True
    except UploadAllowanceExceeded:
        return False


@pytest.mark.asyncio
async def test_shared_cumulative_storage_is_bounded_across_accounts(pg_sessions):
    scope = f"global:{uuid4()}"
    outcomes = await asyncio.gather(*(reserve(pg_sessions, str(uuid4()), scope,
        global_bytes=10) for _ in range(20)))
    assert sum(outcomes) == 3
    async with pg_sessions() as session:
        row = await session.get(UploadBudgetModel, scope)
        assert (row.object_count, row.byte_count) == (3, 9)


@pytest.mark.asyncio
async def test_account_rejection_rolls_back_global_storage(pg_sessions):
    scope, account = f"global:{uuid4()}", str(uuid4())
    assert await reserve(pg_sessions, account, scope, account_count=1)
    assert not await reserve(pg_sessions, account, scope, account_count=1)
    async with pg_sessions() as session:
        rows = (await session.execute(select(UploadBudgetModel).where(
            UploadBudgetModel.scope.in_([scope, f"user:{account}"])
        ))).scalars().all()
        assert len(rows) == 2 and all(row.object_count == 1 and row.byte_count == 3 for row in rows)


@pytest.mark.asyncio
async def test_first_oversize_storage_attempt_does_not_create_counter(pg_sessions):
    scope, account = f"global:{uuid4()}", str(uuid4())
    assert not await reserve(pg_sessions, account, scope, size=101)
    async with pg_sessions() as session:
        assert await session.get(UploadBudgetModel, scope) is None
