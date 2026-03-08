"""
Amazon store integration. Stub returns empty list until PA-API is integrated.
"""
from app.services.stores.base import BaseStoreService, StoreItem


class AmazonStoreService(BaseStoreService):
    """Placeholder for Amazon Product Advertising API. Returns empty list for now."""

    def search(self, store: str, query: str) -> list[StoreItem]:
        # TODO: Integrate PA-API when ready; map response to StoreItem list.
        return []


amazon_store = AmazonStoreService()
