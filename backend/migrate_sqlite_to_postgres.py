"""
One-time migration: copy recipes and meal_plan from a source DB to Postgres.
Source URL from env MIGRATE_SOURCE_URL (e.g. aiosqlite path for an existing SQLite file).
Destination from env DATABASE_URL (Postgres). No schema creation (Alembic on Postgres).

Run from backend directory:
  MIGRATE_SOURCE_URL=... DATABASE_URL=... python migrate_sqlite_to_postgres.py
"""
import asyncio
import os
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

# Ensure backend root is on path so "app" resolves
_backend_root = Path(__file__).resolve().parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

from app.db.models import RecipeModel, MealPlanModel

SOURCE_URL = os.environ.get("MIGRATE_SOURCE_URL")
POSTGRES_URL = os.environ.get("DATABASE_URL")


async def main() -> None:
    if not SOURCE_URL or not SOURCE_URL.strip():
        raise SystemExit("MIGRATE_SOURCE_URL is required (source DB URL for this one-time migration).")
    if not POSTGRES_URL or not POSTGRES_URL.strip():
        raise SystemExit("DATABASE_URL is required (Postgres destination URL).")
    if "postgresql" not in POSTGRES_URL.lower() or "asyncpg" not in POSTGRES_URL.lower():
        raise SystemExit("DATABASE_URL must be a Postgres URL (postgresql+asyncpg://...).")

    connect_args: dict = {}
    if "sqlite" in SOURCE_URL.lower():
        connect_args["check_same_thread"] = False

    engine_source = create_async_engine(SOURCE_URL.strip(), echo=False, connect_args=connect_args)
    engine_postgres = create_async_engine(POSTGRES_URL.strip(), echo=False)

    async_source = async_sessionmaker(
        engine_source,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )
    async_postgres = async_sessionmaker(
        engine_postgres,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    # Read from source DB
    async with async_source() as s_src:
        result_recipes = await s_src.execute(select(RecipeModel))
        recipes = list(result_recipes.scalars().all())
        result_meal_plan = await s_src.execute(select(MealPlanModel))
        meal_plans = list(result_meal_plan.scalars().all())

    # Detach: build new instances for Postgres (same attributes)
    recipes_for_pg = [
        RecipeModel(
            id=r.id,
            title=r.title,
            source_url=r.source_url,
            thumbnail_url=r.thumbnail_url,
            ingredients=r.ingredients,
            raw_extraction_text=r.raw_extraction_text,
        )
        for r in recipes
    ]
    meal_plans_for_pg = [
        MealPlanModel(date=m.date, recipe_ids=m.recipe_ids) for m in meal_plans
    ]

    # Write to Postgres, single commit
    async with async_postgres() as s_pg:
        s_pg.add_all(recipes_for_pg)
        s_pg.add_all(meal_plans_for_pg)
        await s_pg.commit()

    print(f"Migrated {len(recipes_for_pg)} recipes and {len(meal_plans_for_pg)} meal_plan rows.")

    await engine_source.dispose()
    await engine_postgres.dispose()


if __name__ == "__main__":
    asyncio.run(main())
