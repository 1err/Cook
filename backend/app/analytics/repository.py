"""Bounded collection with independent transactions and deduplication."""

import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from app.core.config import settings
from app.db import session as db
from app.analytics.schema import MEANINGFUL, SERVER_EVENTS

logger = logging.getLogger(__name__)
_collection_failures = 0
_last_failure_at = None
FIELDS = (
    "id",
    "occurred_at",
    "name",
    "user_id",
    "visitor_id",
    "session_id",
    "platform",
    "is_internal",
    "is_client",
    "path",
    "referrer",
    "source",
    "medium",
    "campaign",
    "device",
    "browser",
    "retailer",
)


def admin_ids():
    return [UUID(v.strip()) for v in settings.ADMIN_USER_IDS.split(",") if v.strip()]


async def record_event(session, event: dict):
    row = {field: event.get(field) for field in FIELDS}
    row["occurred_at"] = row["occurred_at"] or datetime.now(timezone.utc)
    row["platform"] = row["platform"] or "web"
    row["is_client"] = bool(row["is_client"])
    row["is_internal"] = row["user_id"] in admin_ids()
    if row["name"] not in SERVER_EVENTS + ("page_view", "retailer_handoff"):
        raise ValueError("Unsupported analytics event")
    if row["is_client"] and row["name"] not in ("page_view", "retailer_handoff"):
        raise ValueError("Client cannot submit confirmed events")
    if not row["is_client"] and not row["user_id"]:
        raise ValueError("Confirmed events require an account")
    result = await session.execute(
        text(
            "INSERT INTO analytics_events ("
            + ",".join(FIELDS)
            + ") VALUES ("
            + ",".join(":" + f for f in FIELDS)
            + ") ON CONFLICT (id) DO NOTHING RETURNING id"
        ),
        row,
    )
    if result.scalar_one_or_none() is None:
        return False
    if row["user_id"]:
        await session.execute(
            text(
                "INSERT INTO analytics_profiles(user_id) VALUES (:id) ON CONFLICT DO NOTHING"
            ),
            {"id": row["user_id"]},
        )
        updates = {}
        if row["name"] == "login":
            updates["last_login_at"] = "GREATEST(last_login_at,:at)"
        if row["name"] in MEANINGFUL and (
            row["name"] != "page_view"
            or (row["path"] or "").startswith(
                (
                    "/library",
                    "/recipe",
                    "/import",
                    "/planner",
                    "/shopping-list",
                    "/cook",
                )
            )
        ):
            updates["last_seen_at"] = "GREATEST(last_seen_at,:at)"
        first = {
            "recipe_saved": "first_recipe_at",
            "meal_planned": "first_plan_at",
            "cooking_started": "first_cook_at",
            "cooking_completed": "first_completion_at",
        }.get(row["name"])
        if first:
            updates[first] = f"LEAST({first},:at)"
        if updates:
            await session.execute(
                text(
                    "UPDATE analytics_profiles SET "
                    + ",".join(k + "=" + v for k, v in updates.items())
                    + " WHERE user_id=:id"
                ),
                {"id": row["user_id"], "at": row["occurred_at"]},
            )
    await session.execute(
        text(
            "UPDATE analytics_state SET last_event_at=GREATEST(last_event_at,:at) WHERE id=1"
        ),
        {"at": row["occurred_at"]},
    )
    return True


async def safe_record(event: dict):
    global _collection_failures, _last_failure_at
    if db.async_session_maker is None:
        return False
    try:
        async with asyncio.timeout(1.5):
            async with db.async_session_maker.begin() as session:
                await session.execute(text("SET LOCAL statement_timeout='1000ms'"))
                return await record_event(session, event)
    except Exception as error:
        _collection_failures += 1
        _last_failure_at = datetime.now(timezone.utc)
        logger.warning(
            "analytics_collection_failed", extra={"error_type": type(error).__name__}
        )
        return False


def collection_health():
    return {
        "failures_since_process_start": _collection_failures,
        "last_failure_at": _last_failure_at,
    }


async def rollup_and_prune(session):
    """One advisory-locked, bounded maintenance batch; rerun until caught up."""
    locked = (
        await session.execute(text("SELECT pg_try_advisory_xact_lock(2492401)"))
    ).scalar()
    if not locked:
        return
    await session.execute(text("SET LOCAL statement_timeout='5000ms'"))
    # Preserve non-identifying day totals before deleting the oldest raw batch.
    await session.execute(
        text("""INSERT INTO analytics_daily(day,metrics)
        SELECT (occurred_at AT TIME ZONE 'UTC')::date,
        jsonb_build_object('events',count(*),'accounts_with_events',count(DISTINCT user_id),
          'visitors',count(DISTINCT visitor_id),'visits',count(DISTINCT session_id))
        FROM analytics_events e WHERE occurred_at<(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '89 days' AND NOT is_internal
        AND NOT EXISTS(SELECT 1 FROM analytics_profiles p WHERE p.user_id=e.user_id AND p.is_test)
        GROUP BY 1 ON CONFLICT(day) DO NOTHING""")
    )
    deleted = await session.execute(
        text(
            "DELETE FROM analytics_events WHERE id IN (SELECT id FROM analytics_events WHERE occurred_at<now()-interval '90 days' ORDER BY occurred_at LIMIT 10000)"
        )
    )
    await session.execute(
        text("DELETE FROM analytics_daily WHERE day<current_date-interval '13 months'")
    )
    await session.execute(
        text("UPDATE analytics_state SET last_rollup_at=now() WHERE id=1")
    )
    return deleted.rowcount


async def maintenance_loop():
    while True:
        delay = 3600
        try:
            if db.async_session_maker:
                async with db.async_session_maker.begin() as session:
                    if (await rollup_and_prune(session) or 0) >= 10000:
                        delay = 10
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.warning(
                "analytics_maintenance_failed",
                extra={"error_type": type(error).__name__},
            )
        await asyncio.sleep(delay)
