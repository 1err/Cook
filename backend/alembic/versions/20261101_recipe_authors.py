"""Optional canonical recipe attribution and atomic name/alias identities.

Revision ID: 20261101_recipe_authors
Revises: 20261013_media_review
"""
from alembic import op
import sqlalchemy as sa

revision = "20261101_recipe_authors"
down_revision = "20261013_media_review"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("recipe_authors",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("aliases", sa.Text(), nullable=False, server_default="[]"),
    )
    op.create_table("recipe_author_keys",
        sa.Column("normalized_name", sa.String(240), primary_key=True),
        sa.Column("author_id", sa.String(36), sa.ForeignKey("recipe_authors.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_index("ix_recipe_author_keys_author_id", "recipe_author_keys", ["author_id"])
    op.add_column("recipes", sa.Column("author_id", sa.String(36), nullable=True))
    op.create_foreign_key("fk_recipes_author_id", "recipes", "recipe_authors", ["author_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_recipes_author_id", "recipes", ["author_id"])


def downgrade():
    op.drop_index("ix_recipes_author_id", table_name="recipes")
    op.drop_constraint("fk_recipes_author_id", "recipes", type_="foreignkey")
    op.drop_column("recipes", "author_id")
    op.drop_index("ix_recipe_author_keys_author_id", table_name="recipe_author_keys")
    op.drop_table("recipe_author_keys")
    op.drop_table("recipe_authors")
