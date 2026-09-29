"""Request-owned admission context; never carries a DB transaction to a provider."""
import asyncio
from contextvars import ContextVar
from dataclasses import dataclass
import time
from uuid import UUID, uuid4

from app.core.config import settings
from app.core.ai_cost import Price, configured_price, prompt_token_ceiling, usd_to_nano
from app.db import session as database
from app.db.repo_ai_cost import reserve_call, reconcile_call, release_lease


@dataclass
class AIRequestContext:
    account_id: str
    request_id: UUID
    deadline: float
    calls: int = 0
    denied: bool = False
    call_active: bool = False


current_ai_request: ContextVar[AIRequestContext | None] = ContextVar('ai_request', default=None)


def session_factory():
    if database.async_session_maker is None:
        raise RuntimeError('AI accounting storage unavailable')
    return database.async_session_maker


async def reserve_provider_call(context, messages, operation, *, price: Price | None = None,
                                input_bound: int | None = None, output_bound: int | None = None):
    # Mutate before the first await: concurrent calls sharing a copied ContextVar
    # cannot bypass the per-operation cap or run under a single lease in parallel.
    if context.denied or context.call_active or context.calls >= 2 or time.monotonic() >= context.deadline:
        raise RuntimeError('AI operation exhausted')
    context.calls += 1
    context.call_active = True
    try:
        if price is None:
            if input_bound is not None or output_bound is not None:
                raise ValueError('Explicit bounds require reviewed provider pricing')
            price = configured_price(settings)
            input_bound = prompt_token_ceiling(messages, model=price.model)
            output_bound = settings.OPENAI_MAX_OUTPUT_TOKENS
        elif (type(input_bound) is not int or input_bound <= 0
              or type(output_bound) is not int or output_bound <= 0
              or not price.model or not price.version
              or any(not rate.is_finite() or rate <= 0 for rate in
                     [price.input_usd_per_million, price.output_usd_per_million])):
            raise ValueError('Provider calls require reviewed positive token bounds and pricing')
        call_id = uuid4()
        async with session_factory()() as session:
            await reserve_call(session, call_id=call_id, request_id=context.request_id,
                               account_id=context.account_id, operation=operation, price=price,
                               input_bound=input_bound, output_bound=output_bound,
                               global_cap=usd_to_nano(settings.AI_MONTHLY_BUDGET_USD),
                               account_cap=usd_to_nano(settings.AI_ACCOUNT_MONTHLY_BUDGET_USD))
            await session.commit()
        return call_id
    except BaseException:
        context.denied = True
        context.call_active = False
        raise


async def finish_provider_call(call_id, **usage):
    async with session_factory()() as session:
        await reconcile_call(session, call_id, **usage)
        await session.commit()


async def cleanup_lease(request_id):
    # A cancelled request cannot leave an infinite slot: this short best-effort
    # delete is bounded, and the server-time lease expires even after process loss.
    async with asyncio.timeout(5):
        async with session_factory()() as session:
            await release_lease(session, request_id)
            await session.commit()
