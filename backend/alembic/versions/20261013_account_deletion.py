"""Durable media erasure intents survive deleted accounts.

Revision ID: 20261013_account_delete
Revises: 20261001_library_visibility
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261013_account_delete"
down_revision = "20261001_library_visibility"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("account_media_cleanup",
        sa.Column("account_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("local_upload_root", sa.Text(), nullable=False),
        sa.Column("s3_bucket", sa.String(255), nullable=True),
        sa.Column("s3_region", sa.String(64), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_account_media_cleanup_available_at", "account_media_cleanup", ["available_at"])


def downgrade():
    op.drop_table("account_media_cleanup")
