"""Add users.is_library_public for friend library sharing.

Revision ID: 20260510_user_lib
Revises: 20260416_store_cache
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260510_user_lib"
down_revision: Union[str, None] = "20260416_store_cache"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_library_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "is_library_public")
