"""Persistent bounded retailer queue and its durable scheduling cursor."""
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class StoreJobModel(Base):
    __tablename__ = 'store_jobs'
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    kind: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    state: Mapped[str] = mapped_column(sa.String(16), nullable=False, default='queued')
    owner: Mapped[str | None] = mapped_column(sa.String(64))
    fence: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, default=0)
    attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    lease_until: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    available_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    progress: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(sa.String(64))
    __table_args__ = (
        sa.CheckConstraint("state IN ('queued', 'running', 'succeeded', 'failed')", name='ck_store_jobs_state'),
        sa.CheckConstraint("kind IN ('lookup', 'warm')", name='ck_store_jobs_kind'),
        sa.CheckConstraint('attempts >= 0 AND fence >= 0', name='ck_store_jobs_counters'),
        sa.Index('uq_store_jobs_active_dedupe', 'dedupe_key', unique=True, postgresql_where=sa.text("state IN ('queued', 'running')")),
        sa.Index('ix_store_jobs_queue', 'state', 'available_at', 'created_at'),
    )


class StoreJobScheduleModel(Base):
    __tablename__ = 'store_job_schedule'
    name: Mapped[str] = mapped_column(sa.String(32), primary_key=True)
    next_due: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
