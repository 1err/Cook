"""Atomic queue admission and claims. Never holds a transaction over AI work."""
from datetime import timedelta

from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.orm import defer

from app.db.import_job_models import ImportJobModel as Job
from app.db.models import UserModel
from app.db.repo_ai_cost import db_now

ACTIVE = ('queued', 'processing')
MAX_PENDING = 32
RESULT_TTL_SECONDS = 3600


class ImportQueueFull(RuntimeError):
    pass


async def maintain_jobs(session):
    now = await db_now(session)
    await session.execute(delete(Job).where(Job.expires_at <= now))
    await session.execute(update(Job).where(Job.status == 'processing', Job.lease_until <= now).values(
        status='failed', payload={}, media_data=None, media_type=None, updated_at=now,
        error={'code':'import_interrupted','message':'Import was interrupted. Please retry.'}))
    valid_account = select(UserModel.id).where(UserModel.id == Job.user_id,
                                              UserModel.auth_version == Job.auth_version).exists()
    await session.execute(update(Job).where(Job.status.in_(ACTIVE), ~valid_account).values(
        status='cancelled', payload={}, media_data=None, media_type=None, updated_at=now))


async def create_job(session, user, payload, *, media_data=None, media_type=None):
    await session.execute(text('SELECT pg_advisory_xact_lock(240926014)'))
    await maintain_jobs(session)
    count = (await session.execute(select(func.count()).select_from(Job).where(Job.status.in_(ACTIVE)))).scalar_one()
    owned = (await session.execute(select(Job.id).where(Job.user_id == user.id, Job.status.in_(ACTIVE)))).first()
    if owned or count >= MAX_PENDING:
        raise ImportQueueFull('An import is already running or the queue is full. Wait or cancel it before retrying.')
    now = await db_now(session)
    job = Job(user_id=user.id, auth_version=user.auth_version, status='queued', payload=payload,
        media_data=media_data, media_type=media_type, expires_at=now + timedelta(seconds=RESULT_TTL_SECONDS),
        created_at=now, updated_at=now)
    session.add(job)
    await session.flush()
    return job


async def get_job(session, job_id, user_id, *, include_payload=True):
    statement = select(Job).where(Job.id == job_id, Job.user_id == user_id, Job.expires_at > func.now())
    if not include_payload:
        statement = statement.options(defer(Job.media_data), defer(Job.payload))
    return (await session.execute(statement)).scalar_one_or_none()


async def cancel_job(session, job_id, user_id):
    return (await session.execute(update(Job).where(Job.id == job_id, Job.user_id == user_id,
        Job.expires_at > func.now()).values(status='cancelled', payload={}, media_data=None,
        media_type=None, result=None, error=None, updated_at=func.now()).returning(Job))).scalar_one_or_none()


async def claim_job(session, *, lease_seconds):
    await maintain_jobs(session)
    # For queued rows lease_until is a retry-not-before time; initial rows are
    # immediately eligible. Keep retry deferral in the same durable queue.
    row = (await session.execute(select(Job).where(Job.status == 'queued',
        or_(Job.lease_until.is_(None), Job.lease_until <= func.now())).order_by(Job.created_at)
        .with_for_update(skip_locked=True).limit(1))).scalar_one_or_none()
    if row is not None:
        now = await db_now(session)
        row.status = 'processing'
        row.updated_at = now
        row.lease_until = now + timedelta(seconds=lease_seconds)
        await session.flush()
    return row


async def requeue_job(session, job, *, retry_seconds):
    """Retry only a still-owned claim whose admission never reached a provider.

    Source bytes and the original expiry are preserved. A cancellation, account
    revocation, expired claim, or newer worker claim cannot be resurrected.
    """
    now = await db_now(session)
    delay = max(1, min(30, retry_seconds))
    valid_account = select(UserModel.id).where(UserModel.id == Job.user_id,
                                              UserModel.auth_version == Job.auth_version).exists()
    await session.execute(update(Job).where(Job.id == job.id, Job.status == 'processing',
        Job.lease_until == job.lease_until, Job.lease_until > now, Job.expires_at > now,
        valid_account).values(status='queued', lease_until=now + timedelta(seconds=delay),
                              updated_at=now))


async def finish_job(session, job_id, *, result=None, error=None):
    # A cancellation or an expired worker can never resurrect its result.
    await session.execute(update(Job).where(Job.id == job_id, Job.status == 'processing').values(
        status='failed' if error else 'completed', result=result, error=error, payload={},
        media_data=None, media_type=None, updated_at=func.now()))


def job_response(job):
    return {'id':str(job.id), 'status':job.status, 'recipe':job.result, 'error':job.error}
