"""Bound concurrent retailer HTTP requests across API replicas."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260922_store_waiters'
down_revision = '20260918_upload_budget'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('store_request_leases',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('account_id', sa.String(36), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_store_request_leases_expires_at', 'store_request_leases', ['expires_at'])


def downgrade():
    op.drop_table('store_request_leases')
