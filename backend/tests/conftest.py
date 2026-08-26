import os

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")

from app.services import store_product_service, store_scraper


@pytest.fixture(autouse=True)
def clear_product_memory_cache():
    store_product_service.CACHE.clear()
    store_scraper.CACHE.clear()
    yield
    store_product_service.CACHE.clear()
    store_scraper.CACHE.clear()
