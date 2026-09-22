"""Revocable accounts, hashed action tokens and durable owned-image cleanup."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260922_account_lifecycle"
down_revision = "20260922_store_waiters"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("auth_version", sa.Integer(), nullable=False, server_default="0"))
    for name in ("account_action_tokens", "revoked_sessions"):
        columns = [
            sa.Column("token_hash", sa.String(64), primary_key=True),
            sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        ]
        if name == "account_action_tokens":
            columns.extend([sa.Column("purpose", sa.String(20), nullable=False),
                sa.CheckConstraint("purpose IN ('reset', 'verify')", name="ck_account_token_purpose")])
        op.create_table(name, *columns)
        op.create_index(f"ix_{name}_user_id", name, ["user_id"])
        op.create_index(f"ix_{name}_expires_at", name, ["expires_at"])
    op.create_table("owned_images",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", UUID(as_uuid=True), nullable=False),
        sa.Column("storage_kind", sa.String(8), nullable=False),
        sa.Column("bucket", sa.String(255), nullable=False),
        sa.Column("region", sa.String(64), nullable=False),
        sa.Column("object_key", sa.String(512), nullable=False),
        sa.Column("file_url", sa.Text(), nullable=False, unique=True),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("cleanup_requested", sa.Boolean(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("lease_id", UUID(as_uuid=True)),
        sa.CheckConstraint("storage_kind IN ('s3', 'local')", name="ck_owned_image_storage"),
        sa.CheckConstraint("state IN ('pending_upload', 'active', 'deleting', 'deleted')", name="ck_owned_image_state"))
    op.create_index("ix_owned_images_owner_id", "owned_images", ["owner_id"])
    op.create_index("ix_owned_images_next_attempt_at", "owned_images", ["next_attempt_at"])
    op.create_table("deleted_accounts",
        sa.Column("user_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("request_scopes", sa.JSON(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_deleted_accounts_next_attempt_at", "deleted_accounts", ["next_attempt_at"])
    # All writers, including recipe copies and cooking snapshots, serialize with
    # cleanup admission. Once deletion is admitted a late copy retains its recipe
    # but cannot resurrect an image that no longer exists. No provider call holds
    # a database lock; the durable deleting state closes that race.
    op.execute("""
        CREATE FUNCTION guard_owned_image_reference() RETURNS trigger AS $$
        DECLARE image_state text; canonical_url text;
        BEGIN
            IF NEW.thumbnail_url IS NOT NULL THEN
                canonical_url := split_part(split_part(NEW.thumbnail_url, '?', 1), '#', 1);
                SELECT state INTO image_state FROM owned_images
                WHERE file_url = canonical_url
                   OR (storage_kind = 'local' AND right(canonical_url, length('/uploads/' || object_key)) = '/uploads/' || object_key)
                FOR UPDATE;
                IF image_state IN ('deleting', 'deleted') THEN
                    NEW.thumbnail_url := NULL;
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    for name in ("recipes", "cooking_session_dishes"):
        op.execute(f"CREATE TRIGGER guard_owned_image_reference BEFORE INSERT OR UPDATE OF thumbnail_url ON {name} "
                   "FOR EACH ROW EXECUTE FUNCTION guard_owned_image_reference()")


def downgrade():
    for name in ("recipes", "cooking_session_dishes"):
        op.execute(f"DROP TRIGGER guard_owned_image_reference ON {name}")
    op.execute("DROP FUNCTION guard_owned_image_reference()")
    op.drop_table("deleted_accounts")
    op.drop_table("owned_images")
    op.drop_table("revoked_sessions")
    op.drop_table("account_action_tokens")
    op.drop_column("users", "auth_version")
    op.drop_column("users", "email_verified")
