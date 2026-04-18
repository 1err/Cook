"""
Admin-only cache preview and refresh endpoints.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.core.admin import is_admin
from app.db import repo_store_cache
from app.db.models import UserModel
from app.db.session import get_session
from app.jobs.cache_warmer import get_cache_warmer_status, trigger_cache_warmer
from app.jobs.cache_warmer_queries import ALL_QUERIES
from app.services.store_scraper import (
    CACHE_TTL_SECONDS,
    CACHE_VERSION,
    SUPPORTED_STORES,
    fetch_store_products,
    prepare_store_query,
)

router = APIRouter(prefix="/admin", tags=["admin"])


class CachedProduct(BaseModel):
    name: str
    price: str
    image: str
    url: str


class CachePreviewEntry(BaseModel):
    query: str
    store: str
    language: str
    updated_at: datetime | None
    is_warm_query: bool
    data: list[CachedProduct]


class CacheRefreshResponse(BaseModel):
    ok: bool = True
    started: bool = True
    status: "CacheRefreshStatusResponse"


class CacheRefreshStatusResponse(BaseModel):
    running: bool
    current: int
    total: int
    last_query: str
    last_status: str
    stale_only: bool
    summary: dict[str, int] | None = None


class CachePreviewResponse(BaseModel):
    items: list[CachePreviewEntry]
    total_cached_queries: int
    total_matching_queries: int
    total_cached_warm_queries: int
    total_cached_extra_queries: int
    total_matching_warm_queries: int
    total_matching_extra_queries: int
    total_cached_products: int
    total_warm_queries: int
    ttl_seconds: int
    limit: int
    offset: int
    stale_only: bool


class CacheRefreshOneBody(BaseModel):
    query: str = Field(..., min_length=1)
    store: str = Field(default="weee", min_length=1)


class CacheRefreshBody(BaseModel):
    stale_only: bool = False


def require_admin(current_user: UserModel = Depends(get_current_user)) -> UserModel:
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def _row_to_preview_entry(row: object) -> CachePreviewEntry:
    query = getattr(row, "query")
    return CachePreviewEntry(
        query=query,
        store=getattr(row, "store"),
        language=getattr(row, "language"),
        updated_at=getattr(row, "updated_at"),
        is_warm_query=query in ALL_QUERIES,
        data=getattr(row, "data") or [],
    )


@router.get("/cache-preview", response_model=CachePreviewResponse)
async def cache_preview(
    stale_only: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(require_admin),
):
    _ = current_user
    stale_cutoff = datetime.now(timezone.utc) - timedelta(seconds=CACHE_TTL_SECONDS) if stale_only else None
    rows = await repo_store_cache.list_cached_store_product_entries(
        session,
        cache_version=CACHE_VERSION,
        updated_before=stale_cutoff,
        limit=limit,
        offset=offset,
    )
    items = [_row_to_preview_entry(row) for row in rows]
    total_cached_queries = await repo_store_cache.count_cached_store_product_entries(
        session,
        cache_version=CACHE_VERSION,
    )
    total_matching_queries = await repo_store_cache.count_cached_store_product_entries(
        session,
        cache_version=CACHE_VERSION,
        updated_before=stale_cutoff,
    )
    cached_rows = await repo_store_cache.list_cached_store_product_entries(
        session,
        cache_version=CACHE_VERSION,
    )
    cached_items = [_row_to_preview_entry(row) for row in cached_rows]
    matching_rows = cached_rows if stale_cutoff is None else await repo_store_cache.list_cached_store_product_entries(
        session,
        cache_version=CACHE_VERSION,
        updated_before=stale_cutoff,
    )
    matching_items = cached_items if stale_cutoff is None else [_row_to_preview_entry(row) for row in matching_rows]
    total_cached_warm_queries = sum(1 for item in cached_items if item.is_warm_query)
    total_cached_extra_queries = sum(1 for item in cached_items if not item.is_warm_query)
    total_matching_warm_queries = sum(1 for item in matching_items if item.is_warm_query)
    total_matching_extra_queries = sum(1 for item in matching_items if not item.is_warm_query)
    total_cached_products = sum(len(item.data) for item in items)
    return CachePreviewResponse(
        items=items,
        total_cached_queries=total_cached_queries,
        total_matching_queries=total_matching_queries,
        total_cached_warm_queries=total_cached_warm_queries,
        total_cached_extra_queries=total_cached_extra_queries,
        total_matching_warm_queries=total_matching_warm_queries,
        total_matching_extra_queries=total_matching_extra_queries,
        total_cached_products=total_cached_products,
        total_warm_queries=len(ALL_QUERIES),
        ttl_seconds=CACHE_TTL_SECONDS,
        limit=limit,
        offset=offset,
        stale_only=stale_only,
    )


@router.post("/cache-refresh", response_model=CacheRefreshResponse)
async def cache_refresh(
    body: CacheRefreshBody,
    current_user: UserModel = Depends(require_admin),
):
    _ = current_user
    started = trigger_cache_warmer(force_refresh=not body.stale_only)
    return CacheRefreshResponse(started=bool(started["started"]), status=started["status"])


@router.get("/cache-refresh-status", response_model=CacheRefreshStatusResponse)
async def cache_refresh_status(current_user: UserModel = Depends(require_admin)):
    _ = current_user
    return CacheRefreshStatusResponse(**get_cache_warmer_status())


@router.post("/cache-refresh-one", response_model=CachePreviewEntry)
async def cache_refresh_one(
    body: CacheRefreshOneBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(require_admin),
):
    _ = current_user
    normalized_store = (body.store or "").strip().lower()
    if normalized_store not in SUPPORTED_STORES:
        allowed = ", ".join(SUPPORTED_STORES)
        raise HTTPException(status_code=400, detail=f"Unsupported store. Use one of: {allowed}.")
    prepared = prepare_store_query(body.query, normalized_store)
    if prepared is None:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    cleaned_query, language = prepared
    data = await fetch_store_products(body.query, normalized_store, session=session, force_refresh=True)
    await session.commit()
    row = await repo_store_cache.get_cached_store_product_entry(
        session,
        query=cleaned_query,
        store=normalized_store,
        language=language,
        cache_version=CACHE_VERSION,
    )
    if row is not None:
        return _row_to_preview_entry(row)
    return CachePreviewEntry(
        query=cleaned_query,
        store=normalized_store,
        language=language,
        updated_at=datetime.now(timezone.utc),
        data=data,
    )
