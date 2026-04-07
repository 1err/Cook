"""
Store product lookup route.

Returns a small list of live product results from supported stores.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.auth import get_current_user
from app.db.models import UserModel
from app.services.store_scraper import SUPPORTED_STORES, fetch_store_products

router = APIRouter(tags=["store"])


class StoreProduct(BaseModel):
    name: str
    price: str
    image: str
    url: str


@router.get("/store-products", response_model=list[StoreProduct])
async def store_products(
    query: str = Query(..., min_length=1),
    store: str = Query(default="weee"),
    current_user: UserModel = Depends(get_current_user),
):
    """Return a few live store products for an ingredient query."""
    _ = current_user

    normalized_store = (store or "").strip().lower()
    if normalized_store not in SUPPORTED_STORES:
        allowed = ", ".join(SUPPORTED_STORES)
        raise HTTPException(400, f"Unsupported store. Use one of: {allowed}.")

    return await fetch_store_products(query, normalized_store)
