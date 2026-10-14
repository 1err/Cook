"""
Admin-only cache preview and refresh endpoints.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID
from app.db import repo_content_safety

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.core.admin import is_admin
from app.db import repo_store_cache
from app.db.models import UserModel
from app.db.session import get_session
from app.jobs.cache_warmer import get_cache_warmer_status, trigger_cache_warmer
from app.jobs.cache_warmer_queries import ALL_QUERIES
from app.jobs import durable_store
from app.db.repo_store_jobs import QueueFull
from app.services.weee_scraper import StoreScrapeError
from app.services.store_product_service import (
    CACHE_TTL_SECONDS,
    CACHE_VERSION,
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
    query: str = Field(..., min_length=1, max_length=512)


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
        data=repo_store_cache.normalize_cached_store_products(getattr(row, "data")) or [],
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
        store="weee",
        cache_version=CACHE_VERSION,
        updated_before=stale_cutoff,
        limit=limit,
        offset=offset,
    )
    items = [_row_to_preview_entry(row) for row in rows]
    total_cached_queries = await repo_store_cache.count_cached_store_product_entries(
        session,
        store="weee",
        cache_version=CACHE_VERSION,
    )
    total_matching_queries = await repo_store_cache.count_cached_store_product_entries(
        session,
        store="weee",
        cache_version=CACHE_VERSION,
        updated_before=stale_cutoff,
    )
    cached_rows = await repo_store_cache.list_cached_store_product_entries(
        session,
        store="weee",
        cache_version=CACHE_VERSION,
    )
    cached_items = [_row_to_preview_entry(row) for row in cached_rows]
    matching_rows = cached_rows if stale_cutoff is None else await repo_store_cache.list_cached_store_product_entries(
        session,
        store="weee",
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
    if durable_store.enabled():
        try:
            started = await durable_store.trigger_warmer(force_refresh=not body.stale_only)
        except QueueFull as exc:
            raise HTTPException(status_code=503, detail="Store queue is full", headers={"Retry-After": "3"}) from exc
    else:
        started = trigger_cache_warmer(force_refresh=not body.stale_only)
    return CacheRefreshResponse(started=bool(started["started"]), status=started["status"])


@router.get("/cache-refresh-status", response_model=CacheRefreshStatusResponse)
async def cache_refresh_status(current_user: UserModel = Depends(require_admin)):
    _ = current_user
    status = await durable_store.warmer_status() if durable_store.enabled() else get_cache_warmer_status()
    return CacheRefreshStatusResponse(**status)


@router.post("/cache-refresh-one", response_model=CachePreviewEntry)
async def cache_refresh_one(
    body: CacheRefreshOneBody,
    session: AsyncSession = Depends(get_session),
    current_user: UserModel = Depends(require_admin),
):
    _ = current_user
    prepared = prepare_store_query(body.query)
    if prepared is None:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    cleaned_query = prepared.cache_query
    language = prepared.language
    try:
        data = await fetch_store_products(
            body.query,
            session=session,
            force_refresh=True,
            release_read_session_on_miss=True,
        )
    except StoreScrapeError as exc:
        raise HTTPException(status_code=503, detail="Store lookup temporarily unavailable", headers={"Retry-After": "3"}) from exc
    row = await repo_store_cache.get_cached_store_product_entry(
        session,
        query=cleaned_query,
        store="weee",
        language=language,
        cache_version=CACHE_VERSION,
    )
    if row is not None:
        return _row_to_preview_entry(row)
    return CachePreviewEntry(
        query=cleaned_query,
        store="weee",
        language=language,
        updated_at=datetime.now(timezone.utc),
        is_warm_query=cleaned_query in ALL_QUERIES,
        data=data,
    )


class ContentReportResponse(BaseModel):
    id: str
    reporter_id: str
    owner_id: str
    recipe_id: str
    reason: str
    notes: str | None
    status: str
    created_at: datetime
    resolution: str | None
    resolution_notes: str | None
    reviewer_id: str | None
    resolved_at: datetime | None
    recipe: dict | None


def _content_report_response(row) -> ContentReportResponse:
    return ContentReportResponse(id=str(row.id), reporter_id=str(row.reporter_id), owner_id=str(row.owner_id),
        recipe_id=row.recipe_id, reason=row.reason, notes=row.notes, status=row.status, created_at=row.created_at,
        resolution=row.resolution, resolution_notes=row.resolution_notes,
        reviewer_id=str(row.reviewer_id) if row.reviewer_id else None, resolved_at=row.resolved_at,
        recipe=row.content_snapshot)


class ContentReportListResponse(BaseModel):
    reports: list[ContentReportResponse]
    total: int


class ResolveContentReportBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['dismiss', 'remove_catalog', 'disable_library', 'remove_shared_content']
    notes: str | None = Field(default=None, max_length=2000)


@router.get('/content-reports', response_model=ContentReportListResponse)
async def content_reports(status: Literal['pending', 'resolved'] = Query(default='pending'),
                          limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
                          session: AsyncSession = Depends(get_session),
                          current_user: UserModel = Depends(require_admin)):
    rows, total = await repo_content_safety.list_reports(session, status, limit, offset)
    return ContentReportListResponse(reports=[_content_report_response(row) for row in rows], total=total)


@router.post('/content-reports/{report_id}/resolve', response_model=ContentReportResponse)
async def resolve_content_report(report_id: UUID, body: ResolveContentReportBody,
                                 session: AsyncSession = Depends(get_session),
                                 current_user: UserModel = Depends(require_admin)):
    row = await repo_content_safety.resolve_report(session, report_id, current_user.id, body.action,
                                                   (body.notes or '').strip() or None)
    return _content_report_response(row)


class MediaReviewResponse(BaseModel):
    id: str
    owner_id: str
    recipe_id: str
    media_digest: str
    status: str
    created_at: datetime
    reviewer_id: str | None
    reviewed_at: datetime | None
    review_notes: str | None
    recipe: dict
    eligible_media_urls: list[str]


def _media_review_response(row) -> MediaReviewResponse:
    from app.services.media_review_service import is_immutable_app_media_url
    snapshot = row.content_snapshot
    urls = [snapshot.get("thumbnail_url")] + [step.get("image_url") for step in snapshot.get("steps", []) if isinstance(step, dict)]
    return MediaReviewResponse(id=str(row.id), owner_id=str(row.owner_id), recipe_id=row.recipe_id,
        media_digest=row.media_digest, status=row.status, created_at=row.created_at,
        reviewer_id=str(row.reviewer_id) if row.reviewer_id else None,
        reviewed_at=row.reviewed_at, review_notes=row.review_notes, recipe=row.content_snapshot,
        eligible_media_urls=list(dict.fromkeys(url for url in urls if is_immutable_app_media_url(url))))


class MediaReviewListResponse(BaseModel):
    reviews: list[MediaReviewResponse]
    total: int


class ReviewMediaBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    decision: Literal['approve', 'reject']
    media_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    notes: str | None = Field(default=None, max_length=2000)


@router.get('/media-reviews', response_model=MediaReviewListResponse)
async def media_reviews(status: Literal['pending', 'approved', 'rejected'] = Query(default='pending'),
                        limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
                        session: AsyncSession = Depends(get_session), current_user: UserModel = Depends(require_admin)):
    from app.db import repo_media_reviews
    rows, total = await repo_media_reviews.list_media_reviews(session, status, limit, offset)
    return MediaReviewListResponse(reviews=[_media_review_response(row) for row in rows], total=total)


@router.post('/media-reviews/{review_id}/review', response_model=MediaReviewResponse)
async def review_media(review_id: UUID, body: ReviewMediaBody,
                       session: AsyncSession = Depends(get_session), current_user: UserModel = Depends(require_admin)):
    from app.db import repo_media_reviews
    row = await repo_media_reviews.review_media(session, review_id, current_user.id, body.decision,
                                                body.media_digest, (body.notes or '').strip() or None)
    return _media_review_response(row)
