"""
Recipe extraction from a YouTube transcript or pasted text.
The provider is required for extraction; missing configuration returns an
actionable unavailable response rather than fabricated recipe content.
"""
import json
import logging
import re
import uuid

from app.core.llm import AIUnavailableError, complete_chat, get_openai_client
from app.models import IngredientItem, Recipe, RecipeStep
from app.video_import import (
    UnsupportedVideoUrl,
    VideoSource,
    VideoTextResult,
    fetch_youtube_text,
    parse_video_source,
)
from app.tutorial import (
    ACTION_TYPES,
    ATTENTION_TYPES,
    DURATION_SOURCES,
    GENERATED_MIN_SECONDS,
    MAX_STEP_SECONDS,
    classify_step_metadata,
)

logger = logging.getLogger(__name__)

_METRIC_SEGMENT_RE = re.compile(
    r"(?P<metric>(?:\d+(?:\.\d+)?|[一二两三四五六七八九十半]+(?:/\d+)?)\s*(?:g|kg|ml|l|克|千克|公斤|毫升|升))$",
    re.IGNORECASE,
)
_NON_METRIC_UNIT_RE = re.compile(
    r"(杯|个|块|勺|汤匙|茶匙|片|瓣|把|根|条|袋|盒|罐|颗|clove|cup|cups|tbsp|tsp|piece|pieces|slice|slices)",
    re.IGNORECASE,
)
_UNUSABLE_STEP_TEXTS = frozenset(
    {
        "n/a",
        "na",
        "none",
        "null",
        "unknown",
        "unavailable",
        "not available",
        "not provided",
        "not specified",
        "no steps",
        "no instructions",
        "no method",
        "no procedure",
        "no cooking steps",
        "no cooking instructions",
        "no tutorial steps",
        "no tutorial instructions",
        "no usable steps",
        "no usable instructions",
        "no usable cooking steps",
        "no usable cooking instructions",
        "no steps available",
        "no instructions available",
        "no method available",
        "no procedure available",
        "no cooking steps available",
        "no cooking instructions available",
        "no tutorial steps available",
        "no tutorial instructions available",
        "steps unavailable",
        "instructions unavailable",
        "method unavailable",
        "procedure unavailable",
        "tutorial steps unavailable",
        "tutorial instructions unavailable",
        "no steps provided",
        "no instructions provided",
        "no method provided",
        "no procedure provided",
        "no cooking steps provided",
        "no cooking instructions provided",
        "no tutorial steps provided",
        "no tutorial instructions provided",
        "steps not provided",
        "instructions not provided",
        "method not provided",
        "procedure not provided",
        "not enough information",
        "insufficient information",
        "无",
        "暂无",
        "未提供",
        "信息不足",
        "无步骤",
        "没有步骤",
        "暂无步骤",
        "未提供步骤",
        "没有提供步骤",
        "步骤不详",
        "未找到步骤",
        "无可用步骤",
        "无法确定步骤",
        "无烹饪步骤",
        "没有烹饪步骤",
        "暂无烹饪步骤",
        "未提供烹饪步骤",
        "没有提供烹饪步骤",
        "未找到烹饪步骤",
        "无可用烹饪步骤",
        "无法确定烹饪步骤",
        "无操作步骤",
        "没有操作步骤",
        "暂无操作步骤",
        "未提供操作步骤",
        "无做法",
        "没有做法",
        "暂无做法",
        "未提供做法",
        "做法不详",
        "无法确定做法",
    }
)
_UNUSABLE_INGREDIENT_NAMES = frozenset(
    {
        "n/a",
        "na",
        "none",
        "null",
        "unknown",
        "unavailable",
        "not available",
        "not provided",
        "not specified",
        "no ingredient",
        "no ingredients",
        "no ingredients available",
        "no ingredients provided",
        "ingredients unavailable",
        "ingredients not provided",
        "not enough information",
        "insufficient information",
        "example ingredient",
        "无",
        "暂无",
        "未提供",
        "信息不足",
        "无食材",
        "没有食材",
        "暂无食材",
        "未提供食材",
        "食材不详",
        "无配料",
        "没有配料",
        "暂无配料",
        "未提供配料",
        "配料不详",
    }
)


TranscriptFetchResult = VideoTextResult


def _parse_youtube_video_id(url: str) -> str | None:
    """Return a YouTube ID when a supported YouTube URL can be classified."""
    try:
        source = parse_video_source(url)
    except UnsupportedVideoUrl:
        return None
    return source.external_id if source.provider == "youtube" else None


def fetch_transcript_from_video_link(url: str) -> TranscriptFetchResult:
    """Compatibility wrapper for callers that still pass a raw YouTube URL."""
    try:
        source = parse_video_source(url)
    except UnsupportedVideoUrl:
        return VideoTextResult(
            status="unsupported_url",
            text="",
            source=VideoSource("youtube", url, url, None),
            message="Only YouTube links are supported right now. Paste a transcript for other platforms.",
        )
    if source.provider != "youtube":
        return VideoTextResult(
            status="unsupported_url",
            text="",
            source=VideoSource("youtube", url, url, None),
            message="Only YouTube links are supported right now. Paste a transcript for other platforms.",
        )
    return fetch_youtube_text(source)


def _build_extraction_prompt(transcript: str) -> str:
    body = transcript.strip() or "(No transcript provided.)"
    return f"""You are extracting a cooking recipe from video content. Below is the speech transcript.

Extract the following JSON:
- title: short dish name. Preserve the source language (CJK stays CJK; English parens optional, e.g. "麻婆豆腐 (Mapo Tofu)").
- description: one short paragraph (<= 2 sentences) describing the dish. null if the transcript doesn't say.
- total_time_minutes: integer total minutes, or null if unclear.
- ingredients: list of {{name, quantity, notes}}.
- equipment: list of distinct tools/pans named in the transcript. [] if none mentioned.
- steps: ordered list of {{text, duration_seconds, duration_source, attention_type, action_type}}. Convert every cooking action described by the source, including fragmented narration, into short, self-contained, actionable instructions. Preserve the source order and meaning. Merge adjacent fragments only when they describe the same action, and split them only when the source clearly moves to a new action. Return [] only when the source contains no cooking procedure at all.
  - duration_seconds: positive whole seconds from 15 to 86400. Use a source-stated duration when explicit; otherwise estimate a plausible duration for that exact step.
  - duration_source: "stated" only when the source explicitly states the duration; otherwise "estimated".
  - attention_type: "hands_on" or "passive". hands_on means the cook is actively working; passive means they may safely leave the step until attention is needed.
  - action_type: one of "prep", "chop", "mix", "season", "sear", "simmer", "boil", "bake", "rest", "drain", "assemble", "plate", or "other".
- tips: list of chef tips/tricks explicitly mentioned (e.g., "press tofu first"). [] if none.

Language rules:
- If the source names ingredients/steps/tips in Chinese, keep them in Chinese. English in parens is optional.
- Quantities and durations may stay in the source language.

Metadata may be inferred. Do not introduce new ingredients, quantities, temperatures, techniques, or procedural claims that are not supported by the source.

--- TRANSCRIPT ---
{body}
--- END ---

Respond with a JSON object only, no markdown:
{{ "title": "...", "description": null, "total_time_minutes": null,
   "ingredients": [{{ "name": "...", "quantity": "...", "notes": null }}],
   "equipment": [],
   "steps": [{{ "text": "...", "duration_seconds": 480, "duration_source": "stated", "attention_type": "passive", "action_type": "simmer" }}],
   "tips": []
}}"""


def _split_dual_quantity(quantity: str) -> tuple[str, str | None]:
    raw = (quantity or "").strip()
    if not raw:
        return "", None
    metric_match = _METRIC_SEGMENT_RE.search(raw)
    if not metric_match:
        return raw, None
    metric = metric_match.group("metric").strip()
    primary = raw[: metric_match.start()].strip()
    if not primary or not _NON_METRIC_UNIT_RE.search(primary):
        return raw, None
    return primary, metric


def _decode_llm_json_object(raw: str) -> dict | None:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _clean_instruction_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    normalized = re.sub(r"\s+", " ", value).strip()
    sentinel_key = normalized.casefold().rstrip("。.!！?？:：;；").strip()
    return "" if not normalized or sentinel_key in _UNUSABLE_STEP_TEXTS else normalized


def _clean_ingredient_name(value: object) -> str:
    if not isinstance(value, str):
        return ""
    normalized = re.sub(r"\s+", " ", value).strip()
    sentinel_key = normalized.casefold().rstrip("。.!！?？:：;；").strip()
    return (
        "" if not normalized or sentinel_key in _UNUSABLE_INGREDIENT_NAMES else normalized
    )


def is_usable_instruction_text(value: object) -> bool:
    """Return whether text represents an instruction rather than an empty-status marker."""
    return bool(_clean_instruction_text(value))


def parse_llm_recipe_response(raw: str) -> dict:
    """Parse LLM JSON response into a recipe-shaped dict.

    Returns: {title, description, total_time_minutes, ingredients, equipment, steps, tips}.
    All fields default to safe empty values; the caller passes this dict to Recipe(...).
    """
    data = _decode_llm_json_object(raw)
    if not isinstance(data, dict):
        return {
            "title": "Imported Recipe",
            "description": None,
            "total_time_minutes": None,
            "ingredients": [],
            "equipment": [],
            "steps": [],
            "tips": [],
        }

    title = _extraction_string(data.get("title"), "Untitled Recipe")

    ingredients_raw = data.get("ingredients")
    if not isinstance(ingredients_raw, list):
        ingredients_raw = []
    ingredients: list[dict] = []
    for i in ingredients_raw:
        if isinstance(i, dict):
            name = _clean_ingredient_name(i.get("name"))
            if not name:
                continue
            quantity, metric_quantity = _split_dual_quantity(
                _extraction_string(i.get("quantity"))
            )
            ingredients.append({
                "name": name,
                "quantity": quantity,
                "metric_quantity": metric_quantity,
                "notes": _extraction_optional_string(i.get("notes")),
            })
        elif name := _clean_ingredient_name(i):
            ingredients.append(
                {
                    "name": name,
                    "quantity": "",
                    "metric_quantity": None,
                    "notes": None,
                }
            )

    steps: list[dict] = []
    for key in ("steps", "instructions", "procedure", "method"):
        candidate_steps = _parse_step_container(data.get(key))
        if candidate_steps:
            steps = candidate_steps
            break

    return {
        "title": title,
        "description": _extraction_optional_string(data.get("description")),
        "total_time_minutes": data.get("total_time_minutes"),
        "ingredients": ingredients,
        "equipment": _extraction_string_list(data.get("equipment")),
        "steps": steps,
        "tips": _extraction_string_list(data.get("tips")),
    }


def _parse_step_container(
    candidate: object,
    *,
    text_keys: tuple[str, ...] = ("text", "instruction", "step", "description"),
    allow_string_rows: bool = True,
    duration_source_override: str | None = None,
) -> list[dict]:
    if isinstance(candidate, list):
        rows = candidate
    elif allow_string_rows and isinstance(candidate, str):
        rows = [candidate]
    else:
        return []

    steps: list[dict] = []
    for s in rows:
        if isinstance(s, dict):
            step_text = next(
                (
                    cleaned
                    for key in text_keys
                    if (cleaned := _clean_instruction_text(s.get(key)))
                ),
                "",
            )
            if not step_text:
                continue
            steps.append({
                "text": step_text,
                "duration_seconds": s.get("duration_seconds"),
                "duration_source": (
                    duration_source_override
                    or _extraction_metadata(
                        s.get("duration_source"), DURATION_SOURCES, "fallback"
                    )
                ),
                "attention_type": _extraction_metadata(
                    s.get("attention_type"), ATTENTION_TYPES, "hands_on"
                ),
                "action_type": _extraction_metadata(
                    s.get("action_type"), ACTION_TYPES, "other"
                ),
            })
        elif allow_string_rows and (step_text := _clean_instruction_text(s)):
            steps.append({
                "text": step_text,
                "duration_seconds": None,
                "duration_source": "fallback",
                "attention_type": "hands_on",
                "action_type": "other",
            })

    return steps


def _extraction_string(value: object, default: str = "") -> str:
    if value is None:
        return default
    return value if isinstance(value, str) else str(value)


def _extraction_optional_string(value: object) -> str | None:
    return None if value is None else _extraction_string(value)


def _extraction_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _extraction_metadata(value: object, allowed: frozenset[str], fallback: str) -> str:
    """Accept only the metadata enum values supported by tutorial normalization."""
    if not isinstance(value, str):
        return fallback
    value = value.strip()
    return value if value in allowed else fallback


def _has_meaningful_extracted_ingredients(data: dict) -> bool:
    ingredients = data.get("ingredients")
    if not isinstance(ingredients, list):
        return False
    for ingredient in ingredients:
        if not isinstance(ingredient, dict):
            continue
        name = ingredient.get("name")
        if (
            isinstance(name, str)
            and bool(_clean_ingredient_name(name))
        ):
            return True
    return False


def _has_usable_extracted_steps(data: dict) -> bool:
    steps = data.get("steps")
    if not isinstance(steps, list):
        return False
    return any(
        isinstance(step, dict)
        and is_usable_instruction_text(step.get("text"))
        for step in steps
    )


def _parse_recovered_steps(raw: str) -> list[dict]:
    data = _decode_llm_json_object(raw)
    if data is None:
        return []
    return _parse_step_container(
        data.get("steps"),
        text_keys=("text",),
        allow_string_rows=False,
        duration_source_override="estimated",
    )


def _build_step_recovery_prompt(transcript: str, data: dict) -> str:
    recipe_context = {
        "title": data.get("title"),
        "description": data.get("description"),
        "total_time_minutes": data.get("total_time_minutes"),
        "ingredients": data.get("ingredients") or [],
    }
    return f"""The first recipe extraction found meaningful ingredients but no usable tutorial steps.

Return a JSON object containing only a non-empty \"steps\" array. Each step must contain:
- text: one short, self-contained cooking instruction in the source language
- duration_seconds: a plausible positive whole-number estimate from 15 to 86400
- duration_source: \"estimated\"
- attention_type: \"hands_on\" or \"passive\"
- action_type: one of {", ".join(sorted(ACTION_TYPES))}

First recover every cooking action that is stated or implied by the source, preserving its order. If the source truly contains only a dish name and ingredients, infer a short, conservative best-effort method typical for that dish. Use only the listed ingredients and do not add unsupported quantities, precise temperatures, specialized equipment, or optional garnishes. Never present an estimated duration as source-stated.

EXTRACTED RECIPE:
{json.dumps(recipe_context, ensure_ascii=False)}

SOURCE TEXT:
{transcript.strip() or "(No source text provided.)"}
"""


async def _request_json_completion(client, prompt: str) -> str:
    return await complete_chat(
        client,
        operation="recipe_extraction",
        messages=[{"role": "user", "content": prompt}],
        json_object=True,
    )


def _build_tutorial_estimation_prompt(steps: list[RecipeStep]) -> str:
    records = [
        {
            "number": index,
            "id": step.id,
            "text": step.text,
            "duration_seconds": step.duration_seconds,
            "duration_source": step.duration_source,
            "attention_type": step.attention_type,
            "action_type": step.action_type,
        }
        for index, step in enumerate(steps, start=1)
    ]
    return f"""Estimate tutorial metadata for these existing cooking steps.

Return a JSON array with exactly one object per supplied step. Each object may contain only:
- id: copy the supplied ID exactly
- duration_seconds: a positive whole number from 15 to 86400
- attention_type: "hands_on" or "passive"
- action_type: one of {", ".join(sorted(ACTION_TYPES))}

Do not return text. Do not add, delete, reorder, split, or merge steps.

STEPS:
{json.dumps(records, ensure_ascii=False)}
"""


def _parse_tutorial_estimates(raw: str) -> dict[str, dict[str, object]] | None:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    if isinstance(data, dict):
        data = data.get("steps")
    if not isinstance(data, list):
        return None

    counts: dict[str, int] = {}
    candidates: dict[str, dict[str, object]] = {}
    for item in data:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            continue
        step_id = item["id"]
        counts[step_id] = counts.get(step_id, 0) + 1
        candidates[step_id] = item
    return {
        step_id: item
        for step_id, item in candidates.items()
        if counts[step_id] == 1
    }


def _valid_estimated_duration(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if not GENERATED_MIN_SECONDS <= value <= MAX_STEP_SECONDS:
        return None
    return value


async def estimate_tutorial_step_metadata(steps: list[RecipeStep]) -> list[RecipeStep]:
    """Preview metadata suggestions without changing step identity or content."""
    if not steps:
        return []

    estimates: dict[str, dict[str, object]] = {}
    client = get_openai_client()
    if client is not None:
        try:
            raw = await complete_chat(
                client,
                operation="tutorial_estimation",
                messages=[
                    {
                        "role": "user",
                        "content": _build_tutorial_estimation_prompt(steps),
                    }
                ],
            )
            estimates = _parse_tutorial_estimates(raw) or {}
        except Exception as exc:
            logger.warning("Tutorial metadata estimation using local defaults error_type=%s", type(exc).__name__)

    merged: list[RecipeStep] = []
    for step in steps:
        local_attention, local_action = classify_step_metadata(step.text)
        estimate = estimates.get(step.id or "", {})
        attention = _extraction_metadata(
            estimate.get("attention_type"), ATTENTION_TYPES, local_attention
        )
        action = _extraction_metadata(
            estimate.get("action_type"), ACTION_TYPES, local_action
        )
        updates: dict[str, object] = {
            "attention_type": attention,
            "action_type": action,
        }
        estimated_duration = _valid_estimated_duration(
            estimate.get("duration_seconds")
        )
        if step.duration_source == "fallback" and estimated_duration is not None:
            updates["duration_seconds"] = estimated_duration
            updates["duration_source"] = "estimated"
        merged.append(RecipeStep(**{**step.model_dump(), **updates}))
    return merged


async def extract_recipe_from_text(transcript: str) -> Recipe:
    client = get_openai_client()
    if client is None:
        raise AIUnavailableError()
    else:
        raw = await _request_json_completion(client, _build_extraction_prompt(transcript))
        data = parse_llm_recipe_response(raw)
        if (
            not _has_usable_extracted_steps(data)
            and _has_meaningful_extracted_ingredients(data)
        ):
            try:
                recovery_raw = await _request_json_completion(
                    client,
                    _build_step_recovery_prompt(transcript, data),
                )
                recovered_steps = _parse_recovered_steps(recovery_raw)
                if recovered_steps:
                    data = {**data, "steps": recovered_steps}
            except Exception as exc:
                logger.warning(
                    "Recipe step recovery failed; keeping initial extraction error_type=%s",
                    type(exc).__name__,
                )

    return Recipe(
        id=str(uuid.uuid4()),
        title=data["title"],
        source_url=None,
        thumbnail_url=None,
        ingredients=[IngredientItem(**x) for x in data["ingredients"]],
        raw_extraction_text=transcript or None,
        description=data.get("description"),
        total_time_minutes=data.get("total_time_minutes"),
        steps=data.get("steps") or [],
        tips=data.get("tips") or [],
        equipment=data.get("equipment") or [],
    )
