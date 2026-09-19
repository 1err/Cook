"""Short, atomic transactions; callers commit before any provider work."""
from datetime import timezone, timedelta
from uuid import UUID

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert

from app.core.ai_cost import Price, estimate_cost_nano
from app.db.ai_cost_models import AICallLedgerModel, AIInflightLeaseModel, AIMonthlyBudgetModel
from app.db.repo_ai_usage import AIUsageLimitExceeded


async def db_now(session):
    return (await session.execute(select(func.clock_timestamp()))).scalar_one().astimezone(timezone.utc)


def money_reservation_statement(scope, month, amount, cap):
    table = AIMonthlyBudgetModel.__table__
    # A first insert must respect the cap too (ON CONFLICT WHERE only protects updates).
    if amount <= 0 or amount > cap:
        raise AIUsageLimitExceeded(3600)
    statement = insert(table).values(scope=scope, month=month, reserved_nano=amount, spent_nano=0)
    return statement.on_conflict_do_update(
        index_elements=[table.c.scope, table.c.month],
        set_={'reserved_nano': table.c.reserved_nano + amount},
        where=table.c.reserved_nano + table.c.spent_nano + amount <= cap,
    ).returning(table.c.reserved_nano)


async def reserve_call(session, *, call_id: UUID, request_id: UUID, account_id: str,
                       operation: str, price: Price, input_bound: int, output_bound: int,
                       global_cap: int, account_cap: int):
    month = (await db_now(session)).date().replace(day=1)
    amount = estimate_cost_nano(price, input_bound, output_bound)
    for scope, cap in [('global', global_cap), (f'user:{account_id}', account_cap)]:
        result = await session.execute(money_reservation_statement(scope, month, amount, cap))
        if result.scalar_one_or_none() is None:
            raise AIUsageLimitExceeded(3600)
    session.add(AICallLedgerModel(id=call_id, request_id=request_id, account_id=account_id,
                                month=month, operation=operation[:64], model=price.model,
                                price_version=price.version, input_rate=price.input_usd_per_million,
                                output_rate=price.output_usd_per_million, reserved_nano=amount,
                                status='reserved'))


async def reconcile_call(session, call_id: UUID, *, input_tokens=None, output_tokens=None,
                         denied=False, provider_request_id=None):
    row = (await session.execute(select(AICallLedgerModel).where(
        AICallLedgerModel.id == call_id).with_for_update())).scalar_one()
    if row.status in {'completed', 'denied'}:
        return  # Repeated reconciliation must never refund a reservation twice.
    if not denied and (type(input_tokens) is not int or type(output_tokens) is not int
                       or input_tokens < 0 or output_tokens < 0):
        row.status = 'unknown'
        return  # Preserve the full reservation for timeout/missing usage.
    price = Price(row.model, row.price_version, row.input_rate, row.output_rate)
    amount = 0 if denied else estimate_cost_nano(price, input_tokens, output_tokens)
    for scope in ['global', f'user:{row.account_id}']:
        await session.execute(update(AIMonthlyBudgetModel).where(
            AIMonthlyBudgetModel.scope == scope, AIMonthlyBudgetModel.month == row.month).values(
                reserved_nano=AIMonthlyBudgetModel.reserved_nano - row.reserved_nano,
                spent_nano=AIMonthlyBudgetModel.spent_nano + amount))
    row.actual_nano = amount
    row.input_tokens = None if denied else input_tokens
    row.output_tokens = None if denied else output_tokens
    row.provider_request_id = str(provider_request_id)[:256] if provider_request_id else None
    row.status = 'denied' if denied else 'completed'


async def acquire_lease(session, account_id, request_id, *, global_limit, account_limit, ttl):
    # Transaction-level lock serializes the count+insert across every replica.
    await session.execute(text('SELECT pg_advisory_xact_lock(731915092)'))
    now = await db_now(session)
    await session.execute(delete(AIInflightLeaseModel).where(AIInflightLeaseModel.expires_at <= now))
    global_count = (await session.execute(select(func.count()).select_from(AIInflightLeaseModel))).scalar_one()
    account_count = (await session.execute(select(func.count()).select_from(AIInflightLeaseModel).where(
        AIInflightLeaseModel.account_id == account_id))).scalar_one()
    if global_count >= global_limit or account_count >= account_limit:
        raise AIUsageLimitExceeded(max(1, int(ttl)))
    session.add(AIInflightLeaseModel(id=request_id, account_id=account_id,
                                    expires_at=now + timedelta(seconds=ttl)))


async def release_lease(session, request_id):
    await session.execute(delete(AIInflightLeaseModel).where(AIInflightLeaseModel.id == request_id))
