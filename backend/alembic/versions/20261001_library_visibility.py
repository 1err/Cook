"""Allow unbookmarking without deleting public recipes, edits, or planner references."""
from alembic import op
import sqlalchemy as sa

revision = "20261001_library_visibility"
down_revision = "20260926_menu_creation"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("recipes", sa.Column("is_library_hidden", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("recipes", "is_library_hidden")
