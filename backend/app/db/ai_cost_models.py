"""Privacy-minimal durable paid-call ledger and reusable concurrency leases."""
import uuid
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.db.models import Base


class AIMonthlyBudgetModel(Base):
    __tablename__ = 'ai_monthly_budgets'
    scope: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    month: Mapped[date] = mapped_column(sa.Date(), primary_key=True)
    reserved_nano: Mapped[int] = mapped_column(sa.BigInteger(), nullable=False, default=0)
    spent_nano: Mapped[int] = mapped_column(sa.BigInteger(), nullable=False, default=0)
    __table_args__ = (sa.CheckConstraint('reserved_nano >= 0 AND spent_nano >= 0', name='ck_ai_money_nonnegative'),)


class AICallLedgerModel(Base):
    __tablename__ = 'ai_call_ledger'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    account_id: Mapped[str] = mapped_column(sa.String(36), nullable=False)
    month: Mapped[date] = mapped_column(sa.Date(), nullable=False)
    operation: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    model: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    price_version: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    input_rate: Mapped[Decimal] = mapped_column(sa.Numeric(24, 12), nullable=False)
    output_rate: Mapped[Decimal] = mapped_column(sa.Numeric(24, 12), nullable=False)
    reserved_nano: Mapped[int] = mapped_column(sa.BigInteger(), nullable=False)
    actual_nano: Mapped[int | None] = mapped_column(sa.BigInteger())
    input_tokens: Mapped[int | None] = mapped_column(sa.BigInteger())
    output_tokens: Mapped[int | None] = mapped_column(sa.BigInteger())
    provider_request_id: Mapped[str | None] = mapped_column(sa.String(256))
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, default='reserved')
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())
    __table_args__ = (sa.Index('ix_ai_ledger_account_month', 'account_id', 'month'),
                     sa.Index('ix_ai_ledger_month', 'month'),
                     sa.CheckConstraint('reserved_nano >= 0', name='ck_ai_ledger_reservation_nonnegative'))


class AIInflightLeaseModel(Base):
    __tablename__ = 'ai_inflight_leases'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[str] = mapped_column(sa.String(36), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, index=True)
