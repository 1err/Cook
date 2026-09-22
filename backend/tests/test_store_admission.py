"""Real shared admission races, cancellation and retry behavior; no providers."""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select

from test_postgres_integrations import pg_sessions


@pytest.fixture
async def store_admission(pg_sessions, monkeypatch):
    from app.api import store_admission as admission
    from app.db import session as db
    from app.db.job_models import StoreRequestLeaseModel
    from app.db.request_limit_models import RequestLimitModel
    monkeypatch.setattr(db, 'async_session_maker', pg_sessions)
    for key, value in dict(ABUSE_LIMITS_ENABLED=True, STORE_REQUEST_GLOBAL_MAX_INFLIGHT=2,
                           STORE_REQUEST_ACCOUNT_MAX_INFLIGHT=1, STORE_REQUEST_GLOBAL_PER_MINUTE=120,
                           STORE_REQUEST_ACCOUNT_PER_MINUTE=30, STORE_REQUEST_TIMEOUT_SECONDS=1).items():
        monkeypatch.setattr(admission.settings, key, value)
    async with pg_sessions.begin() as session:
        await session.execute(delete(StoreRequestLeaseModel))
        await session.execute(delete(RequestLimitModel))
    return admission


@pytest.mark.asyncio
@pytest.mark.parametrize('same_account,accepted', [(False, 2), (True, 1)])
async def test_shared_store_slots_bound_global_and_account_waiters(store_admission, pg_sessions, same_account, accepted):
    from app.db.job_models import StoreRequestLeaseModel
    release = asyncio.Event()
    decisions = asyncio.Queue()
    account = uuid4()
    async def request():
        try:
            async with store_admission.store_request_admission(SimpleNamespace(id=account if same_account else uuid4())):
                await decisions.put('accepted')
                await release.wait()
        except HTTPException as exc:
            assert exc.status_code == 429 and int(exc.headers['Retry-After']) > 0
            await decisions.put('denied')
    tasks = [asyncio.create_task(request()) for _ in range(12)]
    try:
        results = [await asyncio.wait_for(decisions.get(), 3) for _ in tasks]
        assert results.count('accepted') == accepted
        async with pg_sessions() as session:
            assert await session.scalar(select(func.count()).select_from(StoreRequestLeaseModel)) == accepted
    finally:
        release.set()
        await asyncio.gather(*tasks)
    async with pg_sessions() as session:
        assert await session.scalar(select(func.count()).select_from(StoreRequestLeaseModel)) == 0


@pytest.mark.asyncio
async def test_cancelled_store_waiter_releases_its_slot(store_admission, pg_sessions):
    from app.db.job_models import StoreRequestLeaseModel
    entered = asyncio.Event()
    user = SimpleNamespace(id=uuid4())
    async def request():
        async with store_admission.store_request_admission(user):
            entered.set()
            await asyncio.Event().wait()
    task = asyncio.create_task(request())
    await asyncio.wait_for(entered.wait(), 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    async with pg_sessions() as session:
        assert await session.scalar(select(func.count()).select_from(StoreRequestLeaseModel)) == 0
    async with store_admission.store_request_admission(user):
        pass


@pytest.mark.asyncio
async def test_store_request_deadline_releases_slot_and_returns_retryable_error(store_admission, pg_sessions, monkeypatch):
    from app.db.job_models import StoreRequestLeaseModel
    monkeypatch.setattr(store_admission.settings, 'STORE_REQUEST_TIMEOUT_SECONDS', .04)
    with pytest.raises(HTTPException) as rejected:
        async with store_admission.store_request_admission(SimpleNamespace(id=uuid4())):
            await asyncio.sleep(10)
    assert rejected.value.status_code == 503
    async with pg_sessions() as session:
        assert await session.scalar(select(func.count()).select_from(StoreRequestLeaseModel)) == 0


@pytest.mark.asyncio
async def test_store_rate_limit_applies_to_fast_cache_hits_too(store_admission, monkeypatch):
    monkeypatch.setattr(store_admission.settings, 'STORE_REQUEST_ACCOUNT_PER_MINUTE', 3)
    user = SimpleNamespace(id=uuid4())
    for _ in range(3):
        async with store_admission.store_request_admission(user):
            pass
    with pytest.raises(HTTPException) as rejected:
        async with store_admission.store_request_admission(user):
            pytest.fail('Rate-limited request was admitted')
    assert rejected.value.status_code == 429


@pytest.mark.asyncio
async def test_crashed_store_request_lease_expires_without_freeing_new_owner(store_admission, pg_sessions):
    from datetime import timedelta
    from app.db.job_models import StoreRequestLeaseModel
    from app.db.repo_store_requests import acquire_request_lease, release_request_lease
    old, user = uuid4(), uuid4()
    async with pg_sessions.begin() as session:
        session.add(StoreRequestLeaseModel(id=old, account_id=str(user),
                    expires_at=func.clock_timestamp() - timedelta(seconds=1)))
    new = uuid4()
    async with pg_sessions.begin() as session:
        await acquire_request_lease(session, str(user), new, global_limit=1, account_limit=1, ttl=10)
    async with pg_sessions.begin() as session:
        await release_request_lease(session, old)
    async with pg_sessions() as session:
        assert await session.get(StoreRequestLeaseModel, old) is None
        assert await session.get(StoreRequestLeaseModel, new) is not None
