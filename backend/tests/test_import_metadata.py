from types import SimpleNamespace
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models import Recipe
from app.cooking import CookingConflict, CookingStepActionBody, apply_step_action


def test_unknown_time_and_source_evidence_round_trip_without_fabricated_total():
    recipe = Recipe(id='draft', title='Tofu', ingredients=[], steps=[{
        'text': 'Transfer tofu to the claypot.', 'duration_source': 'unknown',
        'duration_seconds': None, 'instruction_source': 'source',
        'source_start_seconds': 72.5, 'source_end_seconds': 75,
        'source_excerpt': 'transfer the tofu',
    }])
    step = recipe.steps[0]
    assert step.duration_seconds is None
    assert step.duration_source == 'unknown'
    assert recipe.total_time_minutes is None
    restored = Recipe(**recipe.model_dump())
    assert restored.steps[0].source_start_seconds == 72.5
    assert restored.steps[0].source_excerpt == 'transfer the tofu'


def test_legacy_fallback_timing_is_preserved():
    recipe = Recipe(id='old', title='Soup', ingredients=[], steps=[{
        'text': 'Simmer.', 'duration_source': 'fallback', 'duration_seconds': 300,
    }])
    assert recipe.steps[0].duration_seconds == 300


def test_user_instruction_cannot_keep_automatic_source_attribution():
    recipe = Recipe(id='draft', title='Tofu', ingredients=[], steps=[{
        'text': 'My adaptation.', 'instruction_source': 'user',
        'source_start_seconds': 72.5, 'source_excerpt': 'original',
    }])
    assert recipe.steps[0].source_start_seconds is None
    assert recipe.steps[0].source_excerpt is None


def test_unknown_passive_step_cannot_start_timer_but_can_complete():
    now = datetime.now(timezone.utc)
    step = SimpleNamespace(revision=1, state='ready', attention_type='passive',
        duration_source='unknown', duration_seconds=None, position=0,
        timer_started_at=None, timer_ends_at=None, paused_remaining_seconds=None,
        notification_owner_device_id=None, resolved_at=None, updated_at=now)
    dish = SimpleNamespace(steps=[step])
    def body(action):
        return CookingStepActionBody(action=action, mutation_id=uuid4(),
            device_id='test', occurred_at=now, expected_revision=1)
    with pytest.raises(CookingConflict) as error:
        apply_step_action(dish, step, body('start_timer'), now)
    assert error.value.code == 'timer_duration_unknown'
    apply_step_action(dish, step, body('complete'), now)
    assert step.state == 'completed'
