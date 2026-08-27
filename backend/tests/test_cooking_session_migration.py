from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa

from app.db.models import CookingSessionMutationModel, CookingSessionStepModel


def _migration_module():
    path = Path(__file__).parents[1] / "alembic/versions/20260827_cooking_sessions.py"
    spec = importlib.util.spec_from_file_location("cooking_session_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_emits_normalized_session_tables_and_behavioral_constraints(monkeypatch) -> None:
    migration = _migration_module()
    created: dict[str, tuple[object, ...]] = {}
    indexes: list[tuple[object, ...]] = []

    monkeypatch.setattr(
        migration.op,
        "create_table",
        lambda name, *items, **_kwargs: created.setdefault(name, items),
    )
    monkeypatch.setattr(
        migration.op,
        "create_index",
        lambda *args, **_kwargs: indexes.append(args),
    )

    migration.upgrade()

    assert list(created) == [
        "cooking_sessions",
        "cooking_session_dishes",
        "cooking_session_steps",
        "cooking_session_mutations",
    ]
    session_constraints = {
        item.name
        for item in created["cooking_sessions"]
        if isinstance(item, sa.Constraint)
    }
    step_constraints = {
        item.name
        for item in created["cooking_session_steps"]
        if isinstance(item, sa.Constraint)
    }
    assert "uq_cooking_sessions_user_id" in session_constraints
    assert {
        "ck_cooking_steps_duration",
        "ck_cooking_steps_state",
        "ck_cooking_steps_duration_source",
        "ck_cooking_steps_attention_type",
        "ck_cooking_steps_action_type",
        "ck_cooking_steps_revision",
    }.issubset(step_constraints)
    assert any(args[0] == "ix_cooking_steps_timer_ends_at" for args in indexes)


def test_downgrade_drops_children_before_parent(monkeypatch) -> None:
    migration = _migration_module()
    dropped: list[str] = []

    monkeypatch.setattr(migration.op, "drop_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(migration.op, "drop_table", dropped.append)

    migration.downgrade()

    assert dropped == [
        "cooking_session_mutations",
        "cooking_session_steps",
        "cooking_session_dishes",
        "cooking_sessions",
    ]


def test_orm_metadata_keeps_runtime_indexes_aligned_with_the_migration() -> None:
    step_indexes = {index.name for index in CookingSessionStepModel.__table__.indexes}
    mutation_indexes = {index.name for index in CookingSessionMutationModel.__table__.indexes}

    assert step_indexes == {"ix_cooking_steps_state", "ix_cooking_steps_timer_ends_at"}
    assert mutation_indexes == {"ix_cooking_mutations_session_id"}
