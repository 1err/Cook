"""
Recipe extraction from a YouTube transcript or pasted text.
LLM produces dish title + ingredient list; falls back to a deterministic stub
when ``OPENAI_API_KEY`` is unset so the flow stays testable end-to-end.
"""
import json
import logging
import re
import uuid
from dataclasses import dataclass

from app.core.llm import get_openai_client
from app.models import IngredientItem, Recipe, RecipeStep
from app.video_import import UnsupportedVideoUrl, parse_video_source
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


@dataclass(slots=True)
class TranscriptFetchResult:
    transcript: str
    status: str
    message: str | None = None
    video_id: str | None = None


def _parse_youtube_video_id(url: str) -> str | None:
    """Return a YouTube ID when a supported YouTube URL can be classified."""
    try:
        source = parse_video_source(url)
    except UnsupportedVideoUrl:
        return None
    return source.external_id if source.provider == "youtube" else None


def fetch_transcript_from_video_link(url: str) -> TranscriptFetchResult:
    """
    Fetch captions for YouTube URLs using youtube-transcript-api (no Google Cloud).
    Prefers English or Chinese. Returns a structured result so callers can decide whether to continue.
    """
    video_id = _parse_youtube_video_id(url)
    if not video_id:
        logger.info("Transcript fetch skipped: not a YouTube URL or could not parse video ID")
        return TranscriptFetchResult(
            transcript="",
            status="unsupported_url",
            message="Only YouTube links are supported right now. Paste a transcript for other platforms.",
        )

    logger.info("Fetching transcript for video_id=%s", video_id)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import (
            NoTranscriptFound,
            TranscriptsDisabled,
            VideoUnavailable,
        )
    except ModuleNotFoundError:
        logger.warning(
            "youtube-transcript-api not installed; run: pip install youtube-transcript-api"
        )
        return TranscriptFetchResult(
            transcript="",
            status="dependency_missing",
            message="YouTube transcript support is not available on the server right now.",
            video_id=video_id,
        )

    try:
        api = YouTubeTranscriptApi()
        fetched = api.fetch(
            video_id,
            languages=["en", "zh", "zh-Hans", "zh-Hant"],
        )
        combined = " ".join(snippet.text for snippet in fetched).strip()
        logger.info(
            "Transcript fetched, video_id=%s, language=%s, length=%d",
            video_id,
            getattr(fetched, "language_code", "?"),
            len(combined),
        )
        return TranscriptFetchResult(transcript=combined, status="ok", video_id=video_id)
    except TranscriptsDisabled:
        logger.warning("Captions disabled for video_id=%s", video_id)
        return TranscriptFetchResult(
            transcript="",
            status="captions_disabled",
            message="This YouTube video has captions disabled. Paste a transcript instead.",
            video_id=video_id,
        )
    except VideoUnavailable:
        logger.warning("Video unavailable for video_id=%s", video_id)
        return TranscriptFetchResult(
            transcript="",
            status="video_unavailable",
            message="This YouTube video is unavailable or private. Try another link or paste a transcript.",
            video_id=video_id,
        )
    except NoTranscriptFound:
        logger.warning("No transcript found for video_id=%s", video_id)
        return TranscriptFetchResult(
            transcript="",
            status="no_transcript",
            message="No usable transcript was found for this YouTube video. Paste a transcript instead.",
            video_id=video_id,
        )
    except Exception as e:
        logger.exception("Transcript fetch failed for video_id=%s: %s", video_id, e)
        return TranscriptFetchResult(
            transcript="",
            status="fetch_failed",
            message="We could not fetch captions from YouTube for this video right now. Please try again or paste a transcript.",
            video_id=video_id,
        )


def _build_extraction_prompt(transcript: str) -> str:
    body = transcript.strip() or "(No transcript provided.)"
    return f"""You are extracting a cooking recipe from video content. Below is the speech transcript.

Extract the following JSON:
- title: short dish name. Preserve the source language (CJK stays CJK; English parens optional, e.g. "麻婆豆腐 (Mapo Tofu)").
- description: one short paragraph (<= 2 sentences) describing the dish. null if the transcript doesn't say.
- total_time_minutes: integer total minutes, or null if unclear.
- ingredients: list of {{name, quantity, notes}}.
- equipment: list of distinct tools/pans named in the transcript. [] if none mentioned.
- steps: ordered list of {{text, duration_seconds, duration_source, attention_type, action_type}}. Each step is one short instruction copied from the source. If the transcript is thin or doesn't describe procedure, return []. DO NOT add, split, merge, or invent procedural steps. DO NOT invent procedure.
  - duration_seconds: positive whole seconds from 15 to 86400. Use a source-stated duration when explicit; otherwise estimate a plausible duration for that exact step.
  - duration_source: "stated" only when the source explicitly states the duration; otherwise "estimated".
  - attention_type: "hands_on" or "passive". hands_on means the cook is actively working; passive means they may safely leave the step until attention is needed.
  - action_type: one of "prep", "chop", "mix", "season", "sear", "simmer", "boil", "bake", "rest", "drain", "assemble", "plate", or "other".
- tips: list of chef tips/tricks explicitly mentioned (e.g., "press tofu first"). [] if none.

Language rules:
- If the source names ingredients/steps/tips in Chinese, keep them in Chinese. English in parens is optional.
- Quantities and durations may stay in the source language.

Metadata may be inferred, but DO NOT invent details or procedural steps that are not suggested by the text.

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


def parse_llm_recipe_response(raw: str) -> dict:
    """Parse LLM JSON response into a recipe-shaped dict.

    Returns: {title, description, total_time_minutes, ingredients, equipment, steps, tips}.
    All fields default to safe empty values; the caller passes this dict to Recipe(...).
    """
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = None
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
            quantity, metric_quantity = _split_dual_quantity(
                _extraction_string(i.get("quantity"))
            )
            ingredients.append({
                "name": _extraction_string(i.get("name")),
                "quantity": quantity,
                "metric_quantity": metric_quantity,
                "notes": _extraction_optional_string(i.get("notes")),
            })
        else:
            ingredients.append({"name": str(i), "quantity": "", "notes": None})

    steps_raw = data.get("steps")
    if not isinstance(steps_raw, list):
        steps_raw = []
    steps: list[dict] = []
    for s in steps_raw:
        if isinstance(s, dict):
            steps.append({
                "text": s.get("text") or "",
                "duration_seconds": s.get("duration_seconds"),
                "duration_source": _extraction_metadata(
                    s.get("duration_source"), DURATION_SOURCES, "fallback"
                ),
                "attention_type": _extraction_metadata(
                    s.get("attention_type"), ATTENTION_TYPES, "hands_on"
                ),
                "action_type": _extraction_metadata(
                    s.get("action_type"), ACTION_TYPES, "other"
                ),
            })
        elif isinstance(s, str):
            steps.append({
                "text": s,
                "duration_seconds": None,
                "duration_source": "fallback",
                "attention_type": "hands_on",
                "action_type": "other",
            })

    return {
        "title": title,
        "description": _extraction_optional_string(data.get("description")),
        "total_time_minutes": data.get("total_time_minutes"),
        "ingredients": ingredients,
        "equipment": _extraction_string_list(data.get("equipment")),
        "steps": steps,
        "tips": _extraction_string_list(data.get("tips")),
    }


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
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": _build_tutorial_estimation_prompt(steps),
                    }
                ],
            )
            raw = response.choices[0].message.content or "[]"
            estimates = _parse_tutorial_estimates(raw) or {}
        except Exception as exc:
            logger.warning("Tutorial metadata estimation failed; using local defaults: %s", exc)

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
        data = _stub_extraction(transcript or "(no input)")
    else:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": _build_extraction_prompt(transcript)}],
        )
        raw = response.choices[0].message.content or "{}"
        data = parse_llm_recipe_response(raw)

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


def _stub_extraction(input_text: str) -> dict:
    """When OPENAI_API_KEY is not set, return a demo recipe so the flow is testable."""
    text = (input_text or "").lower()
    if "tofu" in text or "mapo" in text:
        return {
            "title": "Mapo Tofu",
            "description": "A spicy Sichuan classic of soft tofu in a fiery doubanjiang sauce.",
            "total_time_minutes": 25,
            "ingredients": [
                {"name": "Soft tofu", "quantity": "1 block", "notes": "diced"},
                {"name": "Ground pork", "quantity": "100g", "notes": None},
                {"name": "Doubanjiang", "quantity": "1 tbsp", "notes": None},
                {"name": "Garlic", "quantity": "2 cloves", "notes": "minced"},
                {"name": "Green onion", "quantity": "2", "notes": "chopped"},
            ],
            "equipment": ["wok", "spatula"],
            "steps": [
                {
                    "text": "Dice the tofu into 2 cm cubes and let it sit in lightly salted hot water.",
                    "duration_seconds": 180,
                    "duration_source": "estimated",
                    "attention_type": "hands_on",
                    "action_type": "chop",
                },
                {
                    "text": "Sear ground pork in the wok until browned and crispy at the edges.",
                    "duration_seconds": 240,
                    "duration_source": "estimated",
                    "attention_type": "hands_on",
                    "action_type": "sear",
                },
                {
                    "text": "Add doubanjiang and garlic; stir-fry until fragrant.",
                    "duration_seconds": 60,
                    "duration_source": "estimated",
                    "attention_type": "hands_on",
                    "action_type": "season",
                },
                {
                    "text": "Drain the tofu, slide it into the wok, and simmer gently with stock.",
                    "duration_seconds": 180,
                    "duration_source": "estimated",
                    "attention_type": "passive",
                    "action_type": "simmer",
                },
                {
                    "text": "Thicken with a cornstarch slurry, finish with green onion and Sichuan pepper.",
                    "duration_seconds": 60,
                    "duration_source": "estimated",
                    "attention_type": "hands_on",
                    "action_type": "assemble",
                },
            ],
            "tips": ["Drain the tofu well before adding it — it absorbs sauce better."],
        }
    return {
        "title": "Imported Recipe",
        "description": None,
        "total_time_minutes": None,
        "ingredients": [
            {"name": "Example ingredient", "quantity": "to taste", "notes": "Replace with real extraction"},
        ],
        "equipment": [],
        "steps": [],
        "tips": [],
    }
