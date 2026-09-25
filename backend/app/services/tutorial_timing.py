"""Planning estimates for existing imported actions, never source evidence."""
from __future__ import annotations

import re

from app.tutorial import GENERATED_MIN_SECONDS, MAX_STEP_SECONDS


# Remove completed-cooking adjectives before classifying the operation being done:
# "将煎至金黄的豆腐移入砂锅" is a transfer, not another frying step.
_COOKED_ADJECTIVE = re.compile(r"[煎炒炸烤煮蒸炖燉焖燜煨](?:好|熟|过|過|至[^，。；,.;]{1,16})的")
_HEAT_CONTROL = re.compile(r"\b(?:turn|switch)\s+off\s+(?:the\s+)?(?:heat|burner|stove|oven)\b", re.IGNORECASE)

# These are rough planning defaults, not doneness or food-safety guarantees.
# Actual cooking takes precedence over a short handling verb in a compound step.
_COOKING = tuple((re.compile(pattern, re.IGNORECASE), seconds) for pattern, seconds in (
    (r"\b(?:bake|roast)\b|烤|焗", 1800),
    (r"\b(?:simmer|stew|braise)\b|炖|焖|煨|小火煮", 600),
    (r"\bboil\b|煮|煮沸", 600),
    (r"\bsteam\b|蒸", 600),
    (r"\b(?:marinate|soak)\b|腌|浸泡", 1800),
    (r"\b(?:rest|cool|chill|wait)\b|静置|冷却|冷藏|醒", 300),
    (r"\brender\b|煸出|逼出", 300),
    (r"\b(?:fry|sear|sauté|saute)\b|(?:^\s*|\b(?:then|and)\s+)brown\b|煎|炒|炸", 300),
    (r"\b(?:heat|preheat|warm)\b.{0,24}\b(?:pan|pot|oil|oven)\b|热锅|烧热|预热", 120),
))
_HANDLING = tuple((re.compile(pattern, re.IGNORECASE), seconds, maximum) for pattern, seconds, maximum in (
    (r"\b(?:turn|switch)\s+off\b|\bremove\b.{0,20}\bheat\b|关火|离火", 15, 30),
    (r"\b(?:garnish|sprinkle)\b|撒|点缀|點綴", 15, 60),
    (r"\b(?:transfer|move|tip|ladle|add|pour|put|place|return|plate|serve)\b|转入|轉入|盛入|盛出|移入|装入|加入|倒入|放入|放回|装盘|摆盘|上桌", 30, 60),
    (r"\bseason\b|调味|加盐", 30, 60),
    (r"\b(?:drain|strain)\b|沥|捞出|滤", 60, 120),
    (r"\b(?:chop|dice|slice|cut|mince)\b|切|剁", 120, None),
    (r"\b(?:wash|rinse|clean|peel|trim)\b|清洗|洗净|去皮|削皮", 120, None),
    (r"\b(?:mix|stir|whisk|beat|fold)\b|搅|拌|打散", 60, 120),
))
_ACTION_DEFAULTS = {
    "prep": 120, "chop": 120, "mix": 60, "season": 30, "sear": 300,
    "simmer": 600, "boil": 600, "bake": 1800, "rest": 300, "drain": 60,
    "assemble": 60, "plate": 30, "other": 120,
}


def _timing_suggestion(text: str, action: object) -> tuple[int, int | None]:
    instruction = _COOKED_ADJECTIVE.sub("", text)
    cooking_instruction = _HEAT_CONTROL.sub("", instruction)
    for pattern, seconds in _COOKING:
        if pattern.search(cooking_instruction):
            return seconds, None
    for pattern, seconds, maximum in _HANDLING:
        if pattern.search(instruction):
            return seconds, maximum
    return _ACTION_DEFAULTS.get(action, 120) if isinstance(action, str) else 120, None


def estimate_import_step_durations(steps: list[dict]) -> list[dict]:
    """Fill timers without changing instructions, identity, ordering or evidence.

    Call only after grounding: unsupported source-stated times must be rejected
    before an independent planning estimate can be supplied in their place.
    """
    result = []
    for step in steps:
        timed = dict(step)
        text = timed.get("text")
        if not isinstance(text, str) or not text.strip():
            result.append(timed)
            continue
        duration = timed.get("duration_seconds")
        valid = isinstance(duration, int) and not isinstance(duration, bool) and 0 < duration <= MAX_STEP_SECONDS
        provenance = timed.get("duration_source")
        if valid and provenance in {"stated", "user"}:
            result.append(timed)
            continue
        suggestion, maximum = _timing_suggestion(text, timed.get("action_type"))
        if valid and provenance == "estimated":
            duration = max(GENERATED_MIN_SECONDS, duration)
            if maximum is not None and duration > maximum:
                duration = suggestion
        else:
            duration = suggestion
        timed.update(duration_seconds=duration, duration_source="estimated")
        result.append(timed)
    return result
