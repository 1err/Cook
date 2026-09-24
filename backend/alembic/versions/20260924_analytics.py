"""First-party analytics and administrator reporting.

Revision ID: 20260924_analytics
Revises: 20260914_ai_usage
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "20260924_analytics"
down_revision = "20260914_ai_usage"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "analytics_state",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_rollup_at", sa.DateTime(timezone=True)),
        sa.Column("last_event_at", sa.DateTime(timezone=True)),
    )
    op.execute("INSERT INTO analytics_state(id) VALUES (1)")
    op.create_table(
        "analytics_profiles",
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("is_test", sa.Boolean, nullable=False, server_default=sa.false()),
        *[
            sa.Column(name, sa.DateTime(timezone=True))
            for name in (
                "last_login_at",
                "last_seen_at",
                "first_recipe_at",
                "first_plan_at",
                "first_cook_at",
                "first_completion_at",
            )
        ],
    )
    op.create_table(
        "analytics_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column(
            "user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE")
        ),
        sa.Column("visitor_id", UUID(as_uuid=True)),
        sa.Column("session_id", UUID(as_uuid=True)),
        sa.Column("platform", sa.String(12), nullable=False),
        sa.Column("is_internal", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_client", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("path", sa.String(80)),
        sa.Column("referrer", sa.String(253)),
        sa.Column("source", sa.String(64)),
        sa.Column("medium", sa.String(64)),
        sa.Column("campaign", sa.String(64)),
        sa.Column("device", sa.String(12)),
        sa.Column("browser", sa.String(12)),
        sa.Column("retailer", sa.String(12)),
    )
    for name, columns in [
        ("time", ["occurred_at"]),
        ("user_time", ["user_id", "occurred_at"]),
        ("visitor", ["visitor_id"]),
        ("session", ["session_id"]),
        ("name_time", ["name", "occurred_at"]),
    ]:
        op.create_index("ix_analytics_" + name, "analytics_events", columns)
    op.create_table(
        "analytics_daily",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("metrics", JSONB, nullable=False),
    )


def downgrade():
    for name in (
        "analytics_daily",
        "analytics_events",
        "analytics_profiles",
        "analytics_state",
    ):
        op.drop_table(name)
