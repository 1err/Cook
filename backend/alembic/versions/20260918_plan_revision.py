"""Add optimistic concurrency revisions to each account/date meal plan."""
from alembic import op
import sqlalchemy as sa
revision = "20260918_plan_revision"
down_revision = "20260918_request_limits"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("meal_plan", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.create_check_constraint("ck_meal_plan_revision", "meal_plan", "revision >= 1")

def downgrade():
    op.drop_constraint("ck_meal_plan_revision", "meal_plan", type_="check")
    op.drop_column("meal_plan", "revision")
