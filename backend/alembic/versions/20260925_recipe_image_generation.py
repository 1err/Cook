"""Add durable image requests and server-owned feature grants.

Revision ID: 20260925_recipe_images
Revises: 20260924_video_import
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260925_recipe_images"
down_revision = "20260924_video_import"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("feature_entitlements",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("feature_key", sa.String(64), primary_key=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table("recipe_image_generations",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("ledger_call_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("file_url", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('pending', 'completed', 'failed')", name="ck_recipe_image_status"),
        sa.CheckConstraint("(status = 'completed' AND file_url IS NOT NULL) OR "
                           "(status <> 'completed' AND file_url IS NULL)", name="ck_recipe_image_result"),
    )


def downgrade():
    op.drop_table("recipe_image_generations")
    op.drop_table("feature_entitlements")
