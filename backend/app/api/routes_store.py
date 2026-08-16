"""
Store product lookup route.

Returns a small list of live product results from supported stores.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db.session import get_session
from app.db.models import UserModel
from app.services.store_scraper import (
    CACHE_TTL_SECONDS,
    fetch_store_products_with_metadata,
)

router = APIRouter(tags=["store"])


class StoreProduct(BaseModel):
    name: str
    price: str
    image: str
    url: str


class StoreProductsResponse(BaseModel):
    products: list[StoreProduct]
    expires_at: datetime | None


@router.get("/store-products", response_model=StoreProductsResponse)
async def store_products(
    query: str = Query(..., min_length=1),
    store: str | None = Query(default="weee"),
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
):
    """Return products plus the authoritative expiry of any positive result."""
    _ = current_user

    normalized_store = (store or "weee").strip().lower()
    if normalized_store != "weee":
        raise HTTPException(status_code=400, detail="Unsupported store. Use weee.")

    result = await fetch_store_products_with_metadata(query, session=session)
    expires_at = (
        result.cached_at + timedelta(seconds=CACHE_TTL_SECONDS)
        if result.cached_at is not None
        else None
    )
    return StoreProductsResponse(products=result.products, expires_at=expires_at)
