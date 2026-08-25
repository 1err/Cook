"""Canonical, dependency-free recipe tutorial step normalization."""
from __future__ import annotations

from collections.abc import Callable
from statistics import median
from typing import Literal
from uuid import UUID, uuid4

DurationSource = Literal["stated", "estimated", "user", "fallback"]
AttentionType = Literal["hands_on", "passive"]
ActionType = Literal[
    "prep",
    "chop",
    "mix",
    "season",
    "sear",
    "simmer",
    "boil",
    "bake",
    "rest",
    "drain",
    "assemble",
    "plate",
    "other",
]

DURATION_SOURCES = frozenset({"stated", "estimated", "user", "fallback"})
ATTENTION_TYPES = frozenset({"hands_on", "passive"})
ACTION_TYPES = frozenset(
    {
        "prep",
        "chop",
        "mix",
        "season",
        "sear",
        "simmer",
        "boil",
        "bake",
        "rest",
        "drain",
        "assemble",
        "plate",
        "other",
    }
)

GENERATED_MIN_SECONDS = 15
USER_MIN_SECONDS = 1
MAX_STEP_SECONDS = 86_400
DEFAULT_FALLBACK_SECONDS = 300


_ACTION_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("bake", ("bake", "roast", "oven", "烤")),
    ("simmer", ("simmer", "stew", "braise", "炖", "焖", "煨")),
    ("boil", ("boil", "沸", "煮")),
    ("rest", ("rest", "wait", "cool", "chill", "静置", "醒", "冷却", "冷藏")),
    ("chop", ("chop", "dice", "slice", "mince", "切", "剁")),
    ("mix", ("mix", "stir", "whisk", "fold", "拌", "搅")),
    ("season", ("season", "salt", "pepper", "调味", "加盐")),
    ("sear", ("sear", "brown", "fry", "煎", "炒", "炸")),
    ("drain", ("drain", "strain", "沥", "滤")),
    ("assemble", ("assemble", "combine", "layer", "组合", "装配")),
    ("plate", ("plate", "serve", "garnish", "装盘", "上桌")),
    ("prep", ("prepare", "wash", "peel", "准备", "洗", "削皮")),
)


def classify_step_metadata(text: str) -> tuple[str, str]:
    """Return deterministic attention/action suggestions from instruction text."""
    normalized = text.casefold()
    action_type = "other"
    for candidate, keywords in _ACTION_KEYWORDS:
        if any(keyword in normalized for keyword in keywords):
            action_type = candidate
            break
    attention_type = (
        "passive" if action_type in {"bake", "simmer", "boil", "rest"} else "hands_on"
    )
    return attention_type, action_type


def parse_step_rows(raw: object) -> list[dict[str, object]]:
    """Accept legacy step shapes and discard rows that cannot become steps."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("steps must be a list")

    rows: list[dict[str, object]] = []
    for item in raw:
        if isinstance(item, str):
            payload: dict[str, object] = {"text": item}
        elif isinstance(item, dict):
            payload = dict(item)
        else:
            continue

        text = payload.get("text")
        if not isinstance(text, str):
            continue
        text = text.strip()
        if not text:
            continue
        payload["text"] = text
        rows.append(payload)
    return rows


def _coerce_nonnegative_int(value: object) -> int | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _valid_id(value: object) -> str | None:
    if not isinstance(value, (str, UUID)):
        return None
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        return None


def _metadata(value: object, allowed: frozenset[str], default: str) -> str:
    if not isinstance(value, str):
        return default
    value = value.strip()
    return value if value in allowed else default


def _clamp_duration(duration: int, source: str) -> int:
    minimum = USER_MIN_SECONDS if source == "user" else GENERATED_MIN_SECONDS
    return min(MAX_STEP_SECONDS, max(minimum, duration))


def _new_id(id_factory: Callable[[], object], seen: set[str]) -> str:
    while True:
        generated = _valid_id(id_factory())
        if generated and generated not in seen:
            return generated


def normalize_step_payloads(
    raw: object,
    total_time_minutes: object,
    id_factory: Callable[[], object] = uuid4,
) -> list[dict[str, object]]:
    """Return complete, persistence-ready step payloads for one recipe."""
    records: list[dict[str, object]] = []
    seen_ids: set[str] = set()

    for row in parse_step_rows(raw):
        duration = _coerce_nonnegative_int(row.get("duration_seconds"))
        supplied_source = row.get("duration_source")
        if duration is None:
            source = "fallback"
        elif supplied_source is None or supplied_source == "":
            source = "stated"
        else:
            source = _metadata(supplied_source, DURATION_SOURCES, "fallback")

        step_id = _valid_id(row.get("id"))
        if step_id is None or step_id in seen_ids:
            step_id = _new_id(id_factory, seen_ids)
        seen_ids.add(step_id)

        records.append(
            {
                "id": step_id,
                "text": row["text"],
                "duration_seconds": _clamp_duration(duration, source) if duration is not None else None,
                "duration_source": source,
                "attention_type": _metadata(row.get("attention_type"), ATTENTION_TYPES, "hands_on"),
                "action_type": _metadata(row.get("action_type"), ACTION_TYPES, "other"),
                "image_url": _normalized_image_url(row.get("image_url")),
            }
        )

    missing_indexes = [
        index for index, record in enumerate(records) if record["duration_seconds"] is None
    ]
    known_durations = [
        int(record["duration_seconds"])
        for record in records
        if record["duration_seconds"] is not None
    ]
    if not missing_indexes:
        return records

    total_seconds = _coerce_nonnegative_int(total_time_minutes)
    remaining_seconds = (
        total_seconds * 60 - sum(known_durations) if total_seconds is not None else 0
    )
    if remaining_seconds > 0:
        base, remainder = divmod(remaining_seconds, len(missing_indexes))
        fallback_durations = [
            max(60, base + (1 if offset < remainder else 0))
            for offset in range(len(missing_indexes))
        ]
    elif known_durations:
        fallback_durations = [round(median(known_durations))] * len(missing_indexes)
    else:
        fallback_durations = [DEFAULT_FALLBACK_SECONDS] * len(missing_indexes)

    for index, duration in zip(missing_indexes, fallback_durations, strict=True):
        records[index]["duration_seconds"] = _clamp_duration(duration, "fallback")
        records[index]["duration_source"] = "fallback"
    return records


def _normalized_image_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None
