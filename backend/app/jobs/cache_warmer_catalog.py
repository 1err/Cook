"""One normalized public-first snapshot for local and durable warming."""
from collections.abc import Iterable, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import repo_recipes
from app.jobs import cache_warmer_queries
from app.services.store_product_service import prepare_store_query


def normalize_cache_warmer_queries(candidates: Iterable[str]) -> list[str]:
    queries: dict[tuple[str, str], str] = {}
    for candidate in candidates:
        prepared = prepare_store_query(candidate)
        if prepared is not None:
            key = (prepared.language, prepared.cache_query)
            queries.setdefault(key, prepared.cache_query)
    return list(queries.values())


async def load_cache_warmer_queries(
    session: AsyncSession,
    *,
    common_queries: Sequence[str] | None = None,
) -> list[str]:
    """Use the caller's transaction; failed discovery must abort durable admission."""
    public_names = await repo_recipes.list_public_ingredient_names(session)
    common = cache_warmer_queries.ALL_QUERIES if common_queries is None else common_queries
    return normalize_cache_warmer_queries([*public_names, *common])
