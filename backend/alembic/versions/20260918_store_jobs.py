"""Durable retailer jobs and scheduler (additive; old image rollback safe)."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260918_jobs'
down_revision = '20260918_ai_cost'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('store_jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('dedupe_key', sa.String(80), nullable=False),
        sa.Column('payload', postgresql.JSONB(), nullable=False),
        sa.Column('state', sa.String(16), nullable=False),
        sa.Column('owner', sa.String(64)),
        sa.Column('fence', sa.BigInteger(), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('lease_until', sa.DateTime(timezone=True)),
        sa.Column('heartbeat_at', sa.DateTime(timezone=True)),
        sa.Column('available_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('result', postgresql.JSONB()),
        sa.Column('progress', postgresql.JSONB()),
        sa.Column('error', sa.String(64)),
        sa.CheckConstraint("state IN ('queued', 'running', 'succeeded', 'failed')", name='ck_store_jobs_state'),
        sa.CheckConstraint("kind IN ('lookup', 'warm')", name='ck_store_jobs_kind'),
        sa.CheckConstraint('attempts >= 0 AND fence >= 0', name='ck_store_jobs_counters'),
    )
    op.create_index('uq_store_jobs_active_dedupe', 'store_jobs', ['dedupe_key'], unique=True, postgresql_where=sa.text("state IN ('queued', 'running')"))
    op.create_index('ix_store_jobs_queue', 'store_jobs', ['state', 'available_at', 'created_at'])
    op.create_table('store_job_schedule', sa.Column('name', sa.String(32), primary_key=True), sa.Column('next_due', sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table('store_job_schedule')
    op.drop_table('store_jobs')
