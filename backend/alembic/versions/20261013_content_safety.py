"""Private reports, bilateral blocks, and persistent sharing moderation holds.

Revision ID: 20261013_content_safety
Revises: 20261013_account_delete
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20261013_content_safety'
down_revision = '20261013_account_delete'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('library_sharing_suspended', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('recipes', sa.Column('catalog_suspended', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table('user_blocks',
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('blocked_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('user_id <> blocked_user_id', name='ck_user_blocks_not_self'),
    )
    op.create_table('content_reports',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('reporter_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('recipe_id', sa.String(255), nullable=False),
        sa.Column('reason', sa.String(32), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('content_snapshot', postgresql.JSONB(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('resolution', sa.String(32), nullable=True),
        sa.Column('resolution_notes', sa.Text(), nullable=True),
        sa.Column('reviewer_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("reason IN ('objectionable','harassment','privacy','spam','other')", name='ck_content_reports_reason'),
        sa.CheckConstraint("status IN ('pending','resolved')", name='ck_content_reports_status'),
        sa.CheckConstraint("resolution IS NULL OR resolution IN ('dismiss','remove_catalog','disable_library','remove_shared_content')", name='ck_content_reports_resolution'),
    )
    op.create_index('uq_content_reports_pending', 'content_reports', ['reporter_id', 'recipe_id'], unique=True, postgresql_where=sa.text("status = 'pending'"))


def downgrade():
    op.drop_table('content_reports')
    op.drop_table('user_blocks')
    op.drop_column('recipes', 'catalog_suspended')
    op.drop_column('users', 'library_sharing_suspended')
