"""Short-lived account-owned import work and reviewable results."""
from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class ImportJobModel(Base):
    __tablename__ = 'recipe_import_jobs'
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    auth_version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, default='queued')
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    media_data: Mapped[bytes | None] = mapped_column(sa.LargeBinary)
    media_type: Mapped[str | None] = mapped_column(sa.String(64))
    result: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    lease_until: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    __table_args__ = (
        sa.CheckConstraint("status IN ('queued','processing','completed','failed','cancelled')", name='ck_recipe_import_status'),
        sa.Index('ix_recipe_import_queue', 'status', 'created_at'),
        sa.Index('ix_recipe_import_expiry', 'expires_at'),
        sa.Index('uq_recipe_import_active_account', 'user_id', unique=True,
            postgresql_where=sa.text("status IN ('queued','processing')")),
    )
