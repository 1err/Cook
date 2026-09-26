"""
Organize a grocery list with LLM name/category cleanup and exact quantity totals.
"""
import json
import logging
import re
from collections import Counter
from typing import Any

from app.core.llm import complete_chat, get_openai_client
from app.services.shopping_service import aggregate_ingredients, normalize_purchase_quantity

logger = logging.getLogger(__name__)

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z]")

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
These ingredients come from multiple recipes. Their quantities have already
been aggregated deterministically; the supplied quantity is authoritative.

Your task is to generate a clean, practical shopping list a real person would use.

Rules:
1) Do NOT remove any ingredients.
2) Do NOT ignore pantry items (salt, oil, sugar, sauces, spices, etc.).
3) Every input ingredient MUST appear exactly once in output purchase_items.
   Set source_name to the exact input name so the result can be matched safely.
   Do not merge different input ingredients or add ingredients.
4) Normalize ingredient names into clear grocery items.
5) Preserve the input ingredient language:
   - If the input ingredient name is Chinese, output a Chinese-only name.
   - If the input ingredient name is English, output an English-only name.
   - Never mix Chinese and English in the same item name.
   - Never add translations in parentheses.
6) Quantities are attached by the application. Do not return quantity fields.
   Do not invent purchase amounts, pack sizes, or numeric values for "as needed",
   "to taste", "适量", "少许", or other uncertain quantities.
   Preserve approximate totals marked "about"/"约", spoon assumptions, missing-unit
   notes, and extra-to-taste notes. Do not perform further unit conversions.
   Separate unsupported quantities remain separate.
   Parentheses may describe an equivalent measure, not another amount to add.
   Never count the same quantity twice or repeat an equivalent parenthetical amount.
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
    { "source_name": string, "name": string, "grocery_category": string }
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


def _aggregate_input_items(items: list[dict[str, str]]) -> list[dict[str, str]]:
    """Normalize at the API boundary too: clients can send unaggregated inputs."""
    ingredients = [
        (name, (item.get("quantity") or "").strip())
        for item in items
        if (name := (item.get("name") or "").strip())
    ]
    return [
        {"name": item.name, "quantity": normalize_purchase_quantity(item.name, item.total_quantity)}
        for item in aggregate_ingredients(ingredients, for_purchase=True)
    ]


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


def _contains_cjk(text: str) -> bool:
    return bool(_CJK_RE.search(text or ""))


def _contains_latin(text: str) -> bool:
    return bool(_LATIN_RE.search(text or ""))


def _normalize_name_for_match(name: str) -> str:
    normalized = (name or "").strip().lower()
    normalized = re.sub(r"\([^)]*\)", " ", normalized)
    normalized = re.sub(r"（[^）]*）", " ", normalized)
    normalized = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", normalized)
    return normalized


def _strip_mixed_language_name(name: str) -> str:
    value = (name or "").strip()
    if not value:
        return ""
    has_cjk = _contains_cjk(value)
    has_latin = _contains_latin(value)
    if has_cjk and has_latin:
        value = re.sub(r"\s*[\(（][^()（）]*[A-Za-z][^()（）]*[\)）]\s*", " ", value)
        value = re.sub(r"\s*[\-–—:/,]\s*[A-Za-z][A-Za-z\s'&-]*$", "", value)
    elif has_latin and not has_cjk:
        value = re.sub(r"\s*[\(（][^()（）]*[\u4e00-\u9fff][^()（）]*[\)）]\s*", " ", value)
        value = re.sub(r"\s*[\-–—:/,]\s*[\u4e00-\u9fff][\u4e00-\u9fff\s]*$", "", value)
    return re.sub(r"\s+", " ", value).strip(" -–—:/,")


def _build_input_language_map(items: list[dict[str, str]]) -> dict[str, str]:
    language_by_name: dict[str, str] = {}
    for item in items:
        raw_name = str(item.get("name") or "").strip()
        if not raw_name:
            continue
        language_by_name[_normalize_name_for_match(raw_name)] = "zh" if _contains_cjk(raw_name) else "en"
    return language_by_name


def _normalize_purchase_item_name(name: str, language_by_name: dict[str, str]) -> str:
    stripped = _strip_mixed_language_name(name)
    normalized_key = _normalize_name_for_match(stripped)
    preferred_language = language_by_name.get(normalized_key)
    if preferred_language == "zh" and _contains_cjk(stripped):
        stripped = re.sub(r"\s*[\(（][^()（）]*[A-Za-z][^()（）]*[\)）]\s*", " ", stripped)
    elif preferred_language == "en" and _contains_latin(stripped):
        stripped = re.sub(r"\s*[\(（][^()（）]*[\u4e00-\u9fff][^()（）]*[\)）]\s*", " ", stripped)
    return re.sub(r"\s+", " ", stripped).strip(" -–—:/,")


def _parse_llm_refine_response(raw: str, fallback_items: list[dict[str, str]]) -> dict[str, Any]:
    language_by_name = _build_input_language_map(fallback_items)
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
    # A source reference allows name cleanup without losing ingredients. Legacy
    # responses without source_name can still match an unambiguous input name.
    input_by_name = {item["name"].casefold(): item for item in fallback_items}
    input_names_by_match: dict[str, list[str]] = {}
    for name in input_by_name:
        input_names_by_match.setdefault(_normalize_name_for_match(name), []).append(name)
    refined_by_name: dict[str, dict[str, str]] = {}
    for x in purchase_items:
        if not isinstance(x, dict):
            continue
        raw_name = x.get("name")
        if not isinstance(raw_name, str):
            continue
        nm = _normalize_purchase_item_name(raw_name.strip(), language_by_name)
        if not nm:
            continue
        source_name = x.get("source_name", nm)
        if not isinstance(source_name, str):
            continue
        source_key = source_name.strip().casefold()
        if source_key not in input_by_name:
            matches = input_names_by_match.get(_normalize_name_for_match(source_key), [])
            if len(matches) != 1:
                continue
            source_key = matches[0]
        if source_key in refined_by_name:
            continue
        original = input_by_name[source_key]
        if _contains_cjk(original["name"]) != _contains_cjk(nm) or (
            _contains_cjk(original["name"]) and _contains_latin(nm)
        ):
            nm = original["name"]
        gc = x.get("grocery_category")
        refined_by_name[source_key] = {
            "name": nm,
            # The model organizes the list; deterministic arithmetic owns totals.
            "suggested_purchase": original["quantity"] or nm,
            "grocery_category": _normalize_grocery_category(gc if isinstance(gc, str) else None),
        }
    purchase_out = [
        refined_by_name.get(item["name"].casefold(), fallback)
        for item, fallback in zip(fallback_items, _fallback_result(fallback_items)["purchase_items"])
    ]
    # Keep every ingredient individually addressable by clients. Reserve each
    # source name first so restoring a duplicate cannot collide with another
    # model rename (for example pepper renamed to "salt (fine)").
    for source, purchase in zip(fallback_items, purchase_out):
        output_key = purchase["name"].casefold()
        if output_key in input_by_name and output_key != source["name"].casefold():
            purchase["name"] = source["name"]
            purchase["suggested_purchase"] = source["quantity"] or source["name"]
    name_counts = Counter(purchase["name"].casefold() for purchase in purchase_out)
    for source, purchase in zip(fallback_items, purchase_out):
        if name_counts[purchase["name"].casefold()] > 1:
            purchase["name"] = source["name"]
            purchase["suggested_purchase"] = source["quantity"] or source["name"]
    return {"purchase_items": purchase_out}


async def refine_shopping_list(items: list[dict[str, str]]) -> dict[str, Any]:
    """Return ``{ "purchase_items": [...] }`` from aggregated ingredients."""
    items = _aggregate_input_items(items)
    if not items:
        return {"purchase_items": []}

    client = get_openai_client()
    if client is None:
        logger.info("OPENAI_API_KEY not set; returning fallback refine.")
        return _fallback_result(items)

    try:
        raw = await complete_chat(
            client,
            operation="shopping_refine",
            json_object=True,
            messages=[
                {"role": "system", "content": _build_system_prompt()},
                {"role": "user", "content": _build_user_prompt(items)},
            ],
        )
    except Exception as e:
        logger.warning("Shopping refinement using normalized ingredients error_type=%s", type(e).__name__)
        return _fallback_result(items)

    return _parse_llm_refine_response(raw, items)
