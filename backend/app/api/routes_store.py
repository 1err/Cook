"""
Store product lookup route.

Returns current Weee results with an explicit legacy response shape for old clients.
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


StoreProductsRouteResponse = StoreProductsResponse | list[StoreProduct]


@router.get("/store-products", response_model=StoreProductsRouteResponse)
async def store_products(
    query: str = Query(..., min_length=1),
    store: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
) -> StoreProductsRouteResponse:
    """Return expiry metadata by default or the legacy array for explicit Weee clients."""
    _ = current_user

    if store is not None and store.strip().lower() != "weee":
        raise HTTPException(status_code=400, detail="Unsupported store. Use weee.")

    result = await fetch_store_products_with_metadata(query, session=session)
    products = [StoreProduct.model_validate(product) for product in result.products]
    if store is not None:
        return products
    expires_at = (
        result.cached_at + timedelta(seconds=CACHE_TTL_SECONDS)
        if result.cached_at is not None
        else None
    )
    return StoreProductsResponse(products=products, expires_at=expires_at)
