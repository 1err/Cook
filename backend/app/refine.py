"""
Shopping list refinement via OpenAI: remove non-purchasables, flag pantry staples,
suggest purchase-ready quantities. Stateless; no DB.
"""
import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

def _build_system_prompt(pantry_names: list[str]) -> str:
    """Build system prompt. pantry_names is unused (stateless); kept for API compatibility."""
    return """You are a grocery shopping assistant helping users in the United States.
Given recipe ingredients, determine:

1) Which items should be removed because they are not purchased (e.g. water).
2) Which items are common pantry staples that users often keep at home.
   - Do NOT assume the user has them. Do NOT imply confirmed possession.
   - This is only a suggestion to help the user decide what they might already have.
3) For remaining items, suggest realistic purchase forms (e.g. 2 cups cabbage → 1 whole cabbage).

Return STRICT JSON only.

JSON format:
{
  "remove": [string],
  "likely_pantry": [
    { "name": string, "reason": string }
  ],
  "purchase_items": [
    { "name": string, "suggested_purchase": string }
  ]
}

For "likely_pantry", the "reason" must be a general suggestion only. Good examples:
- "Common pantry staple"
- "Shelf-stable ingredient"
- "Frequently stocked household item"
- "Often kept on hand"
Never use: "Already in user's pantry", "User has this", "Confirmed pantry item", or any phrase implying the user definitely has the item.

Do not include explanations outside JSON.
Do not include markdown."""


def _build_user_prompt(items: list[dict[str, str]]) -> str:
    """Pass aggregated items as JSON for the LLM."""
    return json.dumps([{"name": (i.get("name") or "").strip(), "quantity": (i.get("quantity") or "").strip()} for i in items])


def _fallback_result(items: list[dict[str, str]]) -> dict[str, Any]:
    """When API key missing or parsing fails: treat all as purchase_items."""
    return {
        "remove": [],
        "likely_pantry": [],
        "purchase_items": [
            {"name": (i.get("name") or "").strip(), "suggested_purchase": (i.get("quantity") or "").strip() or (i.get("name") or "").strip()}
            for i in items
        ],
    }


def _parse_llm_refine_response(raw: str, fallback_items: list[dict[str, str]]) -> dict[str, Any]:
    """Parse LLM JSON; on failure return fallback (original list as purchase_items)."""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        logger.warning("Refine LLM response JSON parse failed: %s", e)
        return _fallback_result(fallback_items)
    remove = data.get("remove")
    if not isinstance(remove, list):
        remove = []
    remove = [str(x).strip() for x in remove if x]

    likely_pantry = data.get("likely_pantry")
    if not isinstance(likely_pantry, list):
        likely_pantry = []
    pantry_out = []
    for x in likely_pantry:
        if isinstance(x, dict) and x.get("name"):
            pantry_out.append({"name": str(x.get("name", "")).strip(), "reason": str(x.get("reason", "")).strip()})

    purchase_items = data.get("purchase_items")
    if not isinstance(purchase_items, list):
        purchase_items = []
    purchase_out = []
    for x in purchase_items:
        if isinstance(x, dict) and x.get("name"):
            purchase_out.append({
                "name": str(x.get("name", "")).strip(),
                "suggested_purchase": str(x.get("suggested_purchase", "")).strip() or str(x.get("name", "")).strip(),
            })

    return {"remove": remove, "likely_pantry": pantry_out, "purchase_items": purchase_out}


async def refine_shopping_list(items: list[dict[str, str]], pantry_names: list[str] | None = None) -> dict[str, Any]:
    """
    Call OpenAI to refine the list. Returns { remove, likely_pantry, purchase_items }.
    pantry_names: optional list of user's pantry staples to include in context; LLM decides contextually.
    On missing API key or parse failure, returns fallback (all items as purchase_items).
    """
    if not items:
        return {"remove": [], "likely_pantry": [], "purchase_items": []}

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        logger.info("OPENAI_API_KEY not set; returning fallback refine (no removal/pantry).")
        return _fallback_result(items)

    try:
        from openai import AsyncOpenAI
    except ModuleNotFoundError:
        logger.warning("openai not installed; returning fallback refine.")
        return _fallback_result(items)

    client = AsyncOpenAI(api_key=api_key)
    user_content = _build_user_prompt(items)
    system_prompt = _build_system_prompt(pantry_names or [])
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        )
        raw = response.choices[0].message.content or "{}"
    except Exception as e:
        logger.exception("OpenAI refine call failed: %s", e)
        return _fallback_result(items)

    return _parse_llm_refine_response(raw, items)
