"""Human approval before customer recipe photos appear on shared surfaces.

Revision ID: 20261013_media_review
Revises: 20261013_content_safety
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20261013_media_review'
down_revision = '20261013_content_safety'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('recipes', sa.Column('approved_media_digest', sa.String(64), nullable=True))
    op.add_column('recipes', sa.Column('rejected_media_digest', sa.String(64), nullable=True))
    op.create_table('recipe_media_reviews',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('recipe_id', sa.String(255), sa.ForeignKey('recipes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('media_digest', sa.String(64), nullable=False),
        sa.Column('content_snapshot', postgresql.JSONB(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('reviewer_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.UniqueConstraint('recipe_id', 'media_digest', name='uq_recipe_media_review_digest'),
        sa.CheckConstraint("status IN ('pending','approved','rejected')", name='ck_recipe_media_review_status'),
    )
    op.create_index('ix_recipe_media_reviews_created_at', 'recipe_media_reviews', ['created_at'])


def downgrade():
    op.drop_table('recipe_media_reviews')
    op.drop_column('recipes', 'rejected_media_digest')
    op.drop_column('recipes', 'approved_media_digest')
