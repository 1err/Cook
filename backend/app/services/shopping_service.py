"""
Aggregate ingredients from meal plans + recipes into a shopping list.
Quantities with same unit are summed; otherwise concatenated. No DB access.
"""
import re
from collections import defaultdict

from app.models import ShoppingListItem


def parse_quantity(qty: str) -> tuple[float, str] | None:
    """
    Parse a quantity string into (numeric_value, unit).
    E.g. "100g" -> (100.0, "g"), "1.5 cups" -> (1.5, "cups").
    Returns None if no leading number.
    """
    if not qty or not qty.strip():
        return None
    m = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(.*)$", qty.strip())
    if not m:
        return None
    try:
        num = float(m.group(1))
    except ValueError:
        return None
    unit = (m.group(2) or "").strip()
    return (num, unit)


def aggregate_quantities(quantities: list[str]) -> str:
    """
    Aggregate quantity strings: sum when same unit and numeric parse succeeds,
    otherwise concatenate. No unit conversion.
    """
    summed: dict[str, float] = defaultdict(float)
    unparsed: list[str] = []
    for q in quantities:
        if not q:
            continue
        parsed = parse_quantity(q)
        if parsed is not None:
            num, unit = parsed
            summed[unit] += num
        else:
            unparsed.append(q)
    parts: list[str] = []
    for unit in sorted(summed.keys()):
        total = summed[unit]
        if total == int(total):
            parts.append(f"{int(total)} {unit}".strip() if unit else str(int(total)))
        else:
            parts.append(f"{total} {unit}".strip() if unit else str(total))
    if unparsed:
        parts.append(", ".join(unparsed))
    return ", ".join(parts)


def aggregate_ingredients(
    ingredients: list[tuple[str, str]],
) -> list[ShoppingListItem]:
    """
    Group by ingredient name (case-insensitive), aggregate quantities per group.
    ingredients: list of (name, quantity).
    """
    by_key: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for name, qty in ingredients:
        key = (name or "").lower()
        by_key[key].append((name, qty))
    out: list[ShoppingListItem] = []
    for key, pairs in sorted(by_key.items()):
        display_name = pairs[0][0] if pairs else key
        quantities = [q for _, q in pairs if q]
        total_quantity = aggregate_quantities(quantities)
        out.append(ShoppingListItem(name=display_name, total_quantity=total_quantity))
    return out
