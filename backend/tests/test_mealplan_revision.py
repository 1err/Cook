"""Optimistic planner writes must never overwrite a newer account/date revision."""
import uuid
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.db.models import MealPlanModel, UserModel
from app.db import repo_mealplan

@pytest.fixture
def session():
    engine = create_engine('sqlite:///:memory:')
    UserModel.__table__.create(engine)
    MealPlanModel.__table__.create(engine)
    class Adapter:
        def __init__(self, sync): self.sync=sync
        async def execute(self, statement): return self.sync.execute(statement)
        async def flush(self): self.sync.flush()
    with Session(engine) as sync:
        yield Adapter(sync)
    engine.dispose()

@pytest.mark.asyncio
async def test_expected_revision_create_update_conflict_and_owner_scope(session):
    owner,other=uuid.uuid4(),uuid.uuid4()
    date='2026-09-18'
    first=await repo_mealplan.put_meal_plan(session,date,{'dinner':['a']},owner,expected_revision=0)
    assert first.revision==1
    for stale in [0,2]:
        with pytest.raises(repo_mealplan.MealPlanConflict):
            await repo_mealplan.put_meal_plan(session,date,{'dinner':['lost']},owner,expected_revision=stale)
    saved=await repo_mealplan.put_meal_plan(session,date,{'dinner':['a','b']},owner,expected_revision=1)
    assert saved.revision==2 and saved.dinner==['a','b']
    theirs=await repo_mealplan.put_meal_plan(session,date,{'lunch':['c']},other,expected_revision=0)
    assert theirs.revision==1
    rows=await repo_mealplan.get_meal_plans_in_range(session,date,date,owner)
    assert rows[0].dinner==['a','b'] and rows[0].revision==2

@pytest.mark.asyncio
async def test_legacy_write_increments_revision_so_current_client_detects_conflict(session):
    owner=uuid.uuid4()
    first=await repo_mealplan.put_meal_plan(session,'2026-09-18',{'dinner':['a']},owner)
    second=await repo_mealplan.put_meal_plan(session,'2026-09-18',{'dinner':['b']},owner)
    assert (first.revision,second.revision)==(1,2)
    with pytest.raises(repo_mealplan.MealPlanConflict):
        await repo_mealplan.put_meal_plan(session,'2026-09-18',{},owner,expected_revision=1)

@pytest.mark.asyncio
@pytest.mark.parametrize('start,end',[('2026-01-01','2026-02-01'),('2026-09-19','2026-09-18'),('bad','2026-09-18')])
async def test_repository_rejects_unbounded_or_invalid_range_before_query(session,start,end):
    with pytest.raises(ValueError):
        await repo_mealplan.get_meal_plans_in_range(session,start,end,uuid.uuid4())
