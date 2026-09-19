"""Real PostgreSQL money races and leases. Only explicit disposable test DBs."""
import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, update

from app.core.ai_cost import Price
from app.db import repo_ai_cost as repo
from app.db.ai_cost_models import AICallLedgerModel, AIInflightLeaseModel, AIMonthlyBudgetModel
from app.db.repo_ai_usage import AIUsageLimitExceeded
from test_postgres_integrations import pg_sessions

PRICE = Price('gpt-4o-mini', 'test-fixed-rates', Decimal('1'), Decimal('1'))


@pytest_asyncio.fixture
async def accounting(pg_sessions):
    async with pg_sessions.begin() as session:
        for model in [AICallLedgerModel, AIMonthlyBudgetModel, AIInflightLeaseModel]:
            await session.execute(delete(model))
    return pg_sessions


async def reserve(factory, account='one', global_cap=10000, account_cap=10000):
    call_id = uuid4()
    async with factory() as session:
        try:
            await repo.reserve_call(session, call_id=call_id, request_id=uuid4(), account_id=account,
                operation='test', price=PRICE, input_bound=3, output_bound=3,
                global_cap=global_cap, account_cap=account_cap)
            await session.commit()
            return call_id
        except AIUsageLimitExceeded:
            await session.rollback()
            return None


@pytest.mark.asyncio
async def test_concurrent_money_cap_never_overspends(accounting):
    results = await asyncio.gather(*(reserve(accounting, account=str(i)) for i in range(12)))
    assert sum(call is not None for call in results) == 1
    async with accounting() as session:
        global_row = (await session.execute(select(AIMonthlyBudgetModel).where(
            AIMonthlyBudgetModel.scope == 'global'))).scalar_one()
        assert global_row.reserved_nano == 6000
        assert (await session.execute(select(func.count()).select_from(AICallLedgerModel))).scalar_one() == 1


@pytest.mark.asyncio
async def test_account_cap_rollback_does_not_leak_global_reservation(accounting):
    assert await reserve(accounting, global_cap=100000, account_cap=10000)
    assert await reserve(accounting, global_cap=100000, account_cap=10000) is None
    async with accounting() as session:
        rows = (await session.execute(select(AIMonthlyBudgetModel))).scalars().all()
        assert len(rows) == 2
        assert all(row.reserved_nano == 6000 for row in rows)


@pytest.mark.asyncio
async def test_unknown_and_cancelled_usage_keep_reservation_and_reconcile_once(accounting):
    call_id = await reserve(accounting)
    async with accounting.begin() as session:
        await repo.reconcile_call(session, call_id)
    async with accounting() as session:
        ledger = await session.get(AICallLedgerModel, call_id)
        assert ledger.status == 'unknown' and ledger.actual_nano is None
        assert all(row.reserved_nano == 6000 for row in (await session.execute(select(AIMonthlyBudgetModel))).scalars())
    async def finish():
        async with accounting.begin() as session:
            await repo.reconcile_call(session, call_id, input_tokens=1, output_tokens=1)
    await asyncio.gather(*(finish() for _ in range(4)))
    async with accounting() as session:
        assert all(row.reserved_nano == 0 and row.spent_nano == 2000 for row in (
            await session.execute(select(AIMonthlyBudgetModel))).scalars())


@pytest.mark.asyncio
async def test_old_month_reconcile_cannot_refund_new_month(accounting, monkeypatch):
    async def january(session):
        return datetime(2026, 1, 31, 23, 59, tzinfo=timezone.utc)
    async def february(session):
        return datetime(2026, 2, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(repo, 'db_now', january)
    jan_call = await reserve(accounting)
    monkeypatch.setattr(repo, 'db_now', february)
    assert await reserve(accounting)
    async with accounting.begin() as session:
        await repo.reconcile_call(session, jan_call, denied=True)
    async with accounting() as session:
        rows = (await session.execute(select(AIMonthlyBudgetModel).where(
            AIMonthlyBudgetModel.scope == 'global').order_by(AIMonthlyBudgetModel.month))).scalars().all()
        assert [row.reserved_nano for row in rows] == [0, 6000]


@pytest.mark.asyncio
async def test_concurrency_caps_and_crashed_process_lease_expiry(accounting):
    async def acquire(account):
        request_id = uuid4()
        async with accounting() as session:
            try:
                await repo.acquire_lease(session, account, request_id, global_limit=2, account_limit=1, ttl=30)
                await session.commit()
                return request_id
            except AIUsageLimitExceeded:
                await session.rollback()
                return None
    results = await asyncio.gather(*(acquire('same') for _ in range(10)))
    assert sum(result is not None for result in results) == 1
    assert await acquire('different')
    assert await acquire('third') is None
    async with accounting.begin() as session:
        await session.execute(update(AIInflightLeaseModel).values(expires_at=func.clock_timestamp()-timedelta(seconds=1)))
    recovered = await acquire('same')
    assert recovered
    async with accounting.begin() as session:
        await repo.release_lease(session, next(result for result in results if result))
    async with accounting() as session:
        assert await session.get(AIInflightLeaseModel, recovered)
