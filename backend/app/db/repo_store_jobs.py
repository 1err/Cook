"""PostgreSQL coordination. All mutations use one short transaction lock.

No DB connection is held while a browser works. Claims are globally serial and
fenced; cache publication and job completion commit in the same transaction.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

from sqlalchemy import case, delete, func, select, text

from app.db.job_models import StoreJobModel as Job, StoreJobScheduleModel as Schedule
from app.db import repo_store_cache

ACTIVE = ('queued', 'running')
LOCK_ID = 781463029  # Dedicated app namespace, distinct from AI counters.


class QueueFull(RuntimeError):
    pass


def initial_progress(force_refresh: bool, total: int) -> dict:
    return dict(current=0, total=total, last_query='', last_status='', stale_only=not force_refresh,
                summary={key: 0 for key in ('cache_hit', 'cache_miss', 'empty', 'skipped', 'failed')})


class StoreJobRepository:
    def __init__(self, sessions, *, queue_max=100, lease_seconds=180, max_attempts=2, retry_seconds=5):
        self.sessions = sessions
        self.queue_max = queue_max
        self.lease_seconds = lease_seconds
        self.max_attempts = max_attempts
        self.retry_seconds = retry_seconds

    async def _lock(self, session):
        await session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': LOCK_ID})
        return await session.scalar(select(func.clock_timestamp()))

    async def _enqueue(self, session, *, kind, key, payload, now, progress=None):
        existing = await session.scalar(select(Job).where(Job.dedupe_key == key, Job.state.in_(ACTIVE)))
        if existing is not None:
            return existing, False
        count = await session.scalar(select(func.count()).select_from(Job).where(Job.state.in_(ACTIVE)))
        if count >= self.queue_max:
            raise QueueFull('Retailer queue is full')
        job = Job(kind=kind, dedupe_key=key, payload=payload, state='queued', fence=0, attempts=0,
                  created_at=now, updated_at=now, available_at=now, progress=progress)
        session.add(job)
        await session.flush()
        return job, True

    async def enqueue_lookup(self, query, language, cache_version, *, force_refresh=False):
        if not query or len(query) > 512 or language not in ('en', 'zh'):
            raise ValueError('Invalid store query')
        key = hashlib.sha256(f'weee\0{language}\0{cache_version}\0{query.casefold()}'.encode()).hexdigest()
        async with self.sessions.begin() as session:
            now = await self._lock(session)
            return await self._enqueue(session, kind='lookup', key=key,
                payload=dict(query=query, language=language, cache_version=cache_version, force_refresh=force_refresh), now=now)

    async def _enqueue_warm(self, session, now, force_refresh):
        from app.jobs.cache_warmer_queries import ALL_QUERIES
        return await self._enqueue(session, kind='warm', key='weee-warm', payload=dict(force_refresh=force_refresh, queries=list(ALL_QUERIES)),
                                   now=now, progress=initial_progress(force_refresh, len(ALL_QUERIES)))

    async def enqueue_warm(self, *, force_refresh):
        async with self.sessions.begin() as session:
            now = await self._lock(session)
            return await self._enqueue_warm(session, now, force_refresh)

    async def schedule_warm(self, *, interval_seconds):
        async with self.sessions.begin() as session:
            now = await self._lock(session)
            row = await session.get(Schedule, 'weee-warm')
            if row is None:
                # Preserve historical no-startup-sweep behavior, but retain due time across restarts.
                session.add(Schedule(name='weee-warm', next_due=now+timedelta(seconds=interval_seconds)))
                return False
            if row.next_due > now:
                return False
            _, created = await self._enqueue_warm(session, now, True)
            row.next_due = now + timedelta(seconds=interval_seconds)
            return created

    async def claim(self, owner):
        async with self.sessions.begin() as session:
            now = await self._lock(session)
            running = (await session.scalars(select(Job).where(Job.state == 'running'))).all()
            for job in running:
                if job.error == 'cleanup_pending' or job.lease_until > now:
                    return None
                job.owner = None
                job.lease_until = None
                job.error = 'lease_expired'
                job.updated_at = now
                if job.attempts >= self.max_attempts:
                    job.state = 'failed'
                else:
                    job.state = 'queued'
                    job.available_at = now
            await session.flush()
            # Interactive first, but background older than 30 seconds gets a turn.
            rank = case((Job.created_at < now-timedelta(seconds=30), 0), (Job.kind == 'lookup', 1), else_=2)
            job = await session.scalar(select(Job).where(Job.state == 'queued', Job.available_at <= now)
                                       .order_by(rank, Job.available_at, Job.created_at, Job.id).limit(1))
            if job is None:
                return None
            job.state = 'running'
            job.owner = owner
            job.fence += 1
            job.attempts += 1
            job.heartbeat_at = now
            job.lease_until = now+timedelta(seconds=self.lease_seconds)
            job.updated_at = now
            await session.flush()
            return job

    async def _owned(self, session, claim, now):
        job = await session.get(Job, claim.id)
        if (job is None or job.state != 'running' or job.owner != claim.owner or job.fence != claim.fence
                or job.lease_until is None or job.lease_until <= now):
            return None
        return job

    async def mark_external_started(self, claim):
        """Supervisor must fence and persist this barrier before browser launch."""
        async with self.sessions.begin() as session:
            now = await self._lock(session)
            job = await self._owned(session, claim, now)
            if job is None or job.error == 'cleanup_pending':
                return False
            job.error = 'cleanup_pending'
            return True

    async def confirm_cleanup(self, claim):
        """May clear an expired lease, but never a different owner's/fence's work."""
        async with self.sessions.begin() as session:
            await self._lock(session)
            job = await session.get(Job, claim.id)
            if job is None or job.state != 'running' or job.owner != claim.owner or job.fence != claim.fence:
                return False
            if job.error == 'cleanup_pending':
                job.error = None
            return True

    async def heartbeat(self, claim):
        async with self.sessions.begin() as session:
            now = await self._lock(session)
            job = await self._owned(session, claim, now)
            if job is None:
                return False
            # A hard lease deadline is intentionally never extended: the child
            # watchdog finishes well before this horizon, even if parent stalls.
            job.heartbeat_at = now
            return True

    async def _publish(self, session, job, products, cached_at, query=None, language=None, cache_version=None):
        if products:
            entry = await repo_store_cache.upsert_cached_store_products(session,
                query=query or job.payload['query'].casefold(), store='weee',
                language=language or job.payload['language'], cache_version=cache_version or job.payload['cache_version'],
                data=products, updated_at=cached_at)
            if entry is None:
                raise RuntimeError('No cache winner')
            return dict(products=entry.products, cached_at=entry.updated_at.isoformat())
        return dict(products=[], cached_at=None)

    async def complete(self, claim, *, products, cached_at, publish=True):
        async with self.sessions.begin() as session:
            now = await self._lock(session)
            job = await self._owned(session, claim, now)
            if job is None:
                return False
            if job.error == 'cleanup_pending':
                return False
            if publish:
                job.result = await self._publish(session, job, products, cached_at or now)
            else:
                job.result = dict(products=products, cached_at=cached_at.isoformat() if cached_at else None)
            job.state = 'succeeded'
            job.updated_at = now
            job.owner = None
            job.lease_until = None
            return True

    async def advance_warm(self, claim, query, status, *, total, products=None, language=None, cache_version=None):
        async with self.sessions.begin() as session:
            now = await self._lock(session)
            job = await self._owned(session, claim, now)
            if job is None:
                return False
            if job.error == 'cleanup_pending':
                return False
            if products:
                await self._publish(session, job, products, now, query=query.casefold(), language=language, cache_version=cache_version)
            progress = dict(job.progress)
            summary = dict(progress['summary'])
            summary[status] += 1
            progress.update(current=progress['current']+1, total=total, last_query=query, last_status=status, summary=summary)
            job.progress = progress
            job.state = 'succeeded' if progress['current'] >= total else 'queued'
            job.owner = None
            job.lease_until = None
            job.attempts = 0
            job.updated_at = now
            job.available_at = now
            return True

    async def fail(self, claim, *, error='lookup_failed'):
        async with self.sessions.begin() as session:
            now = await self._lock(session)
            job = await self._owned(session, claim, now)
            if job is None or job.error == 'cleanup_pending':
                return False
            job.state = 'failed' if job.attempts >= self.max_attempts else 'queued'
            job.owner = None
            job.lease_until = None
            job.updated_at = now
            job.available_at = now+timedelta(seconds=self.retry_seconds)
            job.error = error
            return True

    async def get(self, job_id):
        async with self.sessions() as session:
            return await session.get(Job, job_id)

    async def warmer_status(self):
        from app.jobs.cache_warmer_queries import ALL_QUERIES
        async with self.sessions() as session:
            job = await session.scalar(select(Job).where(Job.kind == 'warm').order_by(Job.created_at.desc(), Job.id.desc()).limit(1))
            if job is None:
                progress = initial_progress(False, len(ALL_QUERIES))
                progress['summary'] = None
                return dict(running=False, **progress)
            progress = dict(job.progress)
            if job.state in ACTIVE:
                progress['summary'] = None
            else:
                progress['summary'] = dict(progress['summary'], total=progress['total'])
            if job.state == 'failed':
                progress['last_status'] = 'failed'
            return dict(running=job.state in ACTIVE, **progress)

    async def prune(self, *, retention_seconds):
        async with self.sessions.begin() as session:
            now = await self._lock(session)
            latest_warm = select(Job.id).where(Job.kind == 'warm').order_by(Job.created_at.desc(), Job.id.desc()).limit(1).scalar_subquery()
            ids = select(Job.id).where(Job.state.not_in(ACTIVE), Job.updated_at < now-timedelta(seconds=retention_seconds),
                (Job.kind != 'warm') | (Job.id != latest_warm)).limit(100)
            await session.execute(delete(Job).where(Job.id.in_(ids)))
