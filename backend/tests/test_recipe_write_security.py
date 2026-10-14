"""Exercise recipe ownership and protected fields using a disposable SQL database."""
from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
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

    def get_bind(self):
        return self.sync.get_bind()

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
    from readiness_schema import create_readiness_schema
    create_readiness_schema(engine)
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
async def test_source_link_patch_adds_replaces_and_clears_without_changing_recipe(sql_session):
    row = seed_recipe(sql_session, owner=CALLER_ID, public=True, source="real-source")
    row.description = "Keep my edited description"
    row.ingredients = json.dumps([{"name": "Onion", "quantity": "1"}])
    row.steps = json.dumps([{"id": "00000000-0000-0000-0000-000000000123", "text": "Chop the onion"}])
    row.raw_extraction_text = "Private import notes"
    sql_session.sync.flush()
    original = await repo_recipes.get_recipe(sql_session, row.id, CALLER_ID)
    original_content = original.model_dump(exclude={"source_url"})

    for source, expected in [
        ("  https://example.com/recipe?language=zh  ", "https://example.com/recipe?language=zh"),
        ("http://another.example/recipe", "http://another.example/recipe"),
        (None, None),
        ("https://example.com/new-source", "https://example.com/new-source"),
        ("   ", None),
    ]:
        saved = await routes_recipes.recipe_update(
            row.id, routes_recipes.RecipeUpdate(source_url=source),
            session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
        )
        assert saved.source_url == expected
        assert saved.model_dump(exclude={"source_url"}) == original_content
        sql_session.sync.expire_all()
        reloaded = await repo_recipes.get_recipe(sql_session, row.id, CALLER_ID)
        assert reloaded.source_url == expected
        assert reloaded.model_dump(exclude={"source_url"}) == original_content


@pytest.mark.asyncio
async def test_patch_omitting_source_link_preserves_existing_source(sql_session):
    row = seed_recipe(sql_session, owner=CALLER_ID)
    row.source_url = "https://example.com/original"
    sql_session.sync.flush()
    saved = await routes_recipes.recipe_update(
        row.id, routes_recipes.RecipeUpdate(title="Updated title"),
        session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
    )
    assert saved.source_url == "https://example.com/original"


@pytest.mark.asyncio
async def test_source_link_patch_cannot_edit_another_users_public_recipe(sql_session):
    row = seed_recipe(sql_session, public=True)
    row.source_url = "https://example.com/original"
    sql_session.sync.flush()
    with pytest.raises(HTTPException) as error:
        await routes_recipes.recipe_update(
            row.id, routes_recipes.RecipeUpdate(source_url="https://example.com/replacement"),
            session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
        )
    assert error.value.status_code == 404
    sql_session.sync.expire_all()
    assert sql_session.sync.get(RecipeModel, row.id).source_url == "https://example.com/original"


@pytest.mark.parametrize("source", [
    "javascript:alert(1)",
    "data:text/html,test",
    "ftp://example.com/recipe",
    "/relative-recipe",
    "https://",
    "https://user:password@example.com/recipe",
    "https://user@example.com/recipe",
    "https://example.com/with space",
    "https://example.com/with\nnewline",
    "https://example.com/with\ttab",
    "https://example.com/with\x00null",
    "https://example.com/with\x7fdelete",
    "https://example.com\\@other.example/recipe",
    "https://example.com/" + "a" * 4096,
])
def test_source_link_patch_rejects_unsafe_or_invalid_urls(source):
    with pytest.raises(ValidationError):
        routes_recipes.RecipeUpdate(source_url=source)


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
@pytest.mark.parametrize(
    ("active_metadata", "hands_on_minutes", "is_estimate"),
    [
        ({"duration_seconds": 600, "duration_source": "stated", "attention_type": "hands_on"}, 10, False),
        ({"duration_seconds": 600, "duration_source": "estimated", "attention_type": "hands_on"}, 10, True),
        ({"duration_seconds": 600, "duration_source": "fallback", "attention_type": "hands_on"}, None, False),
        ({"attention_type": "hands_on"}, None, False),
        ({"duration_seconds": 600, "duration_source": "stated"}, None, False),
        ({"duration_seconds": 600, "duration_source": "stated", "attention_type": "unknown"}, None, False),
        ({"duration_seconds": 600, "attention_type": "hands_on"}, None, False),
    ],
    ids=["stated", "estimated", "fallback", "missing-duration", "missing-attention", "unknown-attention", "missing-source"],
)
async def test_recipe_details_share_raw_timing_without_private_import_text(
    sql_session, active_metadata, hands_on_minutes, is_estimate,
):
    row = share_private_import(sql_session)
    row.total_time_minutes = 490
    row.steps = json.dumps([
        {"text": "Mix dough", **active_metadata},
        {"text": "Chill dough", "duration_seconds": 28800, "duration_source": "stated", "attention_type": "passive"},
    ])
    sql_session.sync.flush()
    stored_steps = row.steps

    owned = await routes_recipes.recipe_get(
        row.id, session=sql_session, current_user=SimpleNamespace(id=OWNER_ID),
    )
    public = await repo_recipes.get_public_recipe(sql_session, row.id)
    catalog = await repo_recipes.list_public_recipes(sql_session)
    friend = await routes_users.friend_recipe_detail(
        OWNER_ID, row.id, session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
    )
    friend_library = await routes_users.friend_library_recipes(
        OWNER_ID, session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
    )

    for recipe in [owned, public, *catalog, friend, *friend_library]:
        payload = recipe.model_dump(mode="json")
        assert payload.get("timing_summary") == {
            "hands_on_minutes": hands_on_minutes,
            "passive_minutes": 480,
            "is_estimate": is_estimate,
        }
        assert payload["total_time_minutes"] == 490
        assert [step["text"] for step in payload["steps"]] == ["Mix dough", "Chill dough"]
    for shared in [public, *catalog, friend, *friend_library]:
        assert shared.raw_extraction_text is None
        assert PRIVATE_IMPORT not in shared.model_dump_json()
    assert not friend.already_saved
    assert owned.raw_extraction_text == PRIVATE_IMPORT
    assert sql_session.sync.get(RecipeModel, row.id).steps == stored_steps


@pytest.mark.asyncio
async def test_saved_detail_recomputes_timing_instead_of_accepting_client_summary(sql_session):
    steps = [
        {"text": "Mix dough", "duration_seconds": 600, "duration_source": "user", "attention_type": "hands_on"},
        {"text": "Chill dough", "duration_seconds": 28800, "duration_source": "user", "attention_type": "passive"},
    ]
    saved = await routes_recipes.recipe_create(
        Recipe(
            id="timed-recipe", title="Dough", ingredients=[], total_time_minutes=490,
            steps=steps,
            timing_summary={"hands_on_minutes": 999, "passive_minutes": 999, "is_estimate": True},
        ),
        session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
    )
    assert saved.model_dump().get("timing_summary") == {
        "hands_on_minutes": 10, "passive_minutes": 480, "is_estimate": False,
    }

    updated = await routes_recipes.recipe_update(
        saved.id,
        routes_recipes.RecipeUpdate(steps=[steps[0], {**steps[1], "duration_seconds": 14400}]),
        session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
    )
    assert updated.model_dump().get("timing_summary") == {
        "hands_on_minutes": 10, "passive_minutes": 240, "is_estimate": False,
    }
    assert updated.total_time_minutes == 490


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


@pytest.mark.asyncio
async def test_unbookmark_owned_source_keeps_public_recipe_and_restores_same_edits(sql_session):
    source = share_private_import(sql_session)
    original = (await repo_recipes.get_recipe(sql_session, source.id, OWNER_ID)).model_dump()
    for _ in range(2):
        response = await routes_recipes.unsave_catalog_recipe(
            source.id, session=sql_session, current_user=SimpleNamespace(id=OWNER_ID),
        )
        assert response.bookmark_states == {source.id: False}
    assert await repo_recipes.list_recipes(sql_session, OWNER_ID) == []
    assert await repo_users.list_friend_library_recipes(sql_session, OWNER_ID) == []
    assert (await repo_recipes.get_public_recipe(sql_session, source.id)).id == source.id
    assert [r.id for r in await repo_recipes.list_public_recipes(sql_session)] == [source.id]
    # Existing planner references and editing still resolve the owned recipe.
    assert (await repo_recipes.get_recipes_by_ids(sql_session, [source.id], OWNER_ID))[0].model_dump() == original
    restored = await repo_recipes.copy_public_recipe_to_user(sql_session, source.id, OWNER_ID)
    assert restored.model_dump() == original
    assert [r.id for r in await repo_recipes.list_recipes(sql_session, OWNER_ID)] == [source.id]
    assert sql_session.sync.scalar(select(func.count()).select_from(RecipeModel)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('restore_path', ['catalog', 'friend'])
async def test_unbookmark_only_hides_callers_copies_and_restores_edited_copy(sql_session, restore_path):
    source = share_private_import(sql_session)
    copy = await repo_recipes.copy_public_recipe_to_user(sql_session, source.id, CALLER_ID)
    row = sql_session.sync.get(RecipeModel, copy.id)
    row.title = 'My edited soup'
    row.raw_extraction_text = 'My private edits'
    sql_session.sync.flush()
    original = (await repo_recipes.get_recipe(sql_session, copy.id, CALLER_ID)).model_dump()
    await repo_recipes.unsave_public_recipe(sql_session, source.id, CALLER_ID)
    assert await repo_recipes.list_recipes(sql_session, CALLER_ID) == []
    assert [r.id for r in await repo_recipes.list_recipes(sql_session, OWNER_ID)] == [source.id]
    detail = await routes_users.friend_recipe_detail(
        OWNER_ID, source.id, session=sql_session, current_user=SimpleNamespace(id=CALLER_ID),
    )
    assert not detail.already_saved
    if restore_path == 'catalog':
        restored = await repo_recipes.copy_public_recipe_to_user(sql_session, source.id, CALLER_ID)
    else:
        restored = repo_recipes._row_to_recipe(await repo_users.copy_friend_recipe_to_user(sql_session, OWNER_ID, source.id, CALLER_ID))
    assert restored.model_dump() == original
    assert sql_session.sync.scalar(select(func.count()).select_from(RecipeModel)) == 2


@pytest.mark.asyncio
async def test_unbookmark_missing_private_source_cannot_hide_other_accounts_recipe(sql_session):
    row = seed_recipe(sql_session)
    with pytest.raises(HTTPException) as error:
        await routes_recipes.unsave_catalog_recipe(row.id, session=sql_session, current_user=SimpleNamespace(id=CALLER_ID))
    assert error.value.status_code == 404
    assert [r.id for r in await repo_recipes.list_recipes(sql_session, OWNER_ID)] == [row.id]


@pytest.mark.asyncio
async def test_hidden_library_recipe_cannot_be_read_or_copied_through_friend_library(sql_session):
    source = share_private_import(sql_session)
    await repo_recipes.unsave_public_recipe(sql_session, source.id, OWNER_ID)
    with pytest.raises(HTTPException) as error:
        await routes_users.friend_recipe_detail(OWNER_ID, source.id, session=sql_session, current_user=SimpleNamespace(id=CALLER_ID))
    assert error.value.status_code == 404
    assert await repo_users.copy_friend_recipe_to_user(sql_session, OWNER_ID, source.id, CALLER_ID) is None
    assert await repo_recipes.get_public_recipe(sql_session, source.id) is not None


@pytest.mark.asyncio
async def test_related_published_copy_bookmarks_reconcile_without_losing_recipe_data(sql_session):
    source = share_private_import(sql_session)
    copy = await repo_recipes.copy_public_recipe_to_user(sql_session, source.id, CALLER_ID)
    row = sql_session.sync.get(RecipeModel, copy.id)
    row.is_public_catalog = True
    row.title = 'My published edited copy'
    sql_session.sync.flush()
    states = await repo_recipes.unsave_public_recipe(sql_session, source.id, CALLER_ID)
    assert states == {source.id: False, copy.id: False}
    response = await routes_recipes.copy_catalog_recipe(copy.id, session=sql_session, current_user=SimpleNamespace(id=CALLER_ID))
    assert response.id == copy.id and response.title == 'My published edited copy'
    assert response.bookmark_states == {source.id: True, copy.id: True}
    assert sql_session.sync.scalar(select(func.count()).select_from(RecipeModel)) == 2
