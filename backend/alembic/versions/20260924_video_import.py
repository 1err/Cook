"""Persistent import jobs and genuinely unspecified cooking durations."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260924_video_import'
down_revision = '20260924_email_onboarding'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('recipe_import_jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('auth_version', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('payload', postgresql.JSONB(), nullable=False),
        sa.Column('media_data', sa.LargeBinary()),
        sa.Column('media_type', sa.String(64)),
        sa.Column('result', postgresql.JSONB()),
        sa.Column('error', postgresql.JSONB()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('lease_until', sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('queued','processing','completed','failed','cancelled')", name='ck_recipe_import_status'))
    op.create_index('ix_recipe_import_queue', 'recipe_import_jobs', ['status', 'created_at'])
    op.create_index('ix_recipe_import_expiry', 'recipe_import_jobs', ['expires_at'])
    op.create_index('uq_recipe_import_active_account', 'recipe_import_jobs', ['user_id'], unique=True,
        postgresql_where=sa.text("status IN ('queued','processing')"))
    op.drop_constraint('ck_cooking_steps_duration', 'cooking_session_steps', type_='check')
    op.drop_constraint('ck_cooking_steps_duration_source', 'cooking_session_steps', type_='check')
    op.alter_column('cooking_session_steps', 'duration_seconds', existing_type=sa.Integer(), nullable=True)
    op.create_check_constraint('ck_cooking_steps_duration_source', 'cooking_session_steps',
        "duration_source IN ('stated','estimated','user','fallback','unknown')")
    op.create_check_constraint('ck_cooking_steps_duration', 'cooking_session_steps',
        "(duration_source = 'unknown' AND duration_seconds IS NULL) OR "
        "(duration_source <> 'unknown' AND duration_seconds IS NOT NULL AND duration_seconds BETWEEN 1 AND 86400)")


def downgrade():
    # Preserve unknown-duration sessions rather than fabricate times during rollback.
    op.execute("DO $$ BEGIN IF EXISTS (SELECT 1 FROM cooking_session_steps WHERE duration_seconds IS NULL) "
               "THEN RAISE EXCEPTION 'Finish or remove untimed cooking sessions before downgrading'; END IF; END $$")
    op.drop_constraint('ck_cooking_steps_duration', 'cooking_session_steps', type_='check')
    op.drop_constraint('ck_cooking_steps_duration_source', 'cooking_session_steps', type_='check')
    op.alter_column('cooking_session_steps', 'duration_seconds', existing_type=sa.Integer(), nullable=False)
    op.create_check_constraint('ck_cooking_steps_duration_source', 'cooking_session_steps',
        "duration_source IN ('stated','estimated','user','fallback')")
    op.create_check_constraint('ck_cooking_steps_duration', 'cooking_session_steps', 'duration_seconds BETWEEN 1 AND 86400')
    op.drop_table('recipe_import_jobs')
