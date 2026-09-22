"""Replica-shared HTTP slots; never grant authority over durable scraper jobs."""
from datetime import timedelta

from sqlalchemy import delete, func, select, text

from app.db.job_models import StoreRequestLeaseModel as Lease
from app.db.repo_request_limits import RequestLimitExceeded


async def acquire_request_lease(session, account_id, request_id, *, global_limit, account_limit, ttl):
    await session.execute(text('SELECT pg_advisory_xact_lock(781463030)'))
    now = await session.scalar(select(func.clock_timestamp()))
    await session.execute(delete(Lease).where(Lease.expires_at <= now))
    total = await session.scalar(select(func.count()).select_from(Lease))
    account = await session.scalar(select(func.count()).select_from(Lease).where(Lease.account_id == account_id))
    if total >= global_limit or account >= account_limit:
        raise RequestLimitExceeded(3)
    session.add(Lease(id=request_id, account_id=account_id, expires_at=now + timedelta(seconds=ttl)))


async def release_request_lease(session, request_id):
    await session.execute(delete(Lease).where(Lease.id == request_id))
