from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.models import AIUsageCounterModel
from app.db.repo_ai_usage import counter_statement


def test_counter_limits_are_atomic_and_reset_in_a_new_window():
    engine = create_engine("sqlite://")
    AIUsageCounterModel.__table__.create(engine)
    with Session(engine) as session:
        def consume(now, limit=2):
            return session.execute(counter_statement("user:one", 60, now, limit)).scalar_one_or_none()
        assert consume(120) == 1
        assert consume(120) == 2
        assert consume(120) is None
        assert consume(180) == 1
        assert consume(120) is None  # an older waiter cannot reset a newer bucket
        assert consume(180) == 2
    engine.dispose()


def test_rejected_budget_transaction_does_not_charge_other_buckets():
    engine = create_engine("sqlite://")
    AIUsageCounterModel.__table__.create(engine)
    with Session(engine) as session:
        session.execute(counter_statement("user:one", 60, 120, 1))
        session.commit()
        session.execute(counter_statement("global", 60, 120, 10))
        assert session.execute(counter_statement("user:one", 60, 120, 1)).scalar_one_or_none() is None
        session.rollback()
        assert session.execute(select(AIUsageCounterModel).where(AIUsageCounterModel.scope == "global")).scalar_one_or_none() is None
    engine.dispose()
