"""Transactional, user-scoped persistence for active cooking sessions."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.cooking import (
    RESOLVED_STATES,
    CookingConflict,
    CookingDish,
    CookingSession,
    CookingStep,
    CookingStepActionBody,
    apply_step_action,
    normalize_expired_timers,
)
from app.db.models import (
    CookingSessionDishModel,
    CookingSessionModel,
    CookingSessionMutationModel,
    CookingSessionStepModel,
    RecipeModel,
)
from app.db.repo_recipes import _row_to_recipe
from app.models import IngredientItem


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _session_options():
    return selectinload(CookingSessionModel.dishes).selectinload(CookingSessionDishModel.steps)


async def _get_active_model(
    session: AsyncSession,
    user_id: UUID,
    *,
    session_id: UUID | None = None,
    for_update: bool = False,
) -> CookingSessionModel | None:
    statement = (
        select(CookingSessionModel)
        .where(CookingSessionModel.user_id == user_id)
        .options(_session_options())
    )
    if session_id is not None:
        statement = statement.where(CookingSessionModel.id == session_id)
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    return result.scalars().one_or_none()


async def _load_owned_recipe_rows(
    session: AsyncSession, user_id: UUID, recipe_ids: list[str]
) -> list[RecipeModel]:
    if not recipe_ids:
        return []
    result = await session.execute(
        select(RecipeModel).where(
            RecipeModel.user_id == user_id,
            RecipeModel.id.in_(recipe_ids),
        )
    )
    by_id = {row.id: row for row in result.scalars().all()}
    return [by_id[recipe_id] for recipe_id in recipe_ids if recipe_id in by_id]


async def _mutation_exists(
    session: AsyncSession, session_id: UUID, mutation_id: UUID
) -> bool:
    result = await session.execute(
        select(CookingSessionMutationModel.mutation_id).where(
            CookingSessionMutationModel.session_id == session_id,
            CookingSessionMutationModel.mutation_id == mutation_id,
        )
    )
    return result.scalar_one_or_none() is not None


def _to_response(model: CookingSessionModel) -> CookingSession:
    return CookingSession(
        id=str(model.id),
        version=model.version,
        created_at=model.created_at,
        updated_at=model.updated_at,
        dishes=[
            CookingDish(
                id=str(dish.id),
                recipe_id=dish.recipe_id,
                position=dish.position,
                title=dish.title,
                thumbnail_url=dish.thumbnail_url,
                ingredients=[IngredientItem(**item) for item in (dish.ingredients or [])],
                equipment=list(dish.equipment or []),
                tips=list(dish.tips or []),
                created_at=dish.created_at,
                steps=[
                    CookingStep(
                        id=str(step.id),
                        recipe_step_id=str(step.recipe_step_id),
                        position=step.position,
                        text=step.text,
                        duration_seconds=step.duration_seconds,
                        duration_source=step.duration_source,
                        attention_type=step.attention_type,
                        action_type=step.action_type,
                        image_url=step.image_url,
                        state=step.state,
                        timer_started_at=step.timer_started_at,
                        timer_ends_at=step.timer_ends_at,
                        paused_remaining_seconds=step.paused_remaining_seconds,
                        resolved_at=step.resolved_at,
                        notification_owner_device_id=step.notification_owner_device_id,
                        revision=step.revision,
                        updated_at=step.updated_at,
                    )
                    for step in sorted(dish.steps, key=lambda item: item.position)
                ],
            )
            for dish in sorted(model.dishes, key=lambda item: item.position)
        ],
    )


def _append_recipe_snapshots(
    model: CookingSessionModel,
    recipe_rows: list[RecipeModel],
    *,
    created_at: datetime,
) -> None:
    position = len(model.dishes)
    for row in recipe_rows:
        recipe = _row_to_recipe(row)
        if not recipe.steps:
            raise CookingConflict(
                "recipe_has_no_steps",
                f"{recipe.title} needs tutorial steps before cooking can start.",
            )
        dish = CookingSessionDishModel(
            id=uuid4(),
            session_id=model.id,
            recipe_id=recipe.id,
            position=position,
            title=recipe.title,
            thumbnail_url=recipe.thumbnail_url,
            ingredients=[item.model_dump() for item in recipe.ingredients],
            equipment=list(recipe.equipment or []),
            tips=list(recipe.tips or []),
            created_at=created_at,
        )
        dish.steps = [
            CookingSessionStepModel(
                id=uuid4(),
                dish_id=dish.id,
                recipe_step_id=UUID(str(step.id)),
                position=step_position,
                text=step.text,
                duration_seconds=int(step.duration_seconds or 300),
                duration_source=step.duration_source or "fallback",
                attention_type=step.attention_type or "hands_on",
                action_type=step.action_type or "other",
                image_url=step.image_url,
                state="ready" if step_position == 0 else "locked",
                revision=1,
                updated_at=created_at,
            )
            for step_position, step in enumerate(recipe.steps)
        ]
        model.dishes.append(dish)
        position += 1


def _normalize_expiry(model: CookingSessionModel, now: datetime) -> bool:
    changed = False
    for dish in model.dishes:
        changed = normalize_expired_timers(dish, now) or changed
    if changed:
        model.version += 1
        model.updated_at = now
    return changed


async def get_active_session(
    session: AsyncSession, user_id: UUID
) -> CookingSession | None:
    model = await _get_active_model(session, user_id)
    if model is None:
        return None
    now = _now()
    if _normalize_expiry(model, now):
        await session.flush()
    return _to_response(model)


async def create_session(
    session: AsyncSession, user_id: UUID, recipe_ids: list[str]
) -> CookingSession:
    if await _get_active_model(session, user_id) is not None:
        raise CookingConflict(
            "active_session_exists", "A cooking session is already in progress."
        )
    if not recipe_ids:
        raise CookingConflict("recipe_not_owned", "Choose at least one recipe to start cooking.")
    rows = await _load_owned_recipe_rows(session, user_id, recipe_ids)
    if len(rows) != len(recipe_ids):
        raise CookingConflict(
            "recipe_not_owned", "Every recipe in a cooking session must belong to your library."
        )
    now = _now()
    model = CookingSessionModel(
        id=uuid4(), user_id=user_id, version=1, created_at=now, updated_at=now
    )
    model.dishes = []
    _append_recipe_snapshots(model, rows, created_at=now)
    session.add(model)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise CookingConflict(
            "active_session_exists", "A cooking session is already in progress."
        ) from exc
    return _to_response(model)


async def add_dishes(
    session: AsyncSession,
    user_id: UUID,
    session_id: UUID,
    recipe_ids: list[str],
) -> CookingSession:
    model = await _get_active_model(session, user_id, session_id=session_id, for_update=True)
    if model is None:
        raise CookingConflict("session_not_found", "Cooking session not found.")
    existing = {dish.recipe_id for dish in model.dishes}
    requested = [recipe_id for recipe_id in recipe_ids if recipe_id not in existing]
    if not requested:
        return _to_response(model)
    rows = await _load_owned_recipe_rows(session, user_id, requested)
    if len(rows) != len(requested):
        raise CookingConflict(
            "recipe_not_owned", "Every recipe in a cooking session must belong to your library."
        )
    now = _now()
    _append_recipe_snapshots(model, rows, created_at=now)
    model.version += 1
    model.updated_at = now
    await session.flush()
    return _to_response(model)


async def remove_dish(
    session: AsyncSession,
    user_id: UUID,
    session_id: UUID,
    dish_id: UUID,
) -> CookingSession | None:
    model = await _get_active_model(session, user_id, session_id=session_id, for_update=True)
    if model is None:
        raise CookingConflict("session_not_found", "Cooking session not found.")
    target = next((dish for dish in model.dishes if dish.id == dish_id), None)
    if target is None:
        raise CookingConflict("dish_not_found", "Dish not found.")
    if len(model.dishes) == 1:
        await session.delete(model)
        await session.flush()
        return None
    model.dishes.remove(target)
    await session.delete(target)
    for position, dish in enumerate(sorted(model.dishes, key=lambda item: item.position)):
        dish.position = position
    now = _now()
    model.version += 1
    model.updated_at = now
    await session.flush()
    return _to_response(model)


async def apply_action(
    session: AsyncSession,
    user_id: UUID,
    session_id: UUID,
    step_id: UUID,
    body: CookingStepActionBody,
) -> CookingSession:
    model = await _get_active_model(session, user_id, session_id=session_id, for_update=True)
    if model is None:
        raise CookingConflict("session_not_found", "Cooking session not found.")
    if await _mutation_exists(session, model.id, body.mutation_id):
        return _to_response(model)
    selected_dish: CookingSessionDishModel | None = None
    selected_step: CookingSessionStepModel | None = None
    for dish in model.dishes:
        for step in dish.steps:
            if step.id == step_id:
                selected_dish = dish
                selected_step = step
                break
        if selected_step is not None:
            break
    if selected_dish is None or selected_step is None:
        raise CookingConflict("step_not_found", "Step not found.")
    now = _now()
    apply_step_action(selected_dish, selected_step, body, now)
    model.version += 1
    model.updated_at = now
    session.add(
        CookingSessionMutationModel(
            mutation_id=body.mutation_id,
            session_id=model.id,
            device_id=body.device_id,
            applied_at=now,
        )
    )
    await session.flush()
    return _to_response(model)


async def finish_session(
    session: AsyncSession, user_id: UUID, session_id: UUID
) -> dict[str, bool]:
    model = await _get_active_model(session, user_id, session_id=session_id, for_update=True)
    if model is None:
        raise CookingConflict("session_not_found", "Cooking session not found.")
    if not model.dishes or any(
        step.state not in RESOLVED_STATES for dish in model.dishes for step in dish.steps
    ):
        raise CookingConflict(
            "session_not_complete", "Finish every dish before ending the cooking session."
        )
    await session.delete(model)
    await session.flush()
    return {"ok": True}


async def discard_session(
    session: AsyncSession, user_id: UUID, session_id: UUID
) -> dict[str, bool]:
    model = await _get_active_model(session, user_id, session_id=session_id, for_update=True)
    if model is None:
        raise CookingConflict("session_not_found", "Cooking session not found.")
    await session.delete(model)
    await session.flush()
    return {"ok": True}
