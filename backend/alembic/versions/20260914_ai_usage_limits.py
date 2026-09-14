"""Add reusable account/global AI admission counters.

Revision ID: 20260914_ai_usage
Revises: 20260827_cook_sess
"""
from alembic import op
import sqlalchemy as sa

revision = "20260914_ai_usage"
down_revision = "20260827_cook_sess"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_usage_counters",
        sa.Column("scope", sa.String(64), nullable=False),
        sa.Column("window_seconds", sa.Integer(), nullable=False),
        sa.Column("window_start", sa.BigInteger(), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("scope", "window_seconds"),
        sa.CheckConstraint("request_count >= 1", name="ck_ai_usage_positive_count"),
        sa.CheckConstraint("window_seconds > 0", name="ck_ai_usage_positive_window"),
    )


def downgrade():
    op.drop_table("ai_usage_counters")
