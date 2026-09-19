"""Durable USD accounting, per-call usage, and shared AI operation leases."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260918_ai_cost'
down_revision = '20260918_recipe_pages'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('ai_monthly_budgets',
        sa.Column('scope', sa.String(64), nullable=False),
        sa.Column('month', sa.Date(), nullable=False),
        sa.Column('reserved_nano', sa.BigInteger(), nullable=False),
        sa.Column('spent_nano', sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint('scope', 'month'),
        sa.CheckConstraint('reserved_nano >= 0 AND spent_nano >= 0', name='ck_ai_money_nonnegative'))
    op.create_table('ai_call_ledger',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('request_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('account_id', sa.String(36), nullable=False),
        sa.Column('month', sa.Date(), nullable=False),
        sa.Column('operation', sa.String(64), nullable=False),
        sa.Column('model', sa.String(128), nullable=False),
        sa.Column('price_version', sa.String(128), nullable=False),
        sa.Column('input_rate', sa.Numeric(24, 12), nullable=False),
        sa.Column('output_rate', sa.Numeric(24, 12), nullable=False),
        sa.Column('reserved_nano', sa.BigInteger(), nullable=False),
        sa.Column('actual_nano', sa.BigInteger()),
        sa.Column('input_tokens', sa.BigInteger()),
        sa.Column('output_tokens', sa.BigInteger()),
        sa.Column('provider_request_id', sa.String(256)),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('reserved_nano >= 0', name='ck_ai_ledger_reservation_nonnegative'))
    op.create_index('ix_ai_ledger_account_month', 'ai_call_ledger', ['account_id', 'month'])
    op.create_index('ix_ai_ledger_month', 'ai_call_ledger', ['month'])
    op.create_table('ai_inflight_leases',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('account_id', sa.String(36), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'))
    op.create_index('ix_ai_inflight_leases_expires_at', 'ai_inflight_leases', ['expires_at'])


def downgrade():
    op.drop_table('ai_inflight_leases')
    op.drop_table('ai_call_ledger')
    op.drop_table('ai_monthly_budgets')
