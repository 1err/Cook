"""Timing summaries must not turn incomplete recipe metadata into confident effort."""
from copy import deepcopy

import pytest

from app.services.recipe_timing import summarize_recipe_timing


def step(seconds, attention='hands_on', source='stated'):
    return {'duration_seconds': seconds, 'attention_type': attention, 'duration_source': source}


@pytest.mark.parametrize(('steps', 'expected'), [
    ([step(600), step(28800, 'passive')],
     {'hands_on_minutes': 10, 'passive_minutes': 480, 'is_estimate': False}),
    ([step(61, source='user'), step(59, source='estimated'), step(3600, 'passive')],
     {'hands_on_minutes': 2, 'passive_minutes': 60, 'is_estimate': True}),
    ([step(30), step(30), step(31, 'passive'), step(30, 'passive', 'estimated')],
     {'hands_on_minutes': 1, 'passive_minutes': 2, 'is_estimate': True}),
    ([step(28800, 'passive'), step(600, source='fallback')],
     {'hands_on_minutes': None, 'passive_minutes': 480, 'is_estimate': False}),
    ([step(600, source='estimated'), step(None), step(28800, 'passive')],
     {'hands_on_minutes': None, 'passive_minutes': 480, 'is_estimate': False}),
    ([step(60, 'passive', 'estimated'), step(300, 'passive', 'unknown')],
     {'hands_on_minutes': None, 'passive_minutes': 1, 'is_estimate': True}),
    ([step(28800, 'passive')],
     {'hands_on_minutes': 0, 'passive_minutes': 480, 'is_estimate': False}),
])
def test_preserves_credible_wait_and_only_sums_complete_effort(steps, expected):
    original = deepcopy(steps)
    assert summarize_recipe_timing(steps) == expected
    assert steps == original


@pytest.mark.parametrize('invalid_step', [
    None, 'legacy instruction', [], {},
    step(None), step(True), step(0), step(-1), step(12.5), step('600'), step(86401),
    step(600, None), step(600, 'unknown'), step(600, 'active'),
    step(600, source=None), step(600, source='unknown'), step(600, source='fallback'),
    {'duration_seconds': 600, 'duration_source': 'stated'},
    {'duration_seconds': 600, 'attention_type': 'hands_on'},
])
def test_any_missing_or_malformed_metadata_suppresses_complete_effort(invalid_step):
    assert summarize_recipe_timing([step(28800, 'passive'), invalid_step]) == {
        'hands_on_minutes': None, 'passive_minutes': 480, 'is_estimate': False,
    }


@pytest.mark.parametrize('steps', [
    None, {}, '[]', [], [step(600)], [step(600, 'passive', 'fallback')],
    [step(None, 'passive', 'unknown')], [step(60, 'unknown')],
])
def test_omits_summary_without_credible_passive_time(steps):
    assert summarize_recipe_timing(steps) is None
