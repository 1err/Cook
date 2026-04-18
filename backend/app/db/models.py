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
