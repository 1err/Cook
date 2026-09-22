"""Bound HTTP retailer load independently of deduplicated durable browser jobs."""
import asyncio
from contextlib import asynccontextmanager
import logging
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.api.abuse import enforce_limits, private_scope
from app.core.config import settings
from app.db import session as db
from app.db.repo_request_limits import RequestLimit, RequestLimitExceeded
from app.db.repo_store_requests import acquire_request_lease, release_request_lease

logger = logging.getLogger(__name__)


@asynccontextmanager
async def store_request_admission(user):
    if not settings.ABUSE_LIMITS_ENABLED:
        yield
        return
    request_id = uuid4()
    attempted = False
    timeout = settings.STORE_REQUEST_TIMEOUT_SECONDS
    try:
        async with asyncio.timeout(timeout):
            await enforce_limits([
                RequestLimit('store-global', 60, settings.STORE_REQUEST_GLOBAL_PER_MINUTE),
                RequestLimit(private_scope('store-account', str(user.id)), 60,
                             settings.STORE_REQUEST_ACCOUNT_PER_MINUTE),
            ])
            attempted = True  # Commit cancellation has an ambiguous outcome.
            async with db.async_session_maker.begin() as session:
                await acquire_request_lease(session, str(user.id), request_id,
                    global_limit=settings.STORE_REQUEST_GLOBAL_MAX_INFLIGHT,
                    account_limit=settings.STORE_REQUEST_ACCOUNT_MAX_INFLIGHT,
                    ttl=timeout + 10)
            yield
    except RequestLimitExceeded as exc:
        raise HTTPException(429, 'Too many retailer requests. Please retry shortly.',
                            headers={'Retry-After': str(exc.retry_after)}) from None
    except (TimeoutError, SQLAlchemyError):
        raise HTTPException(503, 'Retailer lookup is temporarily unavailable. Please retry shortly.',
                            headers={'Retry-After': '3'}) from None
    finally:
        if attempted:
            try:
                async with asyncio.timeout(5):
                    async with db.async_session_maker.begin() as session:
                        await release_request_lease(session, request_id)
            except Exception:
                # The fixed DB-clock lease recovers crashes/ambiguous cancellation.
                logger.warning('store_request_lease_cleanup_unavailable')
