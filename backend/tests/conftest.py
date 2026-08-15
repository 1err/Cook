import os

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")

from app.services import store_scraper


@pytest.fixture(autouse=True)
def clear_product_memory_cache():
    store_scraper.CACHE.clear()
    yield
    store_scraper.CACHE.clear()
