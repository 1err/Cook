"""Script normalization for new import display fields, never saved source evidence."""
from __future__ import annotations

from functools import lru_cache
import re

from opencc import OpenCC


_HAN = re.compile(r"[\u3400-\u9fff\uf900-\ufaff\U00020000-\U000323af]")
_JAPANESE_OR_KOREAN = re.compile(
    r"[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d\U0001b000-\U0001b16f"
    r"\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]"
)
_URL = re.compile(r"(https?://[^\s<>\"'，。；]+)", re.IGNORECASE)


@lru_cache(maxsize=1)
def _converter() -> OpenCC:
    return OpenCC("t2s.json")


def chinese_comparison_text(text: str) -> str:
    """Fold script in temporary semantic-comparison copies only.

    Never use this for verbatim-source membership or caption-location matching.
    """
    return _converter().convert(text) if _HAN.search(text) else text


def _display_text(value: object) -> object:
    if not isinstance(value, str) or _JAPANESE_OR_KOREAN.search(value):
        return value
    # URLs can contain Han characters too; converting their paths changes identity.
    return "".join(part if index % 2 else chinese_comparison_text(part)
                   for index, part in enumerate(_URL.split(value)))


def normalize_import_display_fields(data: dict, *, source_text: str = "") -> dict:
    """Return new display rows after grounding; all metadata/evidence stays intact.

    Kana/Hangul in primary prose protects the whole recipe, including Han-only
    Japanese/Korean labels. A kana ingredient alone protects that field rather
    than suppressing Chinese conversion elsewhere. With no prose, source text
    supplies this signal. Han-only text is inherently language-ambiguous; this
    bounded script heuristic is not a general language detector.
    """
    prose = [data.get("description"), *(step.get("text") for step in data.get("steps", []) if isinstance(step, dict))]
    prose = [text for text in prose if isinstance(text, str) and text.strip()]
    if any(_JAPANESE_OR_KOREAN.search(text) for text in (prose or [source_text])):
        return dict(data)
    result = dict(data)
    for key in ("title", "description"):
        if key in data:
            result[key] = _display_text(data[key])
    if "ingredients" in data:
        result["ingredients"] = [
            {**item, **{key: _display_text(item[key]) for key in ("name", "quantity", "metric_quantity", "notes") if key in item}}
            for item in data["ingredients"]
        ]
    if "steps" in data:
        result["steps"] = [{**step, "text": _display_text(step.get("text"))} for step in data["steps"]]
    if "tips" in data:
        result["tips"] = [_display_text(text) for text in data["tips"]]
    return result
