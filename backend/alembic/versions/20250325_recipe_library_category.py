"""Add optional library_category on recipes for filter chips.

Revision ID: 20250325_cat
Revises: 20250228_auth
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20250325_cat"
down_revision: Union[str, None] = "20250228_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("library_category", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("recipes", "library_category")
