"""Read-only provider usage estimates, with uncertainty and coverage explicit."""
from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, Response
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import require_admin
from app.core.ai_cost import APP_AI_HARD_CAP_NANO, usd_to_nano
from app.core.config import settings
from app.db.ai_cost_models import AICallLedgerModel, AIMonthlyBudgetModel
from app.db.models import RecipeImageGenerationModel
from app.db.repo_ai_cost import db_now
from app.db.session import get_session

router = APIRouter(prefix='/admin', tags=['admin'])


def usd(nano):
    return str(Decimal(nano or 0) / 1_000_000_000)


def summarize_calls(rows):
    counts = defaultdict(int)
    known = reserved = unknown_reserved = unpriced = input_tokens = output_tokens = 0
    for row in rows:
        count = getattr(row, 'call_count', 1)
        counts[row.status] += count
        input_tokens += row.input_tokens or 0
        output_tokens += row.output_tokens or 0
        if row.status in {'completed', 'denied'} and row.actual_nano is not None:
            known += row.actual_nano
        else:
            reserved += row.reserved_nano
            unpriced += count
            if row.status != 'reserved':
                unknown_reserved += row.reserved_nano
    return {'calls': sum(counts.values()), 'completed': counts['completed'],
            'failed': counts['denied'], 'pending': counts['reserved'], 'unknown': counts['unknown'],
            'input_tokens': input_tokens, 'output_tokens': output_tokens,
            'estimated_usd': usd(known), 'reserved_usd': usd(reserved),
            'unknown_reserved_usd': usd(unknown_reserved), 'unpriced_calls': unpriced}


def _category(model, operation):
    if operation == 'recipe_image_generation':
        return 'openai', 'image'
    if model.startswith('gemini-'):
        return 'google', 'video' if operation == 'video_analysis' else 'other'
    if model.startswith(('gpt-', 'o1', 'o3', 'o4')):
        return 'openai', 'text'
    return 'unknown', 'other'


@router.get('/ai-costs', dependencies=[Depends(require_admin)])
async def ai_costs(response: Response, session: AsyncSession = Depends(get_session)):
    response.headers['Cache-Control'] = 'no-store'
    now = await db_now(session)
    month = now.date().replace(day=1)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    ledger = AICallLedgerModel
    rows = (await session.execute(select(
        ledger.model, ledger.operation, ledger.status, func.count().label('call_count'),
        func.sum(ledger.actual_nano).label('actual_nano'),
        func.sum(ledger.reserved_nano).label('reserved_nano'),
        func.sum(ledger.input_tokens).label('input_tokens'),
        func.sum(ledger.output_tokens).label('output_tokens'),
    ).where(ledger.month == month).group_by(ledger.model, ledger.operation, ledger.status))).all()
    by_group = defaultdict(list)
    for row in rows:
        by_group[(row.model, row.operation)].append(row)
    groups = []
    for (model, operation), records in sorted(by_group.items()):
        provider, kind = _category(model, operation)
        groups.append({'provider': provider, 'kind': kind, 'model': model, 'operation': operation,
                       **summarize_calls(records)})
    first = (await session.execute(select(func.min(ledger.created_at)))).scalar_one()
    images = RecipeImageGenerationModel
    first_image = (await session.execute(select(func.min(images.created_at)))).scalar_one()
    image_status = case((
        (images.status == 'pending') & (images.deadline_at <= now), 'failed'), else_=images.status)
    image_counts = dict((await session.execute(select(image_status, func.count()).where(
        images.created_at >= start, images.created_at <= now,
    ).group_by(image_status))).all())
    budget = (await session.execute(select(AIMonthlyBudgetModel).where(
        AIMonthlyBudgetModel.scope == 'global', AIMonthlyBudgetModel.month == month))).scalar_one_or_none()
    cap = min(usd_to_nano(settings.AI_MONTHLY_BUDGET_USD), APP_AI_HARD_CAP_NANO)
    spent, reserved = (budget.spent_nano, budget.reserved_nano) if budget else (0, 0)
    return {'month_utc': month.isoformat(), 'generated_at': now.isoformat(),
        'period_start': start.isoformat(), 'period_end': now.isoformat(),
        'scope': 'Provider usage estimates from app-managed calls admitted this UTC month; '
                 'not provider invoices. Excludes pre-ledger activity, other key usage, taxes and hosting. '
                 'Failed means provider-denied; unknown/pending calls retain conservative reservations.',
        'coverage': {'first_recorded_at': first.isoformat() if first else None,
                     'image_first_recorded_at': first_image.isoformat() if first_image else None,
                     'complete_history': False},
        'budget': {'monthly_cap_usd': usd(cap), 'spent_usd': usd(spent), 'reserved_usd': usd(reserved),
                   'remaining_usd': usd(max(0, cap - spent - reserved)),
                   'account_monthly_cap_usd': usd(min(usd_to_nano(settings.AI_ACCOUNT_MONTHLY_BUDGET_USD), cap)),
                   'admin_image_account_cap_usd': usd(cap)},
        'totals': summarize_calls(rows), 'groups': groups,
        'images': {'requests': sum(image_counts.values()), 'completed': image_counts.get('completed', 0),
                   'failed': image_counts.get('failed', 0), 'pending': image_counts.get('pending', 0),
                   'admin_daily_limit': settings.AI_IMAGE_ADMIN_REQUESTS_PER_DAY,
                   'regular_daily_limit': settings.AI_IMAGE_USER_REQUESTS_PER_DAY}}
