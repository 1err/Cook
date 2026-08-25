from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.api import routes_recipes
from app.models import Recipe, RecipeStep


def _recipe() -> Recipe:
    return Recipe(
        id="recipe-1",
        title="Soup",
        ingredients=[],
        total_time_minutes=10,
        steps=[
            {
                "id": "00000000-0000-0000-0000-000000000001",
                "text": "Old step",
                "duration_seconds": 600,
                "duration_source": "stated",
            }
        ],
    )


@pytest.mark.asyncio
async def test_estimate_route_canonicalizes_owned_recipe_draft_without_persisting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recipe = _recipe()
    original_recipe = recipe.model_dump()
    user = SimpleNamespace(id=UUID("00000000-0000-0000-0000-000000000099"))
    session = SimpleNamespace()
    get_calls: list[tuple[object, str, UUID]] = []
    save_calls: list[tuple[object, ...]] = []
    estimator_inputs: list[list[RecipeStep]] = []

    async def get_owned_recipe(
        supplied_session: object, recipe_id: str, user_id: UUID
    ) -> Recipe:
        get_calls.append((supplied_session, recipe_id, user_id))
        return recipe

    async def estimate(steps: list[RecipeStep]) -> list[RecipeStep]:
        estimator_inputs.append(steps)
        return [
            RecipeStep(
                **{
                    **step.model_dump(),
                    "attention_type": "passive",
                    "action_type": "simmer",
                }
            )
            for step in steps
        ]

    async def unexpected_save(*args: object) -> None:
        save_calls.append(args)

    monkeypatch.setattr(routes_recipes.repo_recipes, "get_recipe", get_owned_recipe)
    monkeypatch.setattr(routes_recipes.repo_recipes, "save_recipe", unexpected_save)
    monkeypatch.setattr(routes_recipes, "estimate_tutorial_step_metadata", estimate)
    body = routes_recipes.EstimateTutorialBody(
        steps=[
            {
                "id": "00000000-0000-0000-0000-000000000011",
                "text": "Simmer the broth.",
            },
            {
                "id": "00000000-0000-0000-0000-000000000012",
                "text": "Let it rest.",
            },
        ]
    )

    result = await routes_recipes.recipe_estimate_tutorial(
        recipe_id=recipe.id,
        body=body,
        session=session,  # type: ignore[arg-type]
        current_user=user,  # type: ignore[arg-type]
    )

    assert get_calls == [(session, recipe.id, user.id)]
    assert [step.duration_seconds for step in estimator_inputs[0]] == [300, 300]
    assert [step.duration_source for step in estimator_inputs[0]] == [
        "fallback",
        "fallback",
    ]
    assert result.steps == [
        RecipeStep(
            **{
                **step.model_dump(),
                "attention_type": "passive",
                "action_type": "simmer",
            }
        )
        for step in estimator_inputs[0]
    ]
    assert save_calls == []
    assert recipe.model_dump() == original_recipe


@pytest.mark.asyncio
async def test_estimate_route_returns_404_before_estimation_for_unowned_recipe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    estimator_calls = 0

    async def missing_recipe(*args: object) -> None:
        return None

    async def unexpected_estimate(steps: list[RecipeStep]) -> list[RecipeStep]:
        nonlocal estimator_calls
        estimator_calls += 1
        return steps

    monkeypatch.setattr(routes_recipes.repo_recipes, "get_recipe", missing_recipe)
    monkeypatch.setattr(
        routes_recipes, "estimate_tutorial_step_metadata", unexpected_estimate
    )

    with pytest.raises(HTTPException) as exc_info:
        await routes_recipes.recipe_estimate_tutorial(
            recipe_id="missing",
            body=routes_recipes.EstimateTutorialBody(steps=[]),
            session=object(),  # type: ignore[arg-type]
            current_user=SimpleNamespace(id=UUID(int=1)),  # type: ignore[arg-type]
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Recipe not found"
    assert estimator_calls == 0


@pytest.mark.asyncio
async def test_patch_revalidates_step_updates_before_saving(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recipe = _recipe()
    saved: list[Recipe] = []

    async def get_owned_recipe(*args: object) -> Recipe:
        return recipe

    async def save_recipe(*args: object) -> Recipe:
        saved.append(args[1])  # type: ignore[arg-type]
        return args[1]  # type: ignore[return-value]

    monkeypatch.setattr(routes_recipes.repo_recipes, "get_recipe", get_owned_recipe)
    monkeypatch.setattr(routes_recipes.repo_recipes, "save_recipe", save_recipe)
    body = routes_recipes.RecipeUpdate(
        steps=[
            {
                "id": "00000000-0000-0000-0000-000000000022",
                "text": "Generated duration",
                "duration_seconds": 0,
                "duration_source": "estimated",
            },
            {
                "id": "00000000-0000-0000-0000-000000000021",
                "text": "User duration",
                "duration_seconds": 1,
                "duration_source": "user",
            },
        ]
    )

    updated = await routes_recipes.recipe_update(
        recipe_id=recipe.id,
        body=body,
        session=object(),  # type: ignore[arg-type]
        current_user=SimpleNamespace(id=UUID(int=2)),  # type: ignore[arg-type]
    )

    assert [step.id for step in updated.steps] == [
        "00000000-0000-0000-0000-000000000022",
        "00000000-0000-0000-0000-000000000021",
    ]
    assert [step.duration_seconds for step in updated.steps] == [15, 1]
    assert [step.duration_source for step in updated.steps] == ["estimated", "user"]
    assert saved == [updated]
