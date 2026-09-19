"""Bound cumulative new storage, including orphaned and uncertain uploads."""
from alembic import op
import sqlalchemy as sa

revision = "20260918_upload_budget"
down_revision = "20260918_plan_revision"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("upload_budgets",
        sa.Column("scope", sa.String(100), primary_key=True),
        sa.Column("object_count", sa.BigInteger(), nullable=False),
        sa.Column("byte_count", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("object_count >= 0 AND byte_count >= 0", name="ck_upload_budget_nonnegative"))


def downgrade():
    op.drop_table("upload_budgets")
