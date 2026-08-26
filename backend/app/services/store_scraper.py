"""Compatibility imports for callers migrated to store_product_service."""
from app.services.store_product_service import (
    CACHE,
    CACHE_TTL_SECONDS,
    CACHE_VERSION,
    BatchStoreProductsEntry,
    StoreProductsResult,
    fetch_cached_store_products_batch,
    fetch_store_products,
    fetch_store_products_with_metadata,
    prepare_store_query,
)
from app.services.weee_scraper import StoreScrapeError

__all__ = [
    "CACHE",
    "CACHE_TTL_SECONDS",
    "CACHE_VERSION",
    "BatchStoreProductsEntry",
    "StoreProductsResult",
    "StoreScrapeError",
    "fetch_cached_store_products_batch",
    "fetch_store_products",
    "fetch_store_products_with_metadata",
    "prepare_store_query",
]
