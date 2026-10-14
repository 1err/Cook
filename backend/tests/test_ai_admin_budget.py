"""Trusted admins share the global ceiling; ordinary accounts stay capped."""
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4
import time

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core import ai_context
from app.core.ai_context import AIRequestContext, reserve_provider_call
from app.core.ai_cost import Price
from app.db import repo_ai_cost
from app.db.ai_cost_models import AICallLedgerModel, AIMonthlyBudgetModel
from app.db.repo_ai_usage import AIUsageLimitExceeded


ADMIN = '11111111-1111-4111-8111-111111111111'
REGULAR = '22222222-2222-4222-8222-222222222222'
EDITOR = '33333333-3333-4333-8333-333333333333'
NOW = datetime(2026, 9, 30, tzinfo=timezone.utc)
VIDEO_PRICE = Price('gemini-3.5-flash-lite', 'test', Decimal('.30'), Decimal('2.50'))


@pytest.fixture
def money_store(monkeypatch):
    engine = create_engine('sqlite://')
    AIMonthlyBudgetModel.__table__.create(engine)
    AICallLedgerModel.__table__.create(engine)
    from readiness_schema import create_readiness_schema
    create_readiness_schema(engine, tombstones_only=True)

    async def now(_session):
        return NOW

    @asynccontextmanager
    async def factory():
        with Session(engine) as session:
            async def execute(statement):
                return session.execute(statement)

            async def commit():
                session.commit()

            yield SimpleNamespace(execute=execute, add=session.add, commit=commit, get_bind=session.get_bind)

    monkeypatch.setattr(repo_ai_cost, 'db_now', now)
    monkeypatch.setattr(ai_context, 'session_factory', lambda: factory)
    monkeypatch.setattr(ai_context.settings, 'AI_MONTHLY_BUDGET_USD', Decimal('29'))
    monkeypatch.setattr(ai_context.settings, 'AI_ACCOUNT_MONTHLY_BUDGET_USD', Decimal('3'))
    monkeypatch.setattr(ai_context.settings, 'ADMIN_USER_IDS', ADMIN)
    monkeypatch.setattr(ai_context.settings, 'PUBLIC_LIBRARY_EDITOR_USER_IDS', EDITOR)
    yield engine
    engine.dispose()


def seed(engine, account, *, account_spent=2_700_000_000, global_spent=2_700_000_000):
    with Session(engine) as session:
        for scope, spent in [('global', global_spent), ('user:' + account, account_spent)]:
            session.add(AIMonthlyBudgetModel(scope=scope, month=NOW.date().replace(day=1),
                                            spent_nano=spent, reserved_nano=0))
        session.commit()


async def reserve(account):
    context = AIRequestContext(account, uuid4(), time.monotonic() + 30)
    return await reserve_provider_call(context, None, 'video_analysis', price=VIDEO_PRICE,
                                      input_bound=1_048_576, output_bound=65_536)


@pytest.mark.asyncio
async def test_admin_can_reserve_after_the_regular_account_ceiling(money_store):
    seed(money_store, ADMIN)
    call_id = await reserve(ADMIN)
    with Session(money_store) as session:
        assert session.get(AICallLedgerModel, call_id).reserved_nano == 478_412_800
        buckets = session.execute(select(AIMonthlyBudgetModel)).scalars().all()
        assert len(buckets) == 2
        assert all(row.reserved_nano == 478_412_800 for row in buckets)


@pytest.mark.asyncio
@pytest.mark.parametrize('account', [REGULAR, EDITOR])
async def test_regular_and_catalog_editor_accounts_keep_their_personal_ceiling(money_store, account):
    seed(money_store, account)
    with pytest.raises(AIUsageLimitExceeded):
        await reserve(account)
    with Session(money_store) as session:
        assert not session.execute(select(AICallLedgerModel)).scalars().all()
        assert all(row.reserved_nano == 0 for row in session.execute(select(AIMonthlyBudgetModel)).scalars())


@pytest.mark.asyncio
async def test_admin_reservation_still_cannot_exceed_shared_twenty_nine_dollar_cap(money_store):
    seed(money_store, ADMIN, global_spent=28_700_000_000)
    with pytest.raises(AIUsageLimitExceeded):
        await reserve(ADMIN)
    with Session(money_store) as session:
        assert not session.execute(select(AICallLedgerModel)).scalars().all()
        assert all(row.reserved_nano == 0 for row in session.execute(select(AIMonthlyBudgetModel)).scalars())


@pytest.mark.asyncio
async def test_an_empty_admin_allowlist_never_grants_a_budget_exemption(money_store, monkeypatch):
    monkeypatch.setattr(ai_context.settings, 'ADMIN_USER_IDS', '')
    seed(money_store, ADMIN)
    with pytest.raises(AIUsageLimitExceeded):
        await reserve(ADMIN)
