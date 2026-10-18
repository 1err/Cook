"""Public catalog coverage for the real warmer, with scraping kept offline."""
from __future__ import annotations

import json
import logging

import pytest
import sqlalchemy as sa

from app.jobs import cache_warmer


@pytest.fixture
def catalog(monkeypatch: pytest.MonkeyPatch):
    # Only portable columns are needed to exercise the actual catalog SELECT.
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    recipes = sa.Table(
        "recipes", metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("ingredients", sa.Text, nullable=False),
        sa.Column("is_public_catalog", sa.Boolean, nullable=False),
    )
    metadata.create_all(engine)
    active_sessions = 0

    class CatalogSession:
        async def __aenter__(self):
            nonlocal active_sessions
            active_sessions += 1
            self.connection = engine.connect()
            return self

        async def __aexit__(self, *args):
            nonlocal active_sessions
            self.connection.close()
            active_sessions -= 1

        async def execute(self, statement):
            return self.connection.execute(statement)

    monkeypatch.setattr(cache_warmer.db_session, "async_session_maker", CatalogSession)
    monkeypatch.setattr(cache_warmer, "ALL_QUERIES", ["tofu", "tomato paste"])
    searches = []

    async def fetch(query, session=None, *, force_refresh=False, priority="interactive"):
        # Catalog discovery must release its transaction before waiting on scraping.
        assert active_sessions == 0
        searches.append((query, force_refresh, priority))
        return [{"name": query, "url": "https://www.sayweee.com/product/example"}]

    monkeypatch.setattr(cache_warmer, "fetch_store_products", fetch)

    def insert(recipe_id, ingredients, *, public=True):
        with engine.begin() as connection:
            connection.execute(recipes.insert().values(
                id=recipe_id,
                ingredients=json.dumps(ingredients),
                is_public_catalog=public,
            ))

    yield engine, recipes, insert, searches
    engine.dispose()


@pytest.mark.asyncio
async def test_warmer_includes_all_public_ingredients_with_normalized_unique_queries(catalog):
    """Catches missing catalog discovery, private reads, duplicate work or wrong totals."""
    _, _, insert, searches = catalog
    insert("a", [
        {"name": " TOFU ", "quantity": "1 block"},
        {"name": "  Fenugreek   leaves ", "quantity": "2 cups", "notes": "chopped"},
        {"name": "番茄", "quantity": "2"},
        {"name": "5-spice powder", "quantity": "1 tsp"},
    ])
    insert("b", [{"name": "FENUGREEK leaves", "quantity": "1 cup"}])
    insert("private", [{"name": "private ingredient", "quantity": "1"}], public=False)
    progress = []

    summary = await cache_warmer.run_cache_warmer(
        force_refresh=True,
        progress_callback=lambda *args: progress.append(args),
    )

    expected = ["tofu", "tomato paste", "fenugreek leaves", "番茄", "5-spice powder"]
    assert searches == [(query, True, "background") for query in expected]
    assert summary == {
        "cache_hit": 0, "cache_miss": 5, "empty": 0,
        "skipped": 0, "failed": 0, "total": 5,
    }
    assert progress == [(index, 5, query, "cache_miss")
                        for index, query in enumerate(expected, 1)]
    assert cache_warmer.get_cache_warmer_status()["total"] == 5


@pytest.mark.asyncio
async def test_each_warmer_run_reloads_published_and_removed_catalog_ingredients(catalog):
    """Catches caching the recipe snapshot across daily runs."""
    engine, recipes, insert, searches = catalog
    insert("a", [{"name": "fenugreek leaves", "quantity": "1"}])
    await cache_warmer.run_cache_warmer(force_refresh=True)
    with engine.begin() as connection:
        connection.execute(recipes.update().where(recipes.c.id == "a")
                           .values(is_public_catalog=False))
    insert("b", [{"name": "sumac", "quantity": "1 tsp"}])
    searches.clear()

    summary = await cache_warmer.run_cache_warmer(force_refresh=True)

    assert [query for query, _, _ in searches] == ["tofu", "tomato paste", "sumac"]
    assert summary["total"] == 3


@pytest.mark.asyncio
async def test_malformed_catalog_ingredients_do_not_drop_other_public_recipes(catalog):
    """Catches one bad JSON payload or ingredient aborting the complete sweep."""
    engine, recipes, insert, searches = catalog
    insert("a", {"name": "not an ingredient array"})
    insert("b", [None, "bad item", {}, {"name": 123}, {"name": "  "},
                 {"name": "sumac", "quantity": "1 tsp"}])
    insert("c", None)
    with engine.begin() as connection:
        connection.execute(recipes.insert().values(
            id="bad-json", ingredients="{", is_public_catalog=True,
        ))
    insert("z", [{"name": "葛根粉", "quantity": "1 tsp"}])

    summary = await cache_warmer.run_cache_warmer(force_refresh=True)

    assert [query for query, _, _ in searches] == ["tofu", "tomato paste", "sumac", "葛根粉"]
    assert summary["total"] == 4


@pytest.mark.asyncio
async def test_catalog_discovery_failure_keeps_common_queries_and_logs_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, catalog,
):
    """Catches a catalog outage disabling the existing common-ingredient sweep."""
    _, _, _, searches = catalog

    def unavailable():
        raise RuntimeError("controlled database outage")

    monkeypatch.setattr(cache_warmer.db_session, "async_session_maker", unavailable)
    caplog.set_level(logging.ERROR, logger=cache_warmer.__name__)
    summary = await cache_warmer.run_cache_warmer(force_refresh=True)

    assert [query for query, _, _ in searches] == ["tofu", "tomato paste"]
    assert summary["total"] == 2
    assert any(getattr(record, "event", None) == "cache_warmer_catalog_load_failed"
               for record in caplog.records)
