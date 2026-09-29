"""Conservative library timing from recorded step metadata, without total-time inference."""
from typing import TypedDict


class RecipeTimingSummary(TypedDict):
    hands_on_minutes: int | None
    passive_minutes: int | None
    is_estimate: bool


def summarize_recipe_timing(steps: object) -> RecipeTimingSummary | None:
    """Keep credible passive time even when the complete effort is not known.

    Fallback durations can be allocated from a recipe total and do not establish
    active work. Unknown attention must not silently become hands-on here.
    """
    if not isinstance(steps, list) or not steps:
        return None
    hands_on_seconds = passive_seconds = 0
    hands_on_estimated = passive_estimated = False
    complete = True
    for step in steps:
        if not isinstance(step, dict):
            complete = False
            continue
        seconds = step.get('duration_seconds')
        source = step.get('duration_source')
        attention = step.get('attention_type')
        if (type(seconds) is not int or not 0 < seconds <= 86400
                or source not in ('stated', 'user', 'estimated')
                or attention not in ('hands_on', 'passive')):
            complete = False
            continue
        if attention == 'passive':
            passive_seconds += seconds
            passive_estimated |= source == 'estimated'
        else:
            hands_on_seconds += seconds
            hands_on_estimated |= source == 'estimated'
    if not passive_seconds:
        return None
    return {
        'hands_on_minutes': (hands_on_seconds + 59) // 60 if complete else None,
        'passive_minutes': (passive_seconds + 59) // 60,
        'is_estimate': passive_estimated or (complete and hands_on_estimated),
    }
