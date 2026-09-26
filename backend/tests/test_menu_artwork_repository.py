"""Purpose isolation for durable recipe covers and menu artwork."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session


from test_recipe_image_generation import image_app


@pytest.fixture
def image_repository(image_app, monkeypatch):
    from app.core.config import settings
    from app.db.models import AIUsageCounterModel, RecipeImageGenerationModel
    for key in ("AI_IMAGE_USER_REQUESTS_PER_MINUTE", "AI_IMAGE_USER_REQUESTS_PER_DAY",
                "AI_IMAGE_GLOBAL_REQUESTS_PER_MINUTE", "AI_IMAGE_GLOBAL_REQUESTS_PER_DAY"):
        monkeypatch.setattr(settings, key, 10)
    return SimpleNamespace(repo=image_app.repo,
        models=SimpleNamespace(counter=AIUsageCounterModel, generation=RecipeImageGenerationModel),
        database=image_app.database, session=image_app.session,
        user_id=image_app.user_id, now=image_app.now[0])


def recipe_payload() -> dict:
    return {"title": "Soup", "description": "", "ingredients": [], "steps": []}


def menu_payload() -> dict:
    return {
        "operation": "menu_artwork",
        "prompt_version": "menu-artwork-v1",
        "layout_version": "menu-layout-v1",
        "style_id": "cozy-cafe",
        "instructions": "tiny tomatoes",
    }


def test_recipe_hash_retains_the_pre_migration_digest(image_repository):
    """Breaks if adding purpose/version data silently invalidates legacy cover replays."""
    payload = recipe_payload()
    legacy = image_repository.repo.request_hash(payload)
    assert legacy == hashlib.sha256(json.dumps(
        payload,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()).hexdigest()


@pytest.mark.asyncio
async def test_legacy_recipe_row_replays_with_default_purpose(image_repository):
    """Breaks if migrated rows with the recipe-cover default cannot be recovered."""
    request_id = uuid4()
    payload = recipe_payload()
    image_repository.database.add(image_repository.models.generation(
        user_id=image_repository.user_id,
        request_id=request_id,
        request_hash=image_repository.repo.request_hash(payload),
        status="pending",
        created_at=image_repository.now,
        deadline_at=image_repository.now + timedelta(minutes=2),
    ))
    image_repository.database.commit()

    row, admitted = await image_repository.repo.begin_generation(
        image_repository.session,
        image_repository.user_id,
        request_id,
        payload,
    )

    assert admitted is False
    assert row.purpose == "recipe_cover"
    assert image_repository.database.scalars(select(image_repository.models.counter)).all() == []


@pytest.mark.asyncio
async def test_recipe_request_is_hidden_from_menu_status(image_repository):
    """Breaks if a purpose-specific status endpoint can disclose another image operation."""
    request_id = uuid4()
    row, admitted = await image_repository.repo.begin_generation(
        image_repository.session,
        image_repository.user_id,
        request_id,
        recipe_payload(),
    )
    image_repository.database.commit()

    assert admitted is True
    assert row.purpose == "recipe_cover"
    row.deadline_at = image_repository.now - timedelta(seconds=1)
    image_repository.database.commit()
    assert await image_repository.repo.find_request(
        image_repository.session,
        image_repository.user_id,
        request_id,
        purpose="menu_artwork",
    ) is None
    image_repository.database.refresh(row)
    assert row.status == "pending"


@pytest.mark.asyncio
async def test_cross_purpose_id_collision_conflicts_without_spending_again(image_repository):
    """Breaks if a shared primary key collision reserves quota twice or replays across purposes."""
    from app.services.recipe_image_service import ImageGenerationError

    request_id = uuid4()
    await image_repository.repo.begin_generation(
        image_repository.session,
        image_repository.user_id,
        request_id,
        recipe_payload(),
    )
    image_repository.database.commit()

    with pytest.raises(ImageGenerationError) as caught:
        await image_repository.repo.begin_generation(
            image_repository.session,
            image_repository.user_id,
            request_id,
            menu_payload(),
            purpose="menu_artwork",
        )
    image_repository.database.rollback()

    assert caught.value.code == "request_conflict"
    assert caught.value.status_code == 409
    counters = image_repository.database.scalars(select(image_repository.models.counter)).all()
    assert len(counters) == 4
    assert all(counter.request_count == 1 for counter in counters)


@pytest.mark.asyncio
async def test_cover_and_menu_attempts_share_the_same_counters(image_repository):
    """Breaks if menu artwork receives a separate allowance from recipe covers."""
    _, cover_admitted = await image_repository.repo.begin_generation(
        image_repository.session,
        image_repository.user_id,
        uuid4(),
        recipe_payload(),
    )
    image_repository.database.commit()
    _, menu_admitted = await image_repository.repo.begin_generation(
        image_repository.session,
        image_repository.user_id,
        uuid4(),
        menu_payload(),
        purpose="menu_artwork",
    )
    image_repository.database.commit()

    assert cover_admitted is menu_admitted is True
    counters = image_repository.database.scalars(select(image_repository.models.counter)).all()
    assert len(counters) == 4
    assert all(counter.request_count == 2 for counter in counters)


@pytest.mark.asyncio
async def test_menu_completion_persists_server_owned_storage_descriptor(image_repository):
    """Breaks if the authenticated file route cannot recover the stored backend and key."""
    request_id = uuid4()
    await image_repository.repo.begin_generation(
        image_repository.session,
        image_repository.user_id,
        request_id,
        menu_payload(),
        purpose="menu_artwork",
    )
    image_repository.database.commit()

    row = await image_repository.repo.finish_generation(
        image_repository.session,
        image_repository.user_id,
        request_id,
        purpose="menu_artwork",
        file_url="https://test.invalid/menu.png",
        storage_kind="s3",
        storage_key=f"menu-artwork/{image_repository.user_id}/candidate.png",
    )
    image_repository.database.commit()

    assert row.status == "completed"
    assert row.storage_kind == "s3"
    assert row.storage_key == f"menu-artwork/{image_repository.user_id}/candidate.png"
