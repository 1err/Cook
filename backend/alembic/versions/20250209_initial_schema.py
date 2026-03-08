"""Initial schema: recipes and meal_plan tables.

Revision ID: 20250209_initial
Revises:
Create Date: 2025-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = "20250209_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = inspect(conn)
    if not insp.has_table("recipes"):
        op.create_table(
            "recipes",
            sa.Column("id", sa.String(255), primary_key=True),
            sa.Column("title", sa.String(1024), nullable=False),
            sa.Column("source_url", sa.Text(), nullable=True),
            sa.Column("thumbnail_url", sa.Text(), nullable=True),
            sa.Column("ingredients", sa.Text(), nullable=False),
            sa.Column("raw_extraction_text", sa.Text(), nullable=True),
        )
    if not insp.has_table("meal_plan"):
        op.create_table(
            "meal_plan",
            sa.Column("date", sa.String(10), primary_key=True),
            sa.Column("recipe_ids", sa.Text(), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("meal_plan")
    op.drop_table("recipes")
