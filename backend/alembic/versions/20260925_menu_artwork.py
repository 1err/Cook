"""Isolate durable image requests by purpose and retain stored asset keys.

Revision ID: 20260925_menu_artwork
Revises: 20260925_recipe_images
"""
import sqlalchemy as sa
from alembic import op


revision = "20260925_menu_artwork"
down_revision = "20260925_recipe_images"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "recipe_image_generations",
        sa.Column(
            "purpose",
            sa.String(24),
            nullable=False,
            server_default="recipe_cover",
        ),
    )
    op.add_column(
        "recipe_image_generations",
        sa.Column("storage_kind", sa.String(8), nullable=True),
    )
    op.add_column(
        "recipe_image_generations",
        sa.Column("storage_key", sa.Text(), nullable=True),
    )
    op.create_check_constraint(
        "ck_recipe_image_purpose",
        "recipe_image_generations",
        "purpose IN ('recipe_cover', 'menu_artwork')",
    )


def downgrade():
    op.drop_constraint(
        "ck_recipe_image_purpose",
        "recipe_image_generations",
        type_="check",
    )
    op.drop_column("recipe_image_generations", "storage_key")
    op.drop_column("recipe_image_generations", "storage_kind")
    op.drop_column("recipe_image_generations", "purpose")
