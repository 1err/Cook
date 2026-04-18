"""
Persistent cache access for store product lookups.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CachedStoreProductModel


def _normalize_products(data: object) -> list[dict[str, str]] | None:
    if not isinstance(data, list):
        return None
    products: list[dict[str, str]] = []
    for row in data:
        if not isinstance(row, dict):
            return None
        name = row.get("name")
        price = row.get("price")
        image = row.get("image")
        url = row.get("url")
        if not all(isinstance(value, str) for value in (name, price, image, url)):
            return None
        products.append(
            {
                "name": name,
                "price": price,
                "image": image,
                "url": url,
            }
        )
    return products


def _normalize_product_name(name: str) -> str:
    normalized = name.lower()
    normalized = re.sub(r"\d+(\.\d+)?\s*(lb|lbs|oz|g|kg)", "", normalized)
    normalized = re.sub(r"[^a-z0-9\s\u4e00-\u9fff]", "", normalized)
    return normalized.strip()


async def get_cached_store_products(
    session: AsyncSession,
    *,
    query: str,
    store: str,
    language: str,
    cache_version: str,
    max_age_seconds: int,
) -> list[dict[str, str]] | None:
    result = await session.execute(
        select(CachedStoreProductModel).where(
            CachedStoreProductModel.query == query,
            CachedStoreProductModel.store == store,
            CachedStoreProductModel.language == language,
            CachedStoreProductModel.cache_version == cache_version,
        )
    )
    row = result.scalars().one_or_none()
    if row is None or row.updated_at is None:
        return None
    age_cutoff = datetime.now(timezone.utc) - timedelta(seconds=max_age_seconds)
    updated_at = row.updated_at
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    if updated_at < age_cutoff:
        return None
    return _normalize_products(row.data)


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
    cache_version: str | None = None,
    updated_before: datetime | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[CachedStoreProductModel]:
    stmt = select(CachedStoreProductModel)
    if cache_version is not None:
        stmt = stmt.where(CachedStoreProductModel.cache_version == cache_version)
    if updated_before is not None:
        stmt = stmt.where(CachedStoreProductModel.updated_at < updated_before)
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
    cache_version: str | None = None,
    updated_before: datetime | None = None,
) -> int:
    stmt = select(func.count()).select_from(CachedStoreProductModel)
    if cache_version is not None:
        stmt = stmt.where(CachedStoreProductModel.cache_version == cache_version)
    if updated_before is not None:
        stmt = stmt.where(CachedStoreProductModel.updated_at < updated_before)
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
) -> None:
    result = await session.execute(
        select(CachedStoreProductModel).where(
            CachedStoreProductModel.query == query,
            CachedStoreProductModel.store == store,
            CachedStoreProductModel.language == language,
            CachedStoreProductModel.cache_version == cache_version,
        )
    )
    row = result.scalars().one_or_none()
    normalized = _normalize_products(data)
    if normalized is None:
        return
    seen: set[str] = set()
    deduped: list[dict[str, str]] = []
    for product in normalized:
        key = _normalize_product_name(product["name"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(product)
    normalized = deduped[:3]
    if row is None:
        row = CachedStoreProductModel(
            query=query,
            store=store,
            language=language,
            cache_version=cache_version,
            data=normalized,
        )
        session.add(row)
    else:
        row.data = normalized
        row.updated_at = datetime.now(timezone.utc)
    await session.flush()
