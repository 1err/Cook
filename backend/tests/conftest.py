import os

import pytest

# Ordinary tests must never inherit a developer's production credentials. Tests
# needing PostgreSQL opt in separately with TEST_DATABASE_URL and a disposable DB.
os.environ["DATABASE_URL"] = "postgresql+asyncpg://test:test@localhost:5432/test"
os.environ["OPENAI_API_KEY"] = ""
os.environ["APP_ENV"] = "test"

from app.services import store_product_service, store_scraper


@pytest.fixture(autouse=True)
def clear_product_memory_cache():
    store_product_service.CACHE.clear()
    store_scraper.CACHE.clear()
    yield
    store_product_service.CACHE.clear()
    store_scraper.CACHE.clear()
