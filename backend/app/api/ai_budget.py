"""AI route admission commits its own short transaction before provider work."""
import logging

from fastapi import Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.core.llm import is_llm_enabled
from app.db.models import UserModel
from app.db.repo_ai_usage import AIUsageLimitExceeded, reserve_ai_budget
from app.db.session import get_session

logger = logging.getLogger(__name__)


async def enforce_ai_budget(session: AsyncSession = Depends(get_session),
                            user: UserModel = Depends(get_current_user)) -> None:
    if not is_llm_enabled():
        # No paid provider work: extraction will return 503; safe local refine and
        # timing fallbacks remain available without a configured AI credential.
        # End the auth-only read before video retrieval or stateless fallback work.
        await session.close()
        return
    try:
        await reserve_ai_budget(session, str(user.id))
        await session.commit()
    except AIUsageLimitExceeded as exc:
        await session.rollback()
        raise HTTPException(429, str(exc), headers={"Retry-After": str(exc.retry_after)}) from None
    except SQLAlchemyError as exc:
        await session.rollback()
        logger.warning("ai_budget_unavailable error_type=%s", type(exc).__name__)
        raise HTTPException(503, "AI is temporarily unavailable.", headers={"Retry-After": "30"}) from None
