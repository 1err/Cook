"""
Store product lookup route.

Returns current Weee results with an explicit legacy response shape for old clients.
"""
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db.session import get_session
from app.db.models import UserModel
from app.services.store_product_service import (
    CACHE_TTL_SECONDS,
    fetch_cached_store_products_batch,
    fetch_store_products_with_metadata,
    prepare_store_query,
)
from app.services.weee_scraper import StoreScrapeError

router = APIRouter(tags=["store"])


class StoreProduct(BaseModel):
    name: str
    price: str
    image: str
    url: str


class StoreProductsResponse(BaseModel):
    products: list[StoreProduct]
    expires_at: datetime | None


class StoreProductsBatchBody(BaseModel):
    queries: list[str]


class StoreProductsBatchEntryResponse(BaseModel):
    query: str
    status: Literal["fresh", "missing"]
    products: list[StoreProduct]
    expires_at: datetime | None


class StoreProductsBatchResponse(BaseModel):
    entries: list[StoreProductsBatchEntryResponse]


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
    if prepare_store_query(query) is None:
        raise HTTPException(status_code=422, detail="Query cannot be empty.")

    try:
        result = await fetch_store_products_with_metadata(
            query,
            session=session,
            release_read_session_on_miss=True,
        )
    except StoreScrapeError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "weee_temporarily_unavailable"},
            headers={"Retry-After": "3"},
        ) from exc
    products = [StoreProduct.model_validate(product) for product in result.products]
    if store is not None:
        return products
    expires_at = (
        result.cached_at + timedelta(seconds=CACHE_TTL_SECONDS)
        if result.cached_at is not None
        else None
    )
    return StoreProductsResponse(products=products, expires_at=expires_at)


@router.post("/store-products/batch", response_model=StoreProductsBatchResponse)
async def store_products_batch(
    body: StoreProductsBatchBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(get_current_user),
) -> StoreProductsBatchResponse:
    """Return cached Weee products only, without scheduling a live scrape."""
    _ = current_user

    cached_entries = await fetch_cached_store_products_batch(body.queries, session)
    entries = [
        StoreProductsBatchEntryResponse(
            query=entry.query,
            status=entry.status,
            products=[StoreProduct.model_validate(product) for product in entry.products]
            if entry.status == "fresh"
            else [],
            expires_at=(entry.cached_at + timedelta(seconds=CACHE_TTL_SECONDS))
            if entry.status == "fresh" and entry.cached_at is not None
            else None,
        )
        for entry in cached_entries
    ]
    return StoreProductsBatchResponse(entries=entries)
