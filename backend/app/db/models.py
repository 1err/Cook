"""
SQLAlchemy table definitions. Schema must match Alembic migrations.
"""
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    is_library_public: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, server_default=sa.false()
    )
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())
    auth_identities: Mapped[list["AuthIdentityModel"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthIdentityModel(Base):
    __tablename__ = "auth_identities"
    __table_args__ = (UniqueConstraint("provider", "provider_user_id", name="uq_auth_identities_provider_provider_user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    provider_user_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user: Mapped["UserModel"] = relationship(back_populates="auth_identities")


class RecipeModel(Base):
    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(1024), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    ingredients: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array
    raw_extraction_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    library_tags: Mapped[str] = mapped_column(Text, nullable=False, server_default="[]")  # JSON array
    # Optional slug for library filter chips: quick_dinner, vegetarian, etc.
    library_category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_public_catalog: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, server_default=sa.false())
    catalog_source_recipe_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_time_minutes: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    steps: Mapped[str] = mapped_column(Text, nullable=False, server_default="[]")           # JSON array
    tips: Mapped[str] = mapped_column(Text, nullable=False, server_default="[]")            # JSON array
    equipment: Mapped[str] = mapped_column(Text, nullable=False, server_default="[]")       # JSON array


class MealPlanModel(Base):
    __tablename__ = "meal_plan"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[str] = mapped_column(String(10), primary_key=True)  # YYYY-MM-DD
    recipe_ids: Mapped[str] = mapped_column(Text, nullable=False)  # JSON object; legacy rows may be JSON array


class CachedStoreProductModel(Base):
    __tablename__ = "cached_store_products"

    query: Mapped[str] = mapped_column(Text, primary_key=True)
    store: Mapped[str] = mapped_column(String(32), primary_key=True)
    language: Mapped[str] = mapped_column(String(8), primary_key=True)
    cache_version: Mapped[str] = mapped_column(String(16), primary_key=True)
    data: Mapped[list[dict[str, str]]] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )


class CookingSessionModel(Base):
    __tablename__ = "cooking_sessions"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_cooking_sessions_user_id"),
        sa.CheckConstraint("version >= 1", name="ck_cooking_sessions_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()
    )
    dishes: Mapped[list["CookingSessionDishModel"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CookingSessionDishModel.position",
    )
    mutations: Mapped[list["CookingSessionMutationModel"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", passive_deletes=True
    )


class CookingSessionDishModel(Base):
    __tablename__ = "cooking_session_dishes"
    __table_args__ = (
        UniqueConstraint("session_id", "position", name="uq_cooking_dishes_session_position"),
        sa.CheckConstraint("position >= 0", name="ck_cooking_dishes_position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("cooking_sessions.id", ondelete="CASCADE"), nullable=False
    )
    recipe_id: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer(), nullable=False)
    title: Mapped[str] = mapped_column(String(1024), nullable=False)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    ingredients: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False)
    equipment: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    tips: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    session: Mapped["CookingSessionModel"] = relationship(back_populates="dishes")
    steps: Mapped[list["CookingSessionStepModel"]] = relationship(
        back_populates="dish",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CookingSessionStepModel.position",
    )


class CookingSessionStepModel(Base):
    __tablename__ = "cooking_session_steps"
    __table_args__ = (
        UniqueConstraint("dish_id", "position", name="uq_cooking_steps_dish_position"),
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
            "attention_type IN ('hands_on','passive')", name="ck_cooking_steps_attention_type"
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
        sa.Index("ix_cooking_steps_timer_ends_at", "timer_ends_at"),
        sa.Index("ix_cooking_steps_state", "state"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dish_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("cooking_session_dishes.id", ondelete="CASCADE"), nullable=False
    )
    recipe_step_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer(), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    duration_seconds: Mapped[int] = mapped_column(sa.Integer(), nullable=False)
    duration_source: Mapped[str] = mapped_column(String(16), nullable=False)
    attention_type: Mapped[str] = mapped_column(String(16), nullable=False)
    action_type: Mapped[str] = mapped_column(String(16), nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str] = mapped_column(String(24), nullable=False)
    timer_started_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    timer_ends_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    paused_remaining_seconds: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    notification_owner_device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    revision: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=1, server_default="1")
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()
    )
    dish: Mapped["CookingSessionDishModel"] = relationship(back_populates="steps")


class CookingSessionMutationModel(Base):
    __tablename__ = "cooking_session_mutations"
    __table_args__ = (sa.Index("ix_cooking_mutations_session_id", "session_id"),)

    mutation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("cooking_sessions.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    applied_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    session: Mapped["CookingSessionModel"] = relationship(back_populates="mutations")
