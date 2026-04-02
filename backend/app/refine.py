"""
Generate a structured grocery shopping list from aggregated ingredients using LLM.
"""
import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

GROCERY_CATEGORIES = (
    "Produce",
    "Dairy",
    "Meat & Seafood",
    "Pantry & Dry Goods",
    "Frozen",
    "Bakery",
    "Other",
)


def _normalize_grocery_category(raw: str | None) -> str:
    """Map LLM output to allowed categories; unknown → Other."""
    s = (raw or "").strip()
    if not s:
        return "Other"
    for c in GROCERY_CATEGORIES:
        if s.lower() == c.lower():
            return c
    return "Other"


def _build_system_prompt() -> str:
    return """You are generating a grocery shopping list for a week of cooking.
These ingredients come from multiple recipes and have already been aggregated.

Your task is to generate a clean, practical shopping list a real person would use.

Rules:
1) Do NOT remove any ingredients.
2) Do NOT ignore pantry items (salt, oil, sugar, sauces, spices, etc.).
3) Every input ingredient MUST appear in output purchase_items.
4) Normalize ingredient names into clear grocery items.
5) If an ingredient is Chinese:
   - Keep it in Chinese
   - Optionally include English in parentheses
   - Example: 八角 (star anise), 牛腱肉 (beef shank)
   - Do NOT translate away the Chinese
6) Convert quantities into realistic purchase units.
7) Assign EVERY item to exactly one grocery category from:
   Produce, Dairy, Meat & Seafood, Pantry & Dry Goods, Frozen, Bakery, Other

Category guidance examples:
- Produce:
  姜 (ginger), 蒜 (garlic), 洋葱 (onion), 青椒 (green pepper), 茄子 (eggplant)
- Meat & Seafood:
  牛腱肉 (beef shank), 鸡腿 (chicken drumstick), 五花肉 (pork belly), 虾 (shrimp)
- Pantry & Dry Goods:
  酱油 (soy sauce), 盐 (salt), 糖 (sugar), 花椒 (Sichuan peppercorn), 八角 (star anise), 干辣椒 (dried chili)
- Dairy:
  牛奶 (milk), 鸡蛋 (eggs), 黄油 (butter)

Return STRICT JSON only.
Do not include markdown.
Do not include prose outside JSON.

JSON format:
{
  "purchase_items": [
    { "name": string, "suggested_purchase": string, "grocery_category": string }
  ]
}

"grocery_category" must be exactly one of:
Produce, Dairy, Meat & Seafood, Pantry & Dry Goods, Frozen, Bakery, Other.
"""


def _build_user_prompt(items: list[dict[str, str]]) -> str:
    payload = [{"name": (i.get("name") or "").strip(), "quantity": (i.get("quantity") or "").strip()} for i in items]
    return (
        "This is a list of ingredients aggregated from multiple recipes for a weekly meal plan. "
        "Generate a clean grocery shopping list.\n\n"
        "Input ingredients JSON:\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )


def _fallback_result(items: list[dict[str, str]]) -> dict[str, Any]:
    out: list[dict[str, str]] = []
    for i in items:
        n = (i.get("name") or "").strip()
        if not n:
            continue
        out.append(
            {
                "name": n,
                "suggested_purchase": (i.get("quantity") or "").strip() or n,
                "grocery_category": "Other",
            }
        )
    return {"purchase_items": out}


def _parse_llm_refine_response(raw: str, fallback_items: list[dict[str, str]]) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        logger.warning("Refine LLM response JSON parse failed: %s", e)
        return _fallback_result(fallback_items)
    if not isinstance(data, dict):
        return _fallback_result(fallback_items)
    purchase_items = data.get("purchase_items")
    if not isinstance(purchase_items, list):
        return _fallback_result(fallback_items)
    purchase_out: list[dict[str, str]] = []
    for x in purchase_items:
        if not isinstance(x, dict):
            continue
        nm = str(x.get("name", "")).strip()
        if not nm:
            continue
        sp = str(x.get("suggested_purchase", "")).strip() or nm
        gc = x.get("grocery_category")
        purchase_out.append(
            {
                "name": nm,
                "suggested_purchase": sp,
                "grocery_category": _normalize_grocery_category(str(gc).strip() if gc is not None else None),
            }
        )
    if not purchase_out:
        return _fallback_result(fallback_items)
    return {"purchase_items": purchase_out}


async def refine_shopping_list(items: list[dict[str, str]], pantry_names: list[str] | None = None) -> dict[str, Any]:
    """Return ``{ "purchase_items": [...] }`` from aggregated ingredients. ``pantry_names`` is unused (call-site compatibility)."""
    _ = pantry_names

    if not items:
        return {"purchase_items": []}

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        logger.info("OPENAI_API_KEY not set; returning fallback refine.")
        return _fallback_result(items)

    try:
        from openai import AsyncOpenAI
    except ModuleNotFoundError:
        logger.warning("openai not installed; returning fallback refine.")
        return _fallback_result(items)

    client = AsyncOpenAI(api_key=api_key)
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _build_system_prompt()},
                {"role": "user", "content": _build_user_prompt(items)},
            ],
        )
        raw = response.choices[0].message.content or "{}"
    except Exception as e:
        logger.exception("OpenAI refine call failed: %s", e)
        return _fallback_result(items)

    return _parse_llm_refine_response(raw, items)
