"""
Store integration interface. Implementations (Amazon PA-API, Weee, Yami) can be
plugged in without rewriting callers.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Protocol


@dataclass
class StoreItem:
    """A single item from a store search result (for future cart/SKU use)."""
    name: str
    url: str = ""
    sku: str = ""
    price: str = ""


class StoreSearchProtocol(Protocol):
    """Protocol for store search. Implement per store (amazon, weee, yami)."""

    def search(self, store: str, query: str) -> list[StoreItem]:
        """Return list of items for the given store and search query. May be async later."""
        ...


class BaseStoreService(ABC):
    """Abstract base for store integrations."""

    @abstractmethod
    def search(self, store: str, query: str) -> list[StoreItem]:
        """Search the store; return items. Stub may return [] until PA-API etc. are wired."""
        pass
