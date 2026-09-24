"""Import persistence checks use only an explicitly disposable local database."""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.models import UserModel
from app.db.import_job_models import ImportJobModel
from app.db import repo_import_jobs as jobs


@pytest_asyncio.fixture
async def factory():
    url = os.environ.get('TEST_DATABASE_URL')
    if not url:
        pytest.skip('Disposable PostgreSQL required')
    parsed = make_url(url)
    assert parsed.host in {'localhost', '127.0.0.1'} and parsed.database == 'cooking_audit_test'
    engine = create_async_engine(url)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


async def user(factory):
    async with factory.begin() as session:
        row = UserModel(id=uuid4(), email=f'{uuid4()}@example.com')
        session.add(row)
    return row


@pytest.mark.asyncio
async def test_job_is_owned_and_cancel_clears_private_payload(factory):
    owner, other = await user(factory), await user(factory)
    async with factory.begin() as session:
        created = await jobs.create_job(session, owner, {'mode':'text', 'transcript':'private recipe'})
    async with factory.begin() as session:
        assert await jobs.get_job(session, created.id, other.id) is None
        assert await jobs.cancel_job(session, created.id, other.id) is None
    async with factory.begin() as session:
        canceled = await jobs.cancel_job(session, created.id, owner.id)
        assert canceled.status == 'cancelled'
        assert canceled.payload == {} and canceled.media_data is None


@pytest.mark.asyncio
async def test_concurrent_claims_do_not_run_same_job_twice(factory):
    owner = await user(factory)
    async with factory.begin() as session:
        created = await jobs.create_job(session, owner, {'mode':'text', 'transcript':'Slice tofu.'})
    async def claim():
        async with factory.begin() as session:
            return await jobs.claim_job(session, lease_seconds=100)
    claimed = await asyncio.gather(claim(), claim())
    ids = [row.id for row in claimed if row is not None]
    assert ids.count(created.id) == 1


@pytest.mark.asyncio
async def test_cancelled_job_cannot_be_completed_by_late_worker(factory):
    owner = await user(factory)
    async with factory.begin() as session:
        created = await jobs.create_job(session, owner, {'mode':'text', 'transcript':'Slice tofu.'})
        await session.flush()
        created.status = 'processing'
    async with factory.begin() as session:
        await jobs.cancel_job(session, created.id, owner.id)
    async with factory.begin() as session:
        await jobs.finish_job(session, created.id, result={'id':'late'})
    async with factory() as session:
        final = await jobs.get_job(session, created.id, owner.id)
        assert final.status == 'cancelled' and final.result is None


@pytest.mark.asyncio
async def test_dead_worker_expires_without_retrying_charge(factory):
    owner = await user(factory)
    async with factory.begin() as session:
        row = await jobs.create_job(session, owner, {'mode':'text','transcript':'secret'}, media_data=b'private')
        row.status = 'processing'
        row.lease_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    async with factory.begin() as session:
        await jobs.maintain_jobs(session)
    async with factory() as session:
        expired = await jobs.get_job(session, row.id, owner.id)
        assert expired.status == 'failed'
        assert expired.media_data is None and expired.payload == {}


@pytest.mark.asyncio
async def test_only_one_active_import_per_account(factory):
    owner = await user(factory)
    async with factory.begin() as session:
        await jobs.create_job(session, owner, {'mode':'text','transcript':'one'})
    with pytest.raises(jobs.ImportQueueFull):
        async with factory.begin() as session:
            await jobs.create_job(session, owner, {'mode':'text','transcript':'two'})
