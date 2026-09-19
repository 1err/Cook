"""Shared auth and upload admission; no private email/IP values retained."""
from alembic import op
import sqlalchemy as sa

revision = "20260918_request_limits"
down_revision = "20260918_jobs"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("request_limit_counters",
                    sa.Column("scope", sa.String(100), primary_key=True),
                    sa.Column("window_seconds", sa.Integer(), primary_key=True),
                    sa.Column("window_start", sa.BigInteger(), nullable=False),
                    sa.Column("amount", sa.BigInteger(), nullable=False),
                    sa.CheckConstraint("amount > 0 AND window_seconds > 0", name="ck_request_limit_positive"))
    op.create_index("ix_request_limit_counters_window_start", "request_limit_counters", ["window_start"])


def downgrade():
    op.drop_table("request_limit_counters")
