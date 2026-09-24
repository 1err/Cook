"""Bounded database/schema readiness, compatible with later additive migrations."""
import asyncio

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db import session as db


async def database_ready() -> bool:
    try:
        async with asyncio.timeout(2):
            if db.async_session_maker is None:
                db.init_engine()
            async with db.async_session_maker() as session:
                # Resolving these required tables/columns detects an unmigrated
                # image. Do not require an exact Alembic head: old replicas must
                # remain ready during a subsequent additive migration/rollout.
                await session.execute(text("""
                    SELECT users.id, recipes.id, ai_call_ledger.id,
                           store_jobs.id, request_limit_counters.scope,
                           meal_plan.revision, upload_budgets.scope,
                           store_request_leases.expires_at, users.auth_version, users.email_verified,
                           users.email_verification_required,
                           account_action_tokens.token_hash, revoked_sessions.token_hash,
                           owned_images.state, deleted_accounts.next_attempt_at
                    FROM users, recipes, ai_call_ledger, store_jobs,
                         request_limit_counters, meal_plan, upload_budgets,
                         store_request_leases, account_action_tokens, revoked_sessions,
                         owned_images, deleted_accounts
                    LIMIT 0
                """))
            return True
    except (TimeoutError, SQLAlchemyError):
        return False
