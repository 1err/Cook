"""Add recipe tutorial fields (description, total_time_minutes, steps, tips, equipment).

Revision ID: 20260514_recipe_tut
Revises: 20260510_user_lib
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260514_recipe_tut"
down_revision: Union[str, None] = "20260510_user_lib"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "recipes",
        sa.Column("steps", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "recipes",
        sa.Column("tips", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "recipes",
        sa.Column("equipment", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "recipes",
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.add_column(
        "recipes",
        sa.Column("total_time_minutes", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("recipes", "total_time_minutes")
    op.drop_column("recipes", "description")
    op.drop_column("recipes", "equipment")
    op.drop_column("recipes", "tips")
    op.drop_column("recipes", "steps")
