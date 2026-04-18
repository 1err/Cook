"""Add persistent store product cache table.

Revision ID: 20260416_store_cache
Revises: 20260409_recipe_tags
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260416_store_cache"
down_revision: Union[str, None] = "20260409_recipe_tags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cached_store_products",
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("store", sa.String(length=32), nullable=False),
        sa.Column("language", sa.String(length=8), nullable=False),
        sa.Column("cache_version", sa.String(length=16), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("query", "store", "language", "cache_version", name="pk_cached_store_products"),
    )
    op.create_index(
        "ix_cached_store_products_updated_at",
        "cached_store_products",
        ["updated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_cached_store_products_updated_at", table_name="cached_store_products")
    op.drop_table("cached_store_products")
