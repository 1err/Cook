"""
Shopping list refinement via LLM. Wraps app.refine; stateless, no DB.

API routes expect legacy ``remove`` / ``likely_pantry`` keys; core refine returns
``purchase_items`` only — this module adds empty placeholders for the HTTP contract.
"""
from app.refine import refine_shopping_list as _refine_core

__all__ = ["refine_shopping_list"]


async def refine_shopping_list(items: list[dict[str, str]], pantry_names: list[str] | None = None) -> dict:
    result = await _refine_core(items, pantry_names)
    return {
        **result,
        "remove": [],
        "likely_pantry": [],
    }
