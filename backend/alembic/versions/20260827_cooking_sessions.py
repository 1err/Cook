"""Add normalized active cooking sessions.

Revision ID: 20260827_cook_sess
Revises: 20260825_step_meta
"""
from __future__ import annotations

from collections.abc import Sequence
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260827_cook_sess"
down_revision: Union[str, None] = "20260825_step_meta"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cooking_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_cooking_sessions_user_id"),
        sa.CheckConstraint("version >= 1", name="ck_cooking_sessions_version"),
    )
    op.create_table(
        "cooking_session_dishes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recipe_id", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=1024), nullable=False),
        sa.Column("thumbnail_url", sa.Text(), nullable=True),
        sa.Column("ingredients", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("equipment", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("tips", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["cooking_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "position", name="uq_cooking_dishes_session_position"),
        sa.CheckConstraint("position >= 0", name="ck_cooking_dishes_position"),
    )
    op.create_table(
        "cooking_session_steps",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dish_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recipe_step_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("duration_source", sa.String(length=16), nullable=False),
        sa.Column("attention_type", sa.String(length=16), nullable=False),
        sa.Column("action_type", sa.String(length=16), nullable=False),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("state", sa.String(length=24), nullable=False),
        sa.Column("timer_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("timer_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paused_remaining_seconds", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notification_owner_device_id", sa.String(length=128), nullable=True),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["dish_id"], ["cooking_session_dishes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dish_id", "position", name="uq_cooking_steps_dish_position"),
        sa.CheckConstraint("position >= 0", name="ck_cooking_steps_position"),
        sa.CheckConstraint("duration_seconds BETWEEN 1 AND 86400", name="ck_cooking_steps_duration"),
        sa.CheckConstraint(
            "state IN ('locked','ready','timer_running','timer_paused','needs_attention','completed','skipped')",
            name="ck_cooking_steps_state",
        ),
        sa.CheckConstraint(
            "duration_source IN ('stated','estimated','user','fallback')",
            name="ck_cooking_steps_duration_source",
        ),
        sa.CheckConstraint(
            "attention_type IN ('hands_on','passive')",
            name="ck_cooking_steps_attention_type",
        ),
        sa.CheckConstraint(
            "action_type IN ('prep','chop','mix','season','sear','simmer','boil','bake','rest','drain','assemble','plate','other')",
            name="ck_cooking_steps_action_type",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_cooking_steps_revision"),
        sa.CheckConstraint(
            "paused_remaining_seconds IS NULL OR paused_remaining_seconds >= 0",
            name="ck_cooking_steps_paused_remaining",
        ),
    )
    op.create_table(
        "cooking_session_mutations",
        sa.Column("mutation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["cooking_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("mutation_id"),
    )
    op.create_index("ix_cooking_steps_timer_ends_at", "cooking_session_steps", ["timer_ends_at"])
    op.create_index("ix_cooking_steps_state", "cooking_session_steps", ["state"])
    op.create_index("ix_cooking_mutations_session_id", "cooking_session_mutations", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_cooking_mutations_session_id", table_name="cooking_session_mutations")
    op.drop_index("ix_cooking_steps_state", table_name="cooking_session_steps")
    op.drop_index("ix_cooking_steps_timer_ends_at", table_name="cooking_session_steps")
    op.drop_table("cooking_session_mutations")
    op.drop_table("cooking_session_steps")
    op.drop_table("cooking_session_dishes")
    op.drop_table("cooking_sessions")
