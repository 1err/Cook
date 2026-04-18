# pyright: reportMissingImports=false
"""
Delete polluted cached store-product queries containing banned Chinese modifiers.

Run from the repo root:
  python scripts/cleanup_bad_store_cache_queries.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import delete, or_

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

load_dotenv(BACKEND_ROOT / ".env")

from app.core.config import settings
from app.db import session as db_session
from app.db.models import CachedStoreProductModel


async def delete_bad_queries() -> int:
    _ = settings.DATABASE_URL
    db_session.init_engine()
    if db_session.async_session_maker is None:
        raise RuntimeError("Database session maker is not initialized.")

    async with db_session.async_session_maker() as session:
        stmt = delete(CachedStoreProductModel).where(
            or_(
                CachedStoreProductModel.query.contains("新鲜"),
                CachedStoreProductModel.query.contains("切块"),
            )
        )
        result = await session.execute(stmt)
        await session.commit()
        return int(result.rowcount or 0)


async def main() -> None:
    deleted = await delete_bad_queries()
    print(f"Deleted {deleted} polluted cache rows.")


if __name__ == "__main__":
    asyncio.run(main())
