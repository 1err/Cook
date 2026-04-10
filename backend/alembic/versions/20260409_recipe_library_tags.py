"""Add multi-tag support for recipes.

Revision ID: 20260409_recipe_tags
Revises: 20260408_public_catalog
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260409_recipe_tags"
down_revision: Union[str, None] = "20260408_public_catalog"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "recipes",
        sa.Column("library_tags", sa.Text(), nullable=False, server_default="[]"),
    )
    op.execute(
        """
        UPDATE recipes
        SET library_tags =
          CASE library_category
            WHEN 'quick_dinner' THEN '["quick"]'
            WHEN 'vegetarian' THEN '["vegetarian"]'
            WHEN 'dessert' THEN '["dessert"]'
            WHEN 'breakfast' THEN '["breakfast"]'
            WHEN 'italian' THEN '["italian"]'
            WHEN 'healthy' THEN '["healthy"]'
            ELSE '[]'
          END
        """
    )


def downgrade() -> None:
    op.drop_column("recipes", "library_tags")
