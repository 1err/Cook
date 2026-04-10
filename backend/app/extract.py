"""
Recipe extraction from video: text-first approach.
Primary: transcript. Secondary: OCR from ingredient-card frames.
LLM combines both to produce dish name + ingredient list.
"""
import logging
import os
import re
from dataclasses import dataclass
from typing import Optional
from app.models import Recipe, IngredientItem

logger = logging.getLogger(__name__)


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
    # youtu.be/ID
    m = re.search(r"youtu\.be/([a-zA-Z0-9_-]{11})(?:[?&#]|$)", url)
    if m:
        return m.group(1)
    # youtube.com/embed/ID
    m = re.search(r"youtube\.com/embed/([a-zA-Z0-9_-]{11})", url)
    if m:
        return m.group(1)
    # youtube.com/watch?v=ID or ?...&v=ID
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
            TranscriptsDisabled,
            VideoUnavailable,
            NoTranscriptFound,
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
        # youtube-transcript-api 1.x: instance .fetch(video_id, languages=...)
        api = YouTubeTranscriptApi()
        fetched = api.fetch(
            video_id,
            languages=["en", "zh", "zh-Hans", "zh-Hant"],
        )
        combined = " ".join(snippet.text for snippet in fetched).strip()
        logger.info(
            "Transcript fetched successfully, video_id=%s, language=%s, length=%d",
            video_id,
            getattr(fetched, "language_code", "?"),
            len(combined),
        )
        return TranscriptFetchResult(
            transcript=combined,
            status="ok",
            video_id=video_id,
        )
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


def get_transcript_from_video_link(url: str) -> str:
    """Compatibility wrapper for older call sites."""
    return fetch_transcript_from_video_link(url).transcript


# TODO: Replace with real transcript from uploaded file (e.g. Whisper)
def get_transcript_from_uploaded_file(file_path: str) -> str:
    """Stub: return placeholder. Real impl would use speech-to-text."""
    return ""


# TODO: Optional OCR on frames that show ingredient lists (e.g. "Ingredients", "材料")
def get_ocr_text_from_video(video_path_or_url: str) -> str:
    """Stub: return empty. Real impl would sample frames and run OCR."""
    return ""


def _build_extraction_prompt(transcript: str, ocr_text: str = "") -> str:
    combined = transcript.strip()
    if ocr_text.strip():
        combined += "\n\n[Text from video screen / ingredient cards]:\n" + ocr_text.strip()
    if not combined:
        combined = "(No transcript or OCR text provided.)"
    return f"""You are extracting a cooking recipe from video content. Below is text from the video (speech transcript and/or on-screen ingredient lists).

Extract:
1) A short dish title. Use the same language as the source when it is clearly Chinese (e.g. 麻婆豆腐 or 麻婆豆腐 (Mapo Tofu)); do not force an English title if the source is Chinese.
2) A list of ingredients. For each ingredient give: name, quantity (as free text), and optional notes.

Language rules for ingredient names (critical):
- If the text names an ingredient in Chinese, keep the name in Chinese in the "name" field. Do not translate Chinese ingredient names to English-only.
- You may add English in parentheses for clarity, e.g. 牛腱肉 (beef shank), 八角 (star anise). Plain Chinese alone is fine.
- Quantities and notes may stay as spoken/written (Chinese numerals/units OK).

Do not invent ingredients that are not suggested by the text. If something is unclear, make a reasonable guess or omit it.

--- TEXT FROM VIDEO ---
{combined}
--- END ---

Respond with a JSON object only, no markdown:
{{ "title": "...", "ingredients": [ {{ "name": "...", "quantity": "...", "notes": null or "..." }} ] }}"""


def parse_llm_recipe_response(raw: str) -> tuple[str, list[dict]]:
    """Parse LLM JSON response into title and list of ingredient dicts."""
    import json
    # Strip markdown code block if present
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    data = json.loads(text)
    title = data.get("title") or "Untitled Recipe"
    ingredients = data.get("ingredients") or []
    items = []
    for i in ingredients:
        if isinstance(i, dict):
            items.append({
                "name": i.get("name") or "",
                "quantity": i.get("quantity") or "",
                "notes": i.get("notes"),
            })
        else:
            items.append({"name": str(i), "quantity": "", "notes": None})
    return title, items


async def extract_recipe_from_text(transcript: str, ocr_text: str = "") -> Recipe:
    """
    Combine transcript + optional OCR, call LLM, return Recipe (without id; caller assigns id).
    """
    import uuid
    from openai import AsyncOpenAI

    prompt = _build_extraction_prompt(transcript, ocr_text)
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        # Stub: no API key -> return a demo recipe from placeholder text
        title, ingredients = _stub_extraction(transcript or "(no input)")
        return Recipe(
            id=str(uuid.uuid4()),
            title=title,
            source_url=None,
            thumbnail_url=None,
            ingredients=[IngredientItem(**i) for i in ingredients],
            raw_extraction_text=transcript or None,
        )

    client = AsyncOpenAI(api_key=api_key)
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.choices[0].message.content or "{}"
    title, ing_list = parse_llm_recipe_response(raw)
    return Recipe(
        id=str(uuid.uuid4()),
        title=title,
        source_url=None,
        thumbnail_url=None,
        ingredients=[IngredientItem(**x) for x in ing_list],
        raw_extraction_text=transcript or None,
    )


def _stub_extraction(input_text: str) -> tuple[str, list[dict]]:
    """When OPENAI_API_KEY is not set, return a demo recipe so the flow is testable."""
    if "tofu" in input_text.lower() or "mapo" in input_text.lower():
        return "Mapo Tofu", [
            {"name": "Soft tofu", "quantity": "1 block", "notes": "diced"},
            {"name": "Ground pork", "quantity": "100g", "notes": None},
            {"name": "Doubanjiang", "quantity": "1 tbsp", "notes": None},
            {"name": "Garlic", "quantity": "2 cloves", "notes": "minced"},
            {"name": "Green onion", "quantity": "2", "notes": "chopped"},
        ]
    return "Imported Recipe", [
        {"name": "Example ingredient", "quantity": "to taste", "notes": "Replace with real extraction"},
    ]
