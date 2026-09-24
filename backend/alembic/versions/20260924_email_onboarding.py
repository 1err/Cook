"""Require email ownership for newly registered accounts; preserve existing access."""
from alembic import op
import sqlalchemy as sa

revision = "20260924_email_onboarding"
down_revision = "20260924_beta_analytics_merge"
branch_labels = None
depends_on = None


def upgrade():
    # Existing accounts remain honestly unverified, with their previous access.
    # The registration route explicitly opts new accounts into this requirement.
    op.add_column("users", sa.Column("email_verification_required", sa.Boolean(),
        nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("users", "email_verification_required")
