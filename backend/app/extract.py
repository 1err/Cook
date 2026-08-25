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
from typing import Optional

from app.core.llm import get_openai_client
from app.models import IngredientItem, Recipe
from app.tutorial import ACTION_TYPES, ATTENTION_TYPES, DURATION_SOURCES

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


def _parse_youtube_video_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from common URL forms. Returns None if not YouTube or unparseable."""
    url = (url or "").strip()
    if "youtube.com" not in url and "youtu.be" not in url:
        return None
    m = re.search(r"youtu\.be/([a-zA-Z0-9_-]{11})(?:[?&#]|$)", url)
    if m:
        return m.group(1)
    m = re.search(r"youtube\.com/embed/([a-zA-Z0-9_-]{11})", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]v=([a-zA-Z0-9_-]{11})(?:&|#|$)", url)
    if m:
        return m.group(1)
    return None


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
