"""AI operation admission and lifetime; committed before provider/network work."""
import asyncio
import logging
import time
from uuid import uuid4

from fastapi import Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.core.config import settings
from app.core.ai_context import AIRequestContext, current_ai_request, cleanup_lease
from app.core.llm import is_llm_enabled
from app.services.video_analysis import video_analysis_available
from app.db.models import UserModel
from app.db.repo_ai_usage import AIUsageLimitExceeded, reserve_ai_budget
from app.db.repo_ai_cost import acquire_lease
from app.db.session import get_session

logger = logging.getLogger(__name__)


class AIConcurrencyUnavailable(HTTPException):
    """Pre-operation lease contention, distinct from usage/money/provider limits."""
    def __init__(self, retry_after: int):
        self.retry_after = max(1, retry_after)
        super().__init__(429, str(AIUsageLimitExceeded(retry_after)),
                         headers={'Retry-After': str(self.retry_after)})


async def enforce_ai_budget(session: AsyncSession = Depends(get_session),
                            user: UserModel = Depends(get_current_user)):
    if not is_llm_enabled() and not video_analysis_available():
        await session.close()
        yield
        return
    request_id = uuid4()
    account_id = str(user.id)
    duration = settings.AI_OPERATION_TIMEOUT_SECONDS
    deadline = time.monotonic() + duration
    token = None
    admission_finished = False
    lease_attempted = False
    try:
        # Admission, transaction commit/close, source fetch, and provider work all
        # share one deadline. A blocked DB cannot consume unbounded request time.
        async with asyncio.timeout_at(deadline):
            try:
                await reserve_ai_budget(session, account_id)
                lease_attempted = True
                try:
                    await acquire_lease(session, account_id, request_id,
                                        global_limit=settings.AI_GLOBAL_MAX_INFLIGHT,
                                        account_limit=settings.AI_USER_MAX_INFLIGHT,
                                        ttl=duration + 10)
                except AIUsageLimitExceeded as exc:
                    # The operation counters are still uncommitted. The finally
                    # block rolls them back so queued retries spend no allowance.
                    raise AIConcurrencyUnavailable(exc.retry_after) from None
                await session.commit()
                await session.close()
            except AIUsageLimitExceeded as exc:
                raise HTTPException(429, str(exc), headers={'Retry-After': str(exc.retry_after)}) from None
            except SQLAlchemyError as exc:
                logger.warning('ai_budget_unavailable error_type=%s', type(exc).__name__)
                raise HTTPException(503, 'AI is temporarily unavailable.', headers={'Retry-After': '30'}) from None
            # Also guard against a dependency that swallowed cancellation or used
            # synchronous work: never hand an already expired request to a route.
            if time.monotonic() >= deadline:
                raise TimeoutError
            admission_finished = True
            token = current_ai_request.set(AIRequestContext(account_id, request_id, deadline))
            yield
    except TimeoutError:
        raise HTTPException(503, 'AI operation timed out. Please try again later.') from None
    finally:
        if token is not None:
            current_ai_request.reset(token)
        if not admission_finished:
            try:
                async with asyncio.timeout(5):
                    await session.rollback()
            except Exception as exc:
                logger.warning('ai_admission_rollback_failed error_type=%s', type(exc).__name__)
        # Commit cancellation may have an ambiguous outcome. Delete by this UUID
        # even when admission did not finish; expiry is the crash recovery path.
        if lease_attempted:
            try:
                await cleanup_lease(request_id)
            except Exception as exc:
                logger.warning('ai_lease_cleanup_failed error_type=%s', type(exc).__name__)
