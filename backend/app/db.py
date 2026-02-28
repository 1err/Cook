"""Simple SQLite storage. In-memory or file-based."""
import aiosqlite
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional
from app.models import Recipe, MealPlan

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("COOKING_DB_PATH", "cooking.db")


async def get_connection():
    return await aiosqlite.connect(DB_PATH)


async def init_db():
    """Create tables if they don't exist."""
    conn = await get_connection()
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                source_url TEXT,
                thumbnail_url TEXT,
                ingredients TEXT NOT NULL,
                raw_extraction_text TEXT
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS meal_plan (
                date TEXT PRIMARY KEY,
                recipe_ids TEXT NOT NULL
            )
        """)
        await conn.execute("DROP TABLE IF EXISTS pantry_items")
        await conn.execute("DROP TABLE IF EXISTS inventory_items")
        await conn.commit()
    finally:
        await conn.close()


async def save_recipe(recipe: Recipe) -> Recipe:
    conn = await get_connection()
    try:
        await conn.execute(
            """
            INSERT OR REPLACE INTO recipes (id, title, source_url, thumbnail_url, ingredients, raw_extraction_text)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                recipe.id,
                recipe.title,
                recipe.source_url,
                recipe.thumbnail_url,
                json.dumps(
                    [
                        i.model_dump() if hasattr(i, "model_dump") else i
                        for i in recipe.ingredients
                    ]
                ),
                recipe.raw_extraction_text,
            ),
        )
        await conn.commit()
        return recipe
    finally:
        await conn.close()


async def get_recipe(recipe_id: str) -> Optional[Recipe]:
    conn = await get_connection()
    try:
        cursor = await conn.execute(
            "SELECT id, title, source_url, thumbnail_url, ingredients, raw_extraction_text FROM recipes WHERE id = ?",
            (recipe_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        return _row_to_recipe(row)
    finally:
        await conn.close()


async def list_recipes() -> list[Recipe]:
    conn = await get_connection()
    try:
        cursor = await conn.execute(
            "SELECT id, title, source_url, thumbnail_url, ingredients, raw_extraction_text FROM recipes ORDER BY id"
        )
        rows = await cursor.fetchall()
        return [_row_to_recipe(r) for r in rows]
    finally:
        await conn.close()


async def delete_recipe(recipe_id: str) -> bool:
    """Delete a recipe by id. Returns True if deleted, False if not found."""
    conn = await get_connection()
    try:
        cursor = await conn.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
        await conn.commit()
        return cursor.rowcount > 0
    finally:
        await conn.close()


def _row_to_recipe(row) -> Recipe:
    from app.models import IngredientItem

    return Recipe(
        id=row[0],
        title=row[1],
        source_url=row[2],
        thumbnail_url=row[3],
        ingredients=[IngredientItem(**i) for i in json.loads(row[4] or "[]")],
        raw_extraction_text=row[5],
    )


async def get_meal_plans_in_range(start_date: str, end_date: str) -> list[MealPlan]:
    """Return meal plans for dates in [start_date, end_date] (inclusive)."""
    conn = await get_connection()
    try:
        cursor = await conn.execute(
            "SELECT date, recipe_ids FROM meal_plan WHERE date >= ? AND date <= ? ORDER BY date",
            (start_date, end_date),
        )
        rows = await cursor.fetchall()
        return [
            MealPlan(id=row[0], date=row[0], recipe_ids=json.loads(row[1] or "[]"))
            for row in rows
        ]
    finally:
        await conn.close()


async def put_meal_plan(date: str, recipe_ids: list[str]) -> MealPlan:
    """Create or replace meal plan for the given date."""
    conn = await get_connection()
    try:
        await conn.execute(
            "INSERT OR REPLACE INTO meal_plan (date, recipe_ids) VALUES (?, ?)",
            (date, json.dumps(recipe_ids)),
        )
        await conn.commit()
        return MealPlan(id=date, date=date, recipe_ids=recipe_ids)
    finally:
        await conn.close()

