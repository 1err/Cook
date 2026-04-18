# pyright: reportMissingImports=false
"""
Warm the persistent store-product cache for common ingredient queries.

Run from the repo root:
  python scripts/precompute_store_products.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

load_dotenv(BACKEND_ROOT / ".env")

from app.core.config import settings
from app.db import session as db_session
from app.jobs.cache_warmer import run_cache_warmer


async def main() -> None:
    _ = settings.DATABASE_URL
    db_session.init_engine()
    await run_cache_warmer(progress_callback=lambda i, total, query, status: print(f"[{i}/{total}] {query} — {status}"))


if __name__ == "__main__":
    asyncio.run(main())
