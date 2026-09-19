"""Indexes supporting owner/public keyset scans and per-page copied-state probes."""
from alembic import op

revision = "20260918_recipe_pages"
down_revision = "20260914_ai_usage"
branch_labels = None
depends_on = None

def upgrade():
    # Bound index tuples even for existing 1024-character Unicode titles.
    # Page queries sort the full title and ID within each indexed prefix group.
    op.execute("CREATE INDEX ix_recipes_owner_title_id ON recipes (user_id, left(lower(title), 256))")
    op.execute("CREATE INDEX ix_recipes_catalog_title_id ON recipes (left(lower(title), 256)) WHERE is_public_catalog IS TRUE")
    op.create_index("ix_recipes_owner_source", "recipes", ["user_id", "catalog_source_recipe_id"])

def downgrade():
    op.drop_index("ix_recipes_owner_source", table_name="recipes")
    op.drop_index("ix_recipes_catalog_title_id", table_name="recipes")
    op.drop_index("ix_recipes_owner_title_id", table_name="recipes")
