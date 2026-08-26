"""
Persistent cache access for store product lookups.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from collections.abc import Sequence
import math

from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CachedStoreProductModel
from app.core.store_products import normalize_store_products

_DATETIME_TYPE = datetime


@dataclass(frozen=True)
class CachedStoreProducts:
    products: list[dict[str, str]]
    updated_at: datetime


def is_cache_entry_fresh(
    updated_at: datetime,
    now: datetime,
    max_age_seconds: int,
) -> bool:
    if not isinstance(updated_at, _DATETIME_TYPE) or not isinstance(now, _DATETIME_TYPE):
        return False
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    try:
        age_seconds = (now - updated_at).total_seconds()
    except (OverflowError, TypeError, ValueError):
        return False
    return (
        math.isfinite(age_seconds)
        and 0 <= age_seconds < max_age_seconds
    )


def normalize_cached_store_products(data: object) -> list[dict[str, str]] | None:
    if not isinstance(data, list):
        return None
    return normalize_store_products(data)


async def get_cached_store_products(
    session: AsyncSession,
    *,
    query: str,
    store: str,
    language: str,
    cache_version: str,
    max_age_seconds: int,
) -> list[dict[str, str]] | None:
    entry = await get_cached_store_products_with_metadata(
        session,
        query=query,
        store=store,
        language=language,
        cache_version=cache_version,
        max_age_seconds=max_age_seconds,
    )
    return entry.products if entry is not None else None


async def get_cached_store_products_with_metadata(
    session: AsyncSession,
    *,
    query: str,
    store: str,
    language: str,
    cache_version: str,
    max_age_seconds: int,
) -> CachedStoreProducts | None:
    result = await session.execute(
        select(CachedStoreProductModel).where(
            CachedStoreProductModel.query == query,
            CachedStoreProductModel.store == store,
            CachedStoreProductModel.language == language,
            CachedStoreProductModel.cache_version == cache_version,
        )
    )
    row = result.scalars().one_or_none()
    if row is None or not isinstance(row.updated_at, _DATETIME_TYPE):
        return None
    updated_at = row.updated_at
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    if not is_cache_entry_fresh(
        updated_at,
        datetime.now(timezone.utc),
        max_age_seconds,
    ):
        return None
    products = normalize_cached_store_products(row.data)
    return CachedStoreProducts(products=products, updated_at=updated_at) if products else None


async def get_cached_store_products_batch(
    session: AsyncSession,
    *,
    keys: Sequence[tuple[str, str]],
    store: str,
    cache_version: str,
    max_age_seconds: int,
) -> dict[tuple[str, str], CachedStoreProducts]:
    unique_keys = list(dict.fromkeys(keys))
    if not unique_keys:
        return {}
    result = await session.execute(
        select(CachedStoreProductModel).where(
            CachedStoreProductModel.store == store,
            CachedStoreProductModel.cache_version == cache_version,
            tuple_(CachedStoreProductModel.query, CachedStoreProductModel.language).in_(unique_keys),
        )
    )
    now = datetime.now(timezone.utc)
    entries: dict[tuple[str, str], CachedStoreProducts] = {}
    for row in result.scalars().all():
        if not isinstance(row.updated_at, _DATETIME_TYPE):
            continue
        updated_at = row.updated_at.replace(tzinfo=timezone.utc) if row.updated_at.tzinfo is None else row.updated_at
        products = normalize_cached_store_products(row.data)
        if products and is_cache_entry_fresh(updated_at, now, max_age_seconds):
            entries[(row.query, row.language)] = CachedStoreProducts(products, updated_at)
    return entries


async def get_cached_store_product_entry(
    session: AsyncSession,
    *,
    query: str,
    store: str,
    language: str,
    cache_version: str,
) -> CachedStoreProductModel | None:
    result = await session.execute(
        select(CachedStoreProductModel).where(
            CachedStoreProductModel.query == query,
            CachedStoreProductModel.store == store,
            CachedStoreProductModel.language == language,
            CachedStoreProductModel.cache_version == cache_version,
        )
    )
    return result.scalars().one_or_none()


async def list_cached_store_product_entries(
    session: AsyncSession,
    *,
    store: str | None = None,
    cache_version: str | None = None,
    updated_before: datetime | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[CachedStoreProductModel]:
    stmt = select(CachedStoreProductModel)
    if store is not None:
        stmt = stmt.where(CachedStoreProductModel.store == store)
    if cache_version is not None:
        stmt = stmt.where(CachedStoreProductModel.cache_version == cache_version)
    if updated_before is not None:
        stmt = stmt.where(CachedStoreProductModel.updated_at <= updated_before)
    stmt = stmt.order_by(
        CachedStoreProductModel.updated_at.desc(),
        CachedStoreProductModel.query.asc(),
        CachedStoreProductModel.store.asc(),
    )
    if offset > 0:
        stmt = stmt.offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def count_cached_store_product_entries(
    session: AsyncSession,
    *,
    store: str | None = None,
    cache_version: str | None = None,
    updated_before: datetime | None = None,
) -> int:
    stmt = select(func.count()).select_from(CachedStoreProductModel)
    if store is not None:
        stmt = stmt.where(CachedStoreProductModel.store == store)
    if cache_version is not None:
        stmt = stmt.where(CachedStoreProductModel.cache_version == cache_version)
    if updated_before is not None:
        stmt = stmt.where(CachedStoreProductModel.updated_at <= updated_before)
    result = await session.execute(stmt)
    return int(result.scalar_one())


async def upsert_cached_store_products(
    session: AsyncSession,
    *,
    query: str,
    store: str,
    language: str,
    cache_version: str,
    data: list[dict[str, str]],
    updated_at: datetime,
) -> bool:
    result = await session.execute(
        select(CachedStoreProductModel).where(
            CachedStoreProductModel.query == query,
            CachedStoreProductModel.store == store,
            CachedStoreProductModel.language == language,
            CachedStoreProductModel.cache_version == cache_version,
        ).with_for_update()
    )
    row = result.scalars().one_or_none()
    normalized = normalize_cached_store_products(data)
    if not normalized:
        return False
    if row is None:
        row = CachedStoreProductModel(
            query=query,
            store=store,
            language=language,
            cache_version=cache_version,
            data=normalized,
            updated_at=updated_at,
        )
        session.add(row)
    else:
        if row.updated_at >= updated_at:
            return False
        row.data = normalized
        row.updated_at = updated_at
    await session.flush()
    return True
