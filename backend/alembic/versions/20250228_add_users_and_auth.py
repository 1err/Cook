"""Add users, auth_identities, and user_id to recipes and meal_plan.

Revision ID: 20250228_auth
Revises: 20250209_initial
Create Date: 2025-02-28

Multi-tenant auth: users table, auth_identities (OAuth-ready), user_id FK on
recipes and meal_plan. Existing data backfilled to a single migration user.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20250228_auth"
down_revision: Union[str, None] = "20250209_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Fixed UUID for backfill user (existing rows get this user_id)
MIGRATION_USER_ID = "00000000-0000-0000-0000-000000000001"


def upgrade() -> None:
    # --- users ---
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # --- auth_identities ---
    op.create_table(
        "auth_identities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("provider_user_id", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("provider", "provider_user_id", name="uq_auth_identities_provider_provider_user_id"),
    )
    op.create_index("ix_auth_identities_provider", "auth_identities", ["provider"])
    op.create_index("ix_auth_identities_provider_user_id", "auth_identities", ["provider_user_id"])

    # --- recipes: add user_id (nullable first for backfill) ---
    op.add_column("recipes", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_recipes_user_id_users",
        "recipes",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # --- meal_plan: add user_id (nullable first) ---
    op.add_column("meal_plan", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_meal_plan_user_id_users",
        "meal_plan",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # --- Backfill: create migration user and assign existing rows (do not drop data) ---
    op.execute(
        sa.text(
            "INSERT INTO users (id, email, created_at) VALUES "
            "('00000000-0000-0000-0000-000000000001'::uuid, 'migration@local.dev', now()) "
            "ON CONFLICT (id) DO NOTHING"
        )
    )
    op.execute(sa.text("UPDATE recipes SET user_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE user_id IS NULL"))
    op.execute(sa.text("UPDATE meal_plan SET user_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE user_id IS NULL"))

    # --- Set NOT NULL and add index on recipes.user_id ---
    op.alter_column(
        "recipes",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.create_index("ix_recipes_user_id", "recipes", ["user_id"])

    op.alter_column(
        "meal_plan",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.create_index("ix_meal_plan_user_id", "meal_plan", ["user_id"])
    # Composite PK so each user has one row per date
    op.drop_constraint("meal_plan_pkey", "meal_plan", type_="primary")
    op.create_primary_key("meal_plan_pkey", "meal_plan", ["user_id", "date"])


def downgrade() -> None:
    op.drop_constraint("meal_plan_pkey", "meal_plan", type_="primary")
    op.create_primary_key("meal_plan_pkey", "meal_plan", ["date"])
    op.drop_index("ix_meal_plan_user_id", "meal_plan")
    op.drop_column("meal_plan", "user_id")
    op.drop_index("ix_recipes_user_id", "recipes")
    op.drop_column("recipes", "user_id")
    op.drop_table("auth_identities")
    op.drop_table("users")
