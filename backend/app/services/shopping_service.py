"""Exact shopping totals and explicitly marked, ingredient-specific purchase estimates."""
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, localcontext
from fractions import Fraction

from app.models import ShoppingListItem, ShoppingSourceItem


_VULGAR_FRACTIONS = {
    "¼": "1/4", "½": "1/2", "¾": "3/4", "⅐": "1/7", "⅑": "1/9",
    "⅒": "1/10", "⅓": "1/3", "⅔": "2/3", "⅕": "1/5", "⅖": "2/5",
    "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6", "⅛": "1/8",
    "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
}
_CHINESE_DIGITS = dict(zip("零〇一二三四五六七八九两", (0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 2)))
_NUMBER = re.compile(r"^(?P<number>(?:\d+\s+)?\d+\s*/\s*\d+|(?:\d+(?:\.\d+)?|\.\d+)|[零〇一二三四五六七八九十百千两]+|半)(?P<unit>.*)$")


def _normalize_text(text: str) -> str:
    # Do this before NFKC: otherwise 1½ becomes the incorrect fraction 11/2.
    text = re.sub(r"[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]", lambda m: " " + _VULGAR_FRACTIONS[m[0]], text)
    text = unicodedata.normalize("NFKC", text).replace("⁄", "/")
    text = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _chinese_number(text: str) -> Fraction:
    if text == "半":
        return Fraction(1, 2)
    # 两三根 is an imprecise "two or three", not three. Reject digit sequences
    # and malformed scale sequences rather than guessing what an import meant.
    if len(text) > 1 and not re.fullmatch(r"(?:[一二三四五六七八九两]千)?(?:[零〇]?[一二三四五六七八九两]百)?(?:[零〇]?[一二三四五六七八九两]?十)?[零〇一二三四五六七八九两]?", text):
        raise ValueError("Ambiguous Chinese number")
    total = digit = 0
    for char in text:
        if char in _CHINESE_DIGITS:
            digit = _CHINESE_DIGITS[char]
        else:
            total += (digit or 1) * {"十": 10, "百": 100, "千": 1000}[char]
            digit = 0
    return Fraction(total + digit)


def parse_quantity(qty: str) -> tuple[Fraction, str] | None:
    """Parse one complete numeric amount, including fractions, without float loss.

    A suffix containing another number or expression is not a unit. In particular,
    ``4个3克`` and ranges must never be partially parsed as 4 of a fictitious unit.
    """
    text = _normalize_text(qty or "")
    if text == "一半":
        return Fraction(1, 2), ""
    match = _NUMBER.fullmatch(text)
    if not match:
        return None
    number, unit = match.group("number", "unit")
    unit = unit.strip()
    half_after_unit = unit.endswith("半")
    if half_after_unit:
        unit = unit[:-1].strip()
        if not unit or number == "半":
            return None
    if unit and (
        not re.fullmatch(r"[A-Za-z\u3400-\u9fff]+(?:[ -][A-Za-z\u3400-\u9fff]+)*", unit)
        or re.search(r"\b(?:or|to|per|each)\b", unit, re.I)
        or re.search(r"[几多余来许]|左右", unit)
        or (unit.casefold() not in _UNITS and unit != "两" and re.search(r"[零〇一二三四五六七八九十百千两半]", unit))
    ):
        return None
    try:
        if number[0] in _CHINESE_DIGITS or number[0] in "十百千半":
            amount = _chinese_number(number)
        elif "/" in number:
            clean = re.sub(r"\s*/\s*", "/", number)
            parts = clean.split()
            amount = sum((Fraction(part) for part in parts), Fraction())
        else:
            amount = Fraction(number)
        if half_after_unit:
            amount += Fraction(1, 2)
    except (ValueError, ZeroDivisionError):
        return None
    return amount, unit


@dataclass(frozen=True)
class _Unit:
    family: str
    factor: Fraction
    label: str


_UNITS: dict[str, _Unit] = {}


def _register_units(family: str, factor: str, aliases: dict[str, str]) -> None:
    for alias, label in aliases.items():
        _UNITS[alias.casefold()] = _Unit(family, Fraction(factor), label)


_register_units("mass", "1", {"g": "g", "gram": "g", "grams": "g", "克": "克", "公克": "克"})
_register_units("mass", "1000", {"kg": "kg", "kilogram": "kg", "kilograms": "kg", "千克": "千克", "公斤": "公斤"})
_register_units("mass", "1/1000", {"mg": "mg", "milligram": "mg", "milligrams": "mg", "毫克": "毫克"})
_register_units("mass", "453.59237", {"lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb", "磅": "磅"})
_register_units("mass", "28.349523125", {"oz": "oz", "ounce": "oz", "ounces": "oz", "盎司": "盎司"})
_register_units("volume", "1", {"ml": "ml", "milliliter": "ml", "milliliters": "ml", "millilitre": "ml", "millilitres": "ml", "毫升": "毫升"})
_register_units("volume", "1000", {"l": "l", "liter": "l", "liters": "l", "litre": "l", "litres": "l", "升": "升"})
# Recipe measuring spoons use the metric kitchen convention: 5 ml / 15 ml.
# Cups, bowls, ladles, pinches, and ordinary spoons vary and stay separate.
_register_units("volume", "5", {"tsp": "tsp", "teaspoon": "tsp", "teaspoons": "tsp", "茶匙": "茶匙", "小勺": "小勺", "小匙": "小匙"})
_register_units("volume", "15", {"tbsp": "tbsp", "tablespoon": "tbsp", "tablespoons": "tbsp", "汤匙": "汤匙", "大勺": "大勺", "大匙": "大匙"})
_register_units("cup", "1", {"cup": "cup", "cups": "cup", "杯": "杯"})
for _singular, _plural in (("clove", "cloves"), ("piece", "pieces"), ("can", "cans"), ("bag", "bags"), ("bunch", "bunches"), ("egg", "eggs")):
    _register_units(_singular, "1", {_singular: _singular, _plural: _singular})

# Qualifiers are part of the aggregation key: a bound never becomes an exact total.
_QUALIFIERS = (
    (r"^(?:approximately|approx\.?|about|around)\s*", "approx", "about "),
    (r"^(?:大约|约|大概|~|≈)\s*", "approx", "约"),
    (r"^(?:less than|under)\s*", "less", "less than "),
    (r"^(?:少于|不足|不到|<(?![=]))\s*", "less", "少于"),
    (r"^(?:at most|up to)\s*", "at_most", "at most "),
    (r"^(?:至多|最多|不超过|<=|≤)\s*", "at_most", "至多"),
    (r"^(?:more than|over)\s*", "more", "more than "),
    (r"^(?:超过|多于|>(?![=]))\s*", "more", "多于"),
    (r"^at least\s*", "at_least", "at least "),
    (r"^(?:至少|不少于|>=|≥)\s*", "at_least", "至少"),
)


@dataclass
class _Measure:
    amount: Fraction
    unit: _Unit
    qualifier: str = ""
    prefix: str = ""


def _parse_measure(text: str) -> _Measure | None:
    text = _normalize_text(text)
    qualifier = prefix = ""
    for pattern, kind, label in _QUALIFIERS:
        match = re.match(pattern, text, re.I)
        if match:
            qualifier, prefix, text = kind, label, text[match.end():]
            break
    parsed = parse_quantity(text)
    if parsed is None:
        return None
    amount, unit = parsed
    normalized = unit.casefold()
    return _Measure(amount, _UNITS.get(normalized, _Unit(f"unit:{normalized}", Fraction(1), unit)), qualifier, prefix)


_COUNT_UNITS = frozenset({
    "个", "根", "只", "块", "片", "颗", "粒", "条", "朵", "袋", "包", "瓶", "罐", "把", "小把", "汤勺",
    "clove", "piece", "can", "bag", "bunch", "egg",
})


def _parse_adjacent_measures(text: str) -> tuple[_Measure, _Measure] | None:
    """Recognize imported equivalent measurements such as ``半杯 160克``.

    Only a known count/volume followed by one complete mass measurement qualifies.
    Per-piece quantities, multiplication, ranges, and unrelated suffixes remain
    opaque instead of being silently treated as equivalent amounts.
    """
    if re.search(r"每|\b(?:each|per)\b|[×*]", text, re.I):
        return None
    for index in range(1, len(text)):
        first = _parse_measure(text[:index])
        if first is None or not (
            first.unit.family in {"volume", "cup"} or first.unit.label in _COUNT_UNITS
        ):
            continue
        second = _parse_measure(text[index:])
        if second is not None and second.unit.family == "mass":
            return first, second
    return None


def _contains_amount(text: str) -> bool:
    return bool(re.search(r"[0-9半一二三四五六七八九十百千两]", text))


def _split_amounts(text: str) -> list[str]:
    """Split additive totals/notes, keeping parentheses and alternate units intact."""
    parts, start, depth = [], 0, 0
    for index, char in enumerate(text):
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        elif depth == 0 and char in ";,+":
            # A decimal comma or incomplete numeric expression is not a reliable
            # separator. Thousands separators have already been normalized.
            if char == "," and text[:index].rstrip()[-1:].isdigit() and text[index + 1:].lstrip()[:1].isdigit():
                continue
            if text[start:index].strip():
                parts.append(text[start:index].strip())
            start = index + 1
    if text[start:].strip():
        parts.append(text[start:].strip())
    return parts


def _format_number(value: Fraction) -> str:
    if value.denominator == 1:
        return str(value.numerator)
    remainder = value.denominator
    for divisor in (2, 5):
        while remainder % divisor == 0:
            remainder //= divisor
    if remainder == 1:
        with localcontext() as context:
            context.prec = max(32, len(str(value.numerator)) + len(str(value.denominator)) + 2)
            result = format(Decimal(value.numerator) / Decimal(value.denominator), "f")
        return result.rstrip("0").rstrip(".")
    whole, numerator = divmod(value.numerator, value.denominator)
    fraction = f"{numerator}/{value.denominator}"
    return f"{whole} {fraction}" if whole else fraction


def _sum_measures(measures: list[_Measure]) -> str:
    first = measures[0]
    output_unit = first.unit
    # Mixed scales use a common base, avoiding awkward fractions of kg or litres.
    if any(measure.unit.factor != output_unit.factor for measure in measures):
        output_unit = _Unit(first.unit.family, Fraction(1), {"mass": "g", "volume": "ml"}[first.unit.family])
    total = sum((measure.amount * measure.unit.factor for measure in measures), Fraction()) / output_unit.factor
    return f"{first.prefix}{_format_number(total)} {output_unit.label}".strip()


def aggregate_quantities(quantities: list[str]) -> str:
    """Sum compatible amounts exactly and retain uncertain information explicitly.

    Parenthetical alternate measures are summed in parallel, never added to the
    primary amount. Different annotations remain separate to avoid implying that
    a partial alternate measurement describes the entire total. Uninterpretable
    numeric expressions retain their occurrence count; vague notes are deduplicated.
    The output can safely pass through this function again during smart refinement.
    """
    measures: list[tuple[_Measure, _Measure | None, str]] = []
    unparsed: dict[str, tuple[str, int, bool]] = {}
    for raw in quantities:
        for text in _split_amounts(_normalize_text(raw or "")):
            primary_text, annotation = text, ""
            parenthetical = re.fullmatch(r"(.+?)\s*\(([^()]*)\)", text)
            if parenthetical:
                primary_text, annotation = parenthetical.groups()
            primary = _parse_measure(primary_text)
            alternate = _parse_measure(annotation) if annotation else None
            if primary is None and not annotation:
                adjacent = _parse_adjacent_measures(text)
                if adjacent is not None:
                    primary, alternate = adjacent
            if annotation and alternate is None and _contains_amount(annotation) and not re.search(
                r"/\s*[A-Za-z\u3400-\u9fff]+$|\b(?:per|each)\b|每", annotation, re.I,
            ):
                # Unknown numeric notes could themselves be alternate amounts.
                # Do not sum the primary while leaving a misleading fixed note.
                primary = None
            if primary is not None:
                measures.append((primary, alternate, annotation))
                continue
            repetitions = 1
            counted = re.fullmatch(r"(\d+) × \((.+)\)", text)
            if counted:
                repetitions, text = int(counted[1]), counted[2]
            # Chinese numeric compounds also need multiplicity; 几颗/适量 stay vague.
            has_amount = _contains_amount(text)
            key = text.casefold()
            previous = unparsed.get(key)
            unparsed[key] = (previous[0] if previous else text, (previous[1] if previous else 0) + repetitions, has_amount)
    # An explicit alternate may be the shared measure needed for a complete total:
    # 4g (0.5 tsp) + 2 tsp = 2.5 tsp. We use the recorded equivalent, never derive
    # a density. Different qualifiers must remain visible (e.g. less than 1g).
    standalone = {(primary.unit.family, primary.qualifier) for primary, alternate, note in measures if alternate is None and not note}
    grouped: dict[tuple, list[tuple[_Measure, _Measure | None, str]]] = defaultdict(list)
    for primary, alternate, annotation in measures:
        if alternate is not None and primary.qualifier == alternate.qualifier:
            if (primary.unit.family, primary.qualifier) in standalone:
                alternate, annotation = None, ""
            elif (alternate.unit.family, alternate.qualifier) in standalone:
                primary, alternate, annotation = alternate, None, ""
        key = (
            primary.unit.family, primary.qualifier,
            (alternate.unit.family, alternate.qualifier) if alternate else None,
            annotation.casefold() if alternate is None else "",
        )
        grouped[key].append((primary, alternate, annotation))
    parts = []
    for rows in grouped.values():
        primary = _sum_measures([row[0] for row in rows])
        alternates = [row[1] for row in rows if row[1] is not None]
        annotation = _sum_measures(alternates) if alternates else rows[0][2]
        parts.append(f"{primary} ({annotation})" if annotation else primary)
    for text, repetitions, has_amount in unparsed.values():
        parts.append(f"{repetitions} × ({text})" if has_amount and repetitions > 1 else text)
    return "; ".join(parts)


# Exact shopping synonyms only. Distinct sauces, flavored oils, and modifiers
# stay separate; this is not substring or model-based ingredient matching.
_PURCHASE_NAME_ALIASES = {
    "蒜": "大蒜", "姜": "生姜",
    "食用盐": "盐",
    "生抽酱油": "生抽", "鲜味生抽": "生抽",
    "老抽酱油": "老抽",
    "油": "食用油", "植物油": "食用油",
}


# These estimates apply only to explicitly named ingredients, never as a generic
# milliliters-to-grams conversion. The exact aggregator above does not use them.
# Salt/sugar/flour: https://www.kingarthurbaking.com/learn/ingredient-weight-chart
# Oil: https://crisco.com/products/pure-vegetable-oil/
# Oyster sauce: https://kikkomanusa.com/products/oyster-sauce/
# Soy sauce: https://uk.lkk.com/products/premium-light-soy-sauce and
# https://uk.lkk.com/products/premium-dark-soy-sauce (about 5 g per teaspoon).
_GRAMS_PER_TABLESPOON = {
    **dict.fromkeys(("salt", "table salt", "盐", "食盐", "精盐"), Fraction(18)),
    **dict.fromkeys(("sugar", "white sugar", "granulated sugar", "白糖", "白砂糖"), Fraction(198, 16)),
    **dict.fromkeys(("all-purpose flour", "all purpose flour", "ap flour", "中筋面粉", "普通面粉"), Fraction(120, 16)),
    **dict.fromkeys(("oil", "vegetable oil", "cooking oil", "油", "植物油", "食用油"), Fraction(14)),
    **dict.fromkeys(("soy sauce", "light soy sauce", "dark soy sauce", "酱油", "生抽", "生抽酱油", "老抽", "老抽酱油"), Fraction(15)),
    **dict.fromkeys(("oyster sauce", "蚝油", "蠔油"), Fraction(19)),
}
# Raw garlic: 1 clove = 3 g. Use only to reconcile cloves with a recorded weight.
# https://food-nutrition.canada.ca/cnf-fce/serving-portion?id=2394
_GRAMS_PER_PIECE = {
    name: {"瓣": Fraction(3), "clove": Fraction(3)}
    for name in ("大蒜", "蒜", "garlic")
}
_PURCHASE_UNITS = {
    "茶勺": _Unit("volume", Fraction(5), "茶勺"),
    "汤勺": _Unit("volume", Fraction(15), "汤勺"),
    "tbs": _Unit("volume", Fraction(15), "tbsp"),
    "量杯": _Unit("cup", Fraction(1), "杯"),
}
_PURCHASE_COUNTS = frozenset({"piece", "pieces", "pc", "pcs", "each", "count", "ct", "个", "枚", "只", "颗"})
_METRIC_UNITS = frozenset(alias for alias, unit in _UNITS.items() if unit.family in {"mass", "volume"} and unit.label in {"g", "kg", "mg", "克", "公克", "千克", "公斤", "毫克", "ml", "l", "毫升", "升"})
_VAGUE_PURCHASE_AMOUNTS = frozenset({"适量", "少许", "少量", "酌量", "按需", "to taste", "as needed", "a little", "some", "plus more to taste", "另按口味添加"})
_SPOON_ASSUMPTIONS = ("(按每勺1汤匙估算)", " (assuming 1 tablespoon per spoon)")


def preferred_shopping_quantity(quantity: str, metric_quantity: str | None) -> str:
    """Use a saved equivalent only for a complete, nonmetric original measurement."""
    original, metric = (quantity or "").strip(), (metric_quantity or "").strip()
    source, equivalent = parse_quantity(original), parse_quantity(metric)
    if source and equivalent and source[0] > 0 and equivalent[0] > 0:
        source_unit, metric_unit = source[1].casefold(), equivalent[1].casefold()
        known_source = source_unit in _UNITS or source_unit in _PURCHASE_UNITS or source_unit in _PURCHASE_COUNTS
        if known_source and source_unit not in _METRIC_UNITS and metric_unit in _METRIC_UNITS:
            return metric
    return original


def _explicit_purchase_mass(text: str) -> str:
    """Prefer a recorded mass equivalent over an ingredient density estimate."""
    parenthetical = re.fullmatch(r"(.+?)\s*\(([^()]*)\)", text)
    pair = (
        tuple(_parse_measure(part) for part in parenthetical.groups())
        if parenthetical else _parse_adjacent_measures(text)
    )
    if pair and all(pair):
        primary, alternate = pair
        if primary.qualifier == alternate.qualifier and primary.qualifier in {"", "approx"}:
            for measure in pair:
                if measure.unit.family == "mass":
                    return _sum_measures([measure])
    return text


def _format_purchase_estimate(value: Fraction) -> str:
    with localcontext() as context:
        context.prec = max(32, len(str(value.numerator)) + len(str(value.denominator)) + 2)
        decimal = Decimal(value.numerator) / Decimal(value.denominator)
        result = format(decimal, ".1f" if value >= 1 else ".6f")
    return result.rstrip("0").rstrip(".")


def normalize_purchase_quantity(name: str, quantity: str) -> str:
    """Consolidate purchase amounts with concise, explicitly approximate totals.

    Recorded equivalents take precedence. Bounds, ranges, unknown densities and
    numeric annotations keep the exact parser's conservative behavior.
    """
    chinese = bool(re.search(r"[\u3400-\u9fff]", name or ""))
    name = (name or "").strip()
    key = _PURCHASE_NAME_ALIASES.get(name, name).casefold()
    density = _GRAMS_PER_TABLESPOON.get(key)
    piece_weights = _GRAMS_PER_PIECE.get(key, {})
    inputs: list[str] = []
    vague = False
    for text in _split_amounts(_normalize_text(quantity or "")):
        if text.casefold() in _VAGUE_PURCHASE_AMOUNTS:
            vague = True
            continue
        for note in _SPOON_ASSUMPTIONS:
            if density is not None and text.endswith(note):
                text = text[:-len(note)].strip()
                break
        inputs.append(_explicit_purchase_mass(text) if density is not None or piece_weights else text)

    groups: dict[str, list[_Measure]] = defaultdict(list)
    approximate: set[str] = set()
    retained: list[str] = []
    parts = _split_amounts(aggregate_quantities(inputs))
    has_mass = bool(piece_weights) and any(
        (measure := _parse_measure(text)) is not None
        and measure.unit.family == "mass" and measure.qualifier in {"", "approx"}
        for text in parts
    )
    for text in parts:
        measure = _parse_measure(text)
        if measure is None or measure.qualifier not in {"", "approx"}:
            if chinese:
                text = text.replace(" (单位待确认)", "（单位待确认）").replace("(单位待确认)", "（单位待确认）")
            retained.append(text)
            continue
        unit = _PURCHASE_UNITS.get(measure.unit.label.casefold(), measure.unit)
        estimated = measure.qualifier == "approx"
        if density is not None and unit.label in {"勺", "平勺"}:
            unit = _Unit("volume", Fraction(15), "tbsp")
        amount = measure.amount
        if has_mass and unit.label.casefold() in piece_weights:
            amount *= piece_weights[unit.label.casefold()]
            unit = _Unit("mass", Fraction(1), "g")
            estimated = True
        elif density is not None and unit.family in {"volume", "cup"}:
            # Metric kitchen spoons stay 5 / 15 ml. The ingredient weight chart
            # defines a cup as 16 tablespoons for these purchase estimates.
            amount *= density * (unit.factor / 15 if unit.family == "volume" else 16)
            unit = _Unit("mass", Fraction(1), "g")
            estimated = True
        elif unit.family == "mass":
            amount *= unit.factor
            unit = _Unit("mass", Fraction(1), "g")
        elif unit.label.casefold() in _PURCHASE_COUNTS:
            unit = _Unit("count", Fraction(1), "个" if chinese else "pieces")
        groups[unit.family].append(_Measure(amount, unit))
        if estimated:
            approximate.add(unit.family)

    # A bare number can join explicit pieces, but never acquires a weight/volume.
    if "unit:" in groups and set(groups) <= {"unit:", "count"} and "count" in groups:
        count_unit = groups["count"][0].unit
        groups["count"].extend(_Measure(row.amount, count_unit) for row in groups.pop("unit:"))
        if "unit:" in approximate:
            approximate.add("count")
    missing = groups.pop("unit:") if "unit:" in groups and (len(groups) > 1 or density is not None) else []
    parts = []
    for family, rows in groups.items():
        unit = rows[0].unit
        if any(row.unit.factor != unit.factor for row in rows):
            unit = _Unit(family, Fraction(1), {"mass": "g", "volume": "ml"}[family])
        total = sum((row.amount * row.unit.factor for row in rows), Fraction()) / unit.factor
        number = _format_purchase_estimate(total) if family in approximate else _format_number(total)
        part = f"{number} {unit.label}".strip()
        parts.append((("约 " if chinese else "about ") if family in approximate else "") + part)
    result = " + ".join(parts)
    if missing:
        number = _format_number(sum((row.amount for row in missing), Fraction()))
        retained.append(f"{number}（单位待确认）" if chinese else f"{number} (unit missing)")
    if vague and not result and not retained:
        result = "适量" if chinese else "to taste"
    return ("；" if chinese else "; ").join(filter(None, [result, *retained]))


def aggregate_ingredients(
    ingredients: list[tuple[str, str]],
    *,
    for_purchase: bool = False,
    include_sources: bool = False,
) -> list[ShoppingListItem]:
    """
    Group by ingredient name (case-insensitive), aggregate quantities per group.
    ingredients: list of (name, quantity).
    """
    by_key: dict[str, list[tuple[str, str]]] = defaultdict(list)
    sources_by_key: dict[str, list[ShoppingSourceItem]] = defaultdict(list)
    for name, qty in ingredients:
        name = (name or "").strip()
        if not name:
            continue
        source_name = name
        if for_purchase:
            name = _PURCHASE_NAME_ALIASES.get(name, name)
        key = name.casefold()
        if include_sources:
            sources_by_key[key].append(ShoppingSourceItem(name=source_name, quantity=qty or ""))
        if for_purchase and (key in _GRAMS_PER_TABLESPOON or key in _GRAMS_PER_PIECE):
            # Keep recorded weights before the exact aggregator can select a
            # shared volume equivalent across different recipe contributions.
            qty = "; ".join(_explicit_purchase_mass(part) for part in _split_amounts(_normalize_text(qty or "")))
        by_key[key].append((name, qty))
    out: list[ShoppingListItem] = []
    for key, pairs in sorted(by_key.items()):
        display_name = pairs[0][0] if pairs else key
        quantities = [q for _, q in pairs if q]
        total_quantity = aggregate_quantities(quantities)
        out.append(ShoppingListItem(
            name=display_name, total_quantity=total_quantity,
            source_items=sources_by_key[key] if include_sources else None,
        ))
    return out
