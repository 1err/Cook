"""Real SQL regressions for cooking deletion constraints and expiry locking."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import JSON, MetaData, Uuid, create_engine, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.db import repo_cooking
from app.db.models import (
    Base, CookingSessionDishModel, CookingSessionModel, CookingSessionStepModel, UserModel,
)


class SqlSession:
    def __init__(self, session):
        self.sync = session
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.sync.execute(statement)

    async def delete(self, model):
        self.sync.delete(model)

    async def flush(self):
        self.sync.flush()


@pytest.fixture
def cooking_db():
    # Preserve all real constraints. Only adapt PG storage types for SQLite;
    # PostgreSQL concurrency is exercised separately when a disposable DB is supplied.
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        copied = table.to_metadata(metadata)
        for column in copied.columns:
            if isinstance(column.type, postgresql.JSONB):
                column.type = JSON()
            elif isinstance(column.type, postgresql.UUID):
                column.type = Uuid()
    engine = create_engine("sqlite:///:memory:")
    metadata.create_all(engine)
    with Session(engine, autoflush=False) as session:
        now = datetime.now(timezone.utc)
        user_id = uuid4()
        session.add(UserModel(id=user_id, email="cook@example.com"))
        session.flush()
        active = CookingSessionModel(id=uuid4(), user_id=user_id, version=1)
        active.dishes = [
            CookingSessionDishModel(
                # Reverse primary-key order makes accidental UPDATE ordering unsafe.
                id=UUID(int=100-position), recipe_id=f"recipe-{position}", position=position,
                title=f"Dish {position}", ingredients=[], equipment=[], tips=[],
                steps=[CookingSessionStepModel(
                    id=uuid4(), recipe_step_id=uuid4(), position=0, text="Simmer",
                    duration_seconds=60, duration_source="stated", attention_type="passive",
                    action_type="simmer", state="timer_running", revision=1,
                    timer_started_at=now-timedelta(minutes=2),
                    timer_ends_at=now-timedelta(minutes=1),
                )],
            ) for position in range(3)
        ]
        session.add(active)
        session.commit()
        yield SqlSession(session), active
    engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("removed_position", [0, 1, 2])
async def test_remove_any_dish_compacts_positions_without_unique_conflict(cooking_db, removed_position):
    db, active = cooking_db
    removed = active.dishes[removed_position]
    result = await repo_cooking.remove_dish(db, active.user_id, active.id, removed.id)
    db.sync.commit()

    assert result is not None
    assert [dish.position for dish in result.dishes] == [0, 1]
    assert [dish.recipe_id for dish in result.dishes] == [
        f"recipe-{position}" for position in range(3) if position != removed_position
    ]
    assert db.sync.get(CookingSessionDishModel, removed.id) is None


@pytest.mark.asyncio
async def test_expiry_read_uses_same_postgres_row_lock_as_step_actions(cooking_db):
    db, active = cooking_db
    result = await repo_cooking.get_active_session(db, active.user_id)
    db.sync.commit()

    assert result is not None
    assert all(dish.steps[0].state == "needs_attention" for dish in result.dishes)
    sql = str(db.statements[0].compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in sql
