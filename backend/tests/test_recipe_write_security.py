"""Exercise recipe ownership and protected fields using a disposable SQL database."""
from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.api import routes_recipes, routes_users
from app.db import repo_recipes, repo_users
from app.db.models import RecipeModel, UserModel
from app.models import Recipe


OWNER_ID = UUID("10000000-0000-0000-0000-00000000000a")
CALLER_ID = UUID("10000000-0000-0000-0000-00000000000b")


class SqlSession:
    """Use the real ORM and SQL statements without an external database."""

    def __init__(self, session: Session):
        self.sync = session
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.sync.execute(statement)

    async def merge(self, model):
        return self.sync.merge(model)

    async def flush(self):
        self.sync.flush()

    def add(self, model):
        self.sync.add(model)


@pytest.fixture
def sql_session():
    engine = create_engine("sqlite:///:memory:")
    UserModel.__table__.create(engine)
    RecipeModel.__table__.create(engine)
    with Session(engine) as session:
        session.add_all([
            UserModel(id=OWNER_ID, email="owner@example.com"),
            UserModel(id=CALLER_ID, email="caller@example.com"),
        ])
        session.flush()
        yield SqlSession(session)
    engine.dispose()


def seed_recipe(sql_session, *, owner=OWNER_ID, public=False, source=None):
    row = RecipeModel(
        id="existing-recipe", user_id=owner, title="Original recipe",
        ingredients="[]", is_public_catalog=public, catalog_source_recipe_id=source,
    )
    sql_session.sync.add(row)
    sql_session.sync.flush()
    return row


@pytest.mark.asyncio
async def test_post_rejects_existing_recipe_owned_by_another_account(sql_session):
    original = seed_recipe(sql_session)

    with pytest.raises(HTTPException) as error:
        await routes_recipes.recipe_create(
            Recipe(id=original.id, title="Attacker replacement", ingredients=[]),
            session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
        )

    assert error.value.status_code == 409
    sql_session.sync.expire_all()
    retained = sql_session.sync.get(RecipeModel, original.id)
    assert retained.user_id == OWNER_ID
    assert retained.title == "Original recipe"


@pytest.mark.asyncio
async def test_post_cannot_publish_or_forge_copy_provenance(sql_session):
    saved = await routes_recipes.recipe_create(
        Recipe(
            id="new-recipe", title="Private recipe", ingredients=[],
            is_public_catalog=True, catalog_source_recipe_id="forged-source",
        ),
        session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
    )

    row = sql_session.sync.get(RecipeModel, saved.id)
    assert not row.is_public_catalog
    assert row.catalog_source_recipe_id is None
    assert not saved.is_public_catalog
    assert saved.catalog_source_recipe_id is None


@pytest.mark.asyncio
async def test_owned_retry_keeps_server_fields_and_one_recipe(sql_session):
    row = seed_recipe(sql_session, owner=CALLER_ID, public=True, source="real-source")
    incoming = Recipe(id=row.id, title="Updated recipe", ingredients=[], steps=["Chop onion"])

    first = await repo_recipes.save_recipe(sql_session, incoming, CALLER_ID)
    second = await repo_recipes.save_recipe(sql_session, incoming, CALLER_ID)

    assert first.is_public_catalog and second.is_public_catalog
    assert first.catalog_source_recipe_id == second.catalog_source_recipe_id == "real-source"
    assert second.title == "Updated recipe"
    assert first.steps == second.steps
    assert sql_session.sync.scalar(select(func.count()).select_from(RecipeModel)) == 1
    sql_session.sync.expire_all()
    stored = sql_session.sync.get(RecipeModel, row.id)
    assert stored.user_id == CALLER_ID
    assert json.loads(stored.steps) == [step.model_dump() for step in second.steps]


@pytest.mark.asyncio
async def test_patch_preserves_publication_and_copy_source(sql_session):
    row = seed_recipe(sql_session, owner=CALLER_ID, public=True, source="real-source")
    saved = await routes_recipes.recipe_update(
        row.id, routes_recipes.RecipeUpdate(title="Edited recipe"),
        session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
    )
    assert saved.title == "Edited recipe"
    assert saved.is_public_catalog
    assert saved.catalog_source_recipe_id == "real-source"


@pytest.mark.asyncio
async def test_bulk_recipe_read_filters_ownership_deduplicates_and_uses_one_query(sql_session):
    seed_recipe(sql_session)
    for recipe_id in ["owned-a", "owned-b"]:
        sql_session.sync.add(RecipeModel(
            id=recipe_id, user_id=CALLER_ID, title=recipe_id, ingredients="[]",
        ))
    sql_session.sync.flush()
    recipes = await repo_recipes.get_recipes_by_ids(
        sql_session, ["owned-b", "existing-recipe", "owned-a", "owned-b", "missing"], CALLER_ID,
    )
    assert [recipe.id for recipe in recipes] == ["owned-b", "owned-a"]
    assert len(sql_session.statements) == 1


@pytest.mark.asyncio
async def test_bulk_recipe_read_skips_database_for_empty_input(sql_session):
    assert await repo_recipes.get_recipes_by_ids(sql_session, [], CALLER_ID) == []
    assert sql_session.statements == []


PRIVATE_IMPORT = "Onions and broth.\n\nUser guidance:\nSynthetic private planning note."


def share_private_import(sql_session):
    row = seed_recipe(sql_session, public=True)
    row.raw_extraction_text = PRIVATE_IMPORT
    row.description = "A simple onion soup"
    row.source_url = "https://example.com/onion-soup"
    sql_session.sync.get(UserModel, OWNER_ID).is_library_public = True
    sql_session.sync.flush()
    return row


@pytest.mark.asyncio
async def test_shared_views_hide_import_guidance_while_owned_read_preserves_it(sql_session):
    row = share_private_import(sql_session)
    catalog = await repo_recipes.list_public_recipes(sql_session)
    public_detail = await repo_recipes.get_public_recipe(sql_session, row.id)
    friend = await routes_users.friend_library_recipes(
        OWNER_ID, session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
    )
    for shared in [*catalog, public_detail, *friend]:
        assert shared.raw_extraction_text is None
        assert shared.description == "A simple onion soup"
        assert shared.source_url == "https://example.com/onion-soup"
    owned = await repo_recipes.get_recipe(sql_session, row.id, OWNER_ID)
    assert owned.raw_extraction_text == PRIVATE_IMPORT
    assert sql_session.sync.get(RecipeModel, row.id).raw_extraction_text == PRIVATE_IMPORT


@pytest.mark.asyncio
@pytest.mark.parametrize("copy_path", ["catalog", "friend"])
async def test_cross_account_copy_does_not_persist_original_import_guidance(sql_session, copy_path):
    row = share_private_import(sql_session)
    if copy_path == "catalog":
        copied = await repo_recipes.copy_public_recipe_to_user(sql_session, row.id, CALLER_ID)
    else:
        copied = await repo_users.copy_friend_recipe_to_user(sql_session, OWNER_ID, row.id, CALLER_ID)
    assert copied.raw_extraction_text is None
    assert copied.source_url == row.source_url
    assert copied.description == row.description
    assert sql_session.sync.get(RecipeModel, copied.id).raw_extraction_text is None
    assert row.raw_extraction_text == PRIVATE_IMPORT


@pytest.mark.asyncio
async def test_copy_retry_does_not_rewrite_historical_import_data(sql_session):
    source = share_private_import(sql_session)
    legacy = RecipeModel(
        id="legacy-copy", user_id=CALLER_ID, title="Existing copy", ingredients="[]",
        catalog_source_recipe_id=source.id, raw_extraction_text="Existing historical data",
    )
    sql_session.sync.add(legacy)
    sql_session.sync.flush()
    copied = await repo_recipes.copy_public_recipe_to_user(sql_session, source.id, CALLER_ID)
    assert copied.id == legacy.id
    assert sql_session.sync.get(RecipeModel, legacy.id).raw_extraction_text == "Existing historical data"
