"""Add public recipe catalog fields.

Revision ID: 20260408_public_catalog
Revises: 20250325_cat
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260408_public_catalog"
down_revision: Union[str, None] = "20250325_cat"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "recipes",
        sa.Column("is_public_catalog", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "recipes",
        sa.Column("catalog_source_recipe_id", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("recipes", "catalog_source_recipe_id")
    op.drop_column("recipes", "is_public_catalog")
