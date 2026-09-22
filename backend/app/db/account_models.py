"""Single-use account links, individually revoked sessions and durable image ownership."""
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class AccountActionTokenModel(Base):
    __tablename__ = "account_action_tokens"
    token_hash: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, index=True)
    __table_args__ = (sa.CheckConstraint("purpose IN ('reset', 'verify')", name="ck_account_token_purpose"),)


class RevokedSessionModel(Base):
    __tablename__ = "revoked_sessions"
    token_hash: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, index=True)


class OwnedImageModel(Base):
    """Object coordinates are server-created, never accepted as cleanup instructions from clients.

    Survives user deletion. A pending upload is reserved before external storage
    and cannot be collected until the bounded upload has had time to settle.
    """
    __tablename__ = "owned_images"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    storage_kind: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    bucket: Mapped[str] = mapped_column(sa.String(255), nullable=False, default="")
    region: Mapped[str] = mapped_column(sa.String(64), nullable=False, default="")
    object_key: Mapped[str] = mapped_column(sa.String(512), nullable=False)
    file_url: Mapped[str] = mapped_column(sa.Text, nullable=False, unique=True)
    state: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="pending_upload")
    cleanup_requested: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    next_attempt_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), index=True)
    attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    lease_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    __table_args__ = (
        sa.CheckConstraint("storage_kind IN ('s3', 'local')", name="ck_owned_image_storage"),
        sa.CheckConstraint("state IN ('pending_upload', 'active', 'deleting', 'deleted')", name="ck_owned_image_state"),
    )


class DeletedAccountModel(Base):
    """Minimal tombstone sweeps counters from work admitted just before deletion."""
    __tablename__ = "deleted_accounts"
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    request_scopes: Mapped[list[str]] = mapped_column(sa.JSON, nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), index=True)
