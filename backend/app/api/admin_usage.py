"""Read-only accounting totals; no prompts, messages, or recipe contents."""
from decimal import Decimal
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import require_admin
from app.core.config import settings
from app.core.ai_cost import APP_AI_HARD_CAP_NANO, usd_to_nano
from app.db.ai_cost_models import AIMonthlyBudgetModel, AICallLedgerModel, AIInflightLeaseModel
from app.db.repo_ai_cost import db_now
from app.db.session import get_session
from app.db.upload_budget_models import UploadBudgetModel

router = APIRouter(prefix='/admin', tags=['admin'])


def usd(nano):
    return str(Decimal(nano or 0) / 1_000_000_000)


@router.get('/ai-usage', dependencies=[Depends(require_admin)])
async def ai_usage(session: AsyncSession = Depends(get_session),
                   limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=10000)):
    now = await db_now(session)
    month = now.date().replace(day=1)
    query = select(AIMonthlyBudgetModel).where(AIMonthlyBudgetModel.month == month)
    global_row = (await session.execute(query.where(AIMonthlyBudgetModel.scope == 'global'))).scalar_one_or_none()
    rows = (await session.execute(query.where(AIMonthlyBudgetModel.scope != 'global').order_by(
        AIMonthlyBudgetModel.scope).limit(limit + 1).offset(offset))).scalars().all()
    global_cap = min(usd_to_nano(settings.AI_MONTHLY_BUDGET_USD), APP_AI_HARD_CAP_NANO)
    account_cap = min(usd_to_nano(settings.AI_ACCOUNT_MONTHLY_BUDGET_USD), global_cap)
    def totals(row, cap):
        reserved, spent = (row.reserved_nano, row.spent_nano) if row else (0, 0)
        return {'reserved_usd': usd(reserved), 'spent_usd': usd(spent),
                'remaining_usd': usd(max(0, cap - reserved - spent))}
    tokens = (await session.execute(select(func.sum(AICallLedgerModel.input_tokens),
        func.sum(AICallLedgerModel.output_tokens), func.count()).where(AICallLedgerModel.month == month))).one()
    inflight = (await session.execute(select(func.count()).select_from(AIInflightLeaseModel).where(
        AIInflightLeaseModel.expires_at > now))).scalar_one()
    return {'month_utc': month.isoformat(), 'global': totals(global_row, global_cap),
            'monthly_cap_usd': usd(global_cap),
            'account_monthly_cap_usd': usd(account_cap),
            'hard_monthly_cap_usd': usd(APP_AI_HARD_CAP_NANO),
            'scope': 'App-managed model calls admitted in this UTC month; excludes other key usage, taxes and hosting.',
            'input_tokens': tokens[0] or 0, 'output_tokens': tokens[1] or 0,
            'provider_call_reservations': tokens[2], 'inflight_operations': inflight,
            'accounts': [{'account_id': row.scope.removeprefix('user:'), **totals(row, account_cap)} for row in rows[:limit]],
            'has_more': len(rows) > limit}


@router.get('/operating-limits', dependencies=[Depends(require_admin)])
async def operating_limits(session: AsyncSession = Depends(get_session)):
    """Configured ceilings and cumulative upload reservation; never credentials."""
    storage = await session.get(UploadBudgetModel, 'global')
    return {
        'monthly_budget_usd': str(settings.OPERATING_MONTHLY_BUDGET_USD),
        'hosting_reserve_usd': str(settings.HOSTING_MONTHLY_RESERVE_USD),
        'hosting_fields_scope': 'Historical planning only; no combined hosting budget is enforced.',
        'ai_monthly_budget_usd': str(settings.AI_MONTHLY_BUDGET_USD),
        'ai_hard_monthly_cap_usd': usd(APP_AI_HARD_CAP_NANO),
        'billing_verified': False,
        'ai_operations': {'account_per_minute': settings.AI_USER_REQUESTS_PER_MINUTE,
                          'account_per_day': settings.AI_USER_REQUESTS_PER_DAY,
                          'app_per_minute': settings.AI_GLOBAL_REQUESTS_PER_MINUTE,
                          'app_per_day': settings.AI_GLOBAL_REQUESTS_PER_DAY,
                          'app_inflight': settings.AI_GLOBAL_MAX_INFLIGHT,
                          'operation_timeout_seconds': settings.AI_OPERATION_TIMEOUT_SECONDS},
        'uploads': {'account_per_hour': settings.UPLOAD_ACCOUNT_PER_HOUR,
                    'account_bytes_per_day': settings.UPLOAD_ACCOUNT_BYTES_PER_DAY,
                    'account_total_count': settings.UPLOAD_ACCOUNT_TOTAL_COUNT,
                    'account_total_bytes': settings.UPLOAD_ACCOUNT_TOTAL_BYTES,
                    'app_total_count': settings.UPLOAD_GLOBAL_TOTAL_COUNT,
                    'app_total_bytes': settings.UPLOAD_GLOBAL_TOTAL_BYTES,
                    'reserved_count': storage.object_count if storage else 0,
                    'reserved_bytes': storage.byte_count if storage else 0,
                    'scope': 'cumulative reservations since inventory baseline; includes uncertain writes'},
        'store_jobs': {'mode': settings.STORE_JOBS_MODE, 'queue_max': settings.STORE_JOBS_QUEUE_MAX,
                       'max_attempts': settings.STORE_JOBS_MAX_ATTEMPTS,
                       'timeout_seconds': settings.STORE_JOBS_TIMEOUT_SECONDS},
        'store_requests': {'global_per_minute': settings.STORE_REQUEST_GLOBAL_PER_MINUTE,
                           'account_per_minute': settings.STORE_REQUEST_ACCOUNT_PER_MINUTE,
                           'global_inflight': settings.STORE_REQUEST_GLOBAL_MAX_INFLIGHT,
                           'account_inflight': settings.STORE_REQUEST_ACCOUNT_MAX_INFLIGHT,
                           'timeout_seconds': settings.STORE_REQUEST_TIMEOUT_SECONDS,
                           'scope': 'Shared across API replicas; independent of durable jobs.'},
    }
