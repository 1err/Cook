"""Evidence checks for imported tutorials; provider judgments never bypass these gates."""
from __future__ import annotations

import math
import re

SOURCE_KINDS = frozenset({"captions", "description", "video", "media", "text"})
AUDIT_UNAVAILABLE = "The tutorial completeness check could not finish. Review the method against the source."
MISSING_METHOD = "The source did not provide a usable cooking method. Add the missing steps before cooking."


def source_kind(value: str) -> str:
    return value if value in SOURCE_KINDS else "text"


def source_seconds(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) and 0 <= value <= 86400 else None


def source_fields(record: dict) -> dict:
    """Keep only safe source metadata. Source positions are never cooking durations."""
    fields = {}
    provenance = record.get("instruction_source")
    if isinstance(provenance, str) and provenance in {"source", "suggested", "user"}:
        fields["instruction_source"] = provenance
    excerpt = record.get("source_excerpt")
    if isinstance(excerpt, str) and excerpt.strip():
        fields["source_excerpt"] = excerpt.strip()[:500]
    start = source_seconds(record.get("source_start_seconds"))
    end = source_seconds(record.get("source_end_seconds"))
    if start is not None:
        fields["source_start_seconds"] = start
    if end is not None and (start is None or end >= start):
        fields["source_end_seconds"] = end
    return fields


def _normalized_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def _has_evidence(record: dict, source_text: str, *, audiovisual: bool) -> bool:
    fields = source_fields(record)
    excerpt = fields.get("source_excerpt")
    if not excerpt:
        return False
    if audiovisual:
        # Visual observations are not verbatim text, but must locate the source.
        return fields.get("source_start_seconds") is not None
    return _normalized_text(excerpt) in _normalized_text(source_text)


# These checks identify common action mismatches; they are not a general semantic
# verifier. Unrecognized language/wording remains a useful but unverified draft.
_ACTION_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"\b(?:prepare|wash|rinse|clean|peel|trim)\b|准备|清洗|洗净|去皮",
    r"\b(?:slice|dice|chop|cut|mince|coupez|hachez|corta|corte)\b|切|剁",
    r"\b(?:heat|preheat|warm)\b|\b(?:lower|reduce)\b.{0,15}\bheat\b|热锅|烧热|降低火力",
    r"\b(?:fry|brown|sear|sauté|saute)\b|煎|炒|炸",
    r"\b(?:add|pour|put|place|return|ajoutez)\b|加入|放入|倒入|放回|加油",
    r"\b(?:transfer|move)\b|转入|盛入|移入|装入",
    r"\brender\b|煸出",
    r"\b(?:mix|stir|whisk|beat|fold|mélangez)\b|搅|拌|打散",
    r"\b(?:simmer|stew)\b|炖|焖|小火煮",
    r"\bboil\b|煮|煮沸",
    r"\b(?:bake|roast)\b|烤|焗",
    r"\bsteam\b|蒸",
    r"\b(?:rest|cool|stand|marinate|soak)\b|静置|冷却|腌|泡",
    r"\b(?:drain|strain)\b|沥|捞出|滤",
    r"\b(?:serve|garnish|plate|sprinkle)\b|撒|摆盘|上桌",
    r"\bseason\b|调味",
))
_CAPTION_LINE = re.compile(r"^\[s\d+ (?P<start>\d+(?:\.\d+)?)-(?P<end>\d+(?:\.\d+)?)s\]\s*(?P<text>[^\n]+)$", re.MULTILINE)
_INGREDIENT_HEADING = re.compile(r"\bingredients?\s*:|食材\s*[：:]|配料\s*[：:]", re.IGNORECASE)


def _action_groups(text: object) -> set[int]:
    if not isinstance(text, str):
        return set()
    # Narration/visual observations use inflected verbs (transfers, browned,
    # simmering); instructions usually use imperatives. Compare both forms.
    stems = []
    for word in re.findall(r"[A-Za-z]+", text.casefold()):
        for suffix in ("s", "ed", "ing"):
            if word.endswith(suffix) and len(word) > len(suffix) + 2:
                stem = word[:-len(suffix)]
                stems.extend((stem, stem + "e"))
                if len(stem) >= 2 and stem[-1] == stem[-2]:
                    stems.append(stem[:-1])
    searchable = text + " " + " ".join(stems)
    return {index for index, pattern in enumerate(_ACTION_PATTERNS) if pattern.search(searchable)}


def _procedure_supported(instruction: object, excerpt: str) -> bool:
    evidenced = _action_groups(excerpt)
    claimed = _action_groups(instruction)
    # This permits translations through shared cooking actions without demanding
    # exact instruction wording. It does not infer an action from an ingredient.
    return bool(evidenced and claimed and claimed <= evidenced
                and _numeric_claims(str(instruction)) <= _numeric_claims(excerpt))


_NUMBER_WORDS = dict(zip(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(),
    range(21),
))
_CHINESE_DIGITS = dict(zip("零一二两三四五六七八九", (0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9)))
_UNIT_GROUPS = (
    ("time", 1, ("seconds", "second", "secs", "sec", "s", "秒钟", "秒")),
    ("time", 60, ("minutes", "minute", "mins", "min", "分钟", "分")),
    ("time", 3600, ("hours", "hour", "hrs", "hr", "h", "小时")),
    ("mass", 1, ("grams", "gram", "g", "克")),
    ("mass", 1000, ("kilograms", "kilogram", "kg", "千克", "公斤")),
    ("volume", 1, ("milliliters", "milliliter", "ml", "毫升")),
    ("volume", 1000, ("liters", "liter", "l", "升")),
    ("celsius", 1, ("c", "celsius", "摄氏度", "℃")),
    ("fahrenheit", 1, ("f", "fahrenheit", "华氏度", "℉")),
)
_UNITS = {unit: (kind, scale) for kind, scale, units in _UNIT_GROUPS for unit in units}
_NUMBER_UNIT = re.compile(r"(?P<number>\d+(?:\.\d+)?)\s*(?:°\s*)?(?P<unit>" +
                          "|".join(re.escape(unit) + (r"(?![a-z])" if unit.isascii() else "")
                                   for unit in sorted(_UNITS, key=len, reverse=True)) + r")?", re.IGNORECASE)


def _numeric_claims(text: str) -> set[tuple[str, float]]:
    # Compare explicit amounts across common English/Chinese units. Caption
    # locations are not evidence for cooking times or ingredient quantities.
    text = re.sub(r"\[s\d+ \d+(?:\.\d+)?-\d+(?:\.\d+)?s\]", "", text.casefold())
    text = re.sub(r"\b(?:" + "|".join(_NUMBER_WORDS) + r")\b",
                  lambda match: str(_NUMBER_WORDS[match.group()]), text)

    def chinese_number(match: re.Match) -> str:
        total = current = 0
        for char in match.group():
            if char in _CHINESE_DIGITS:
                current = _CHINESE_DIGITS[char]
            else:
                total += (current or 1) * {"十": 10, "百": 100, "千": 1000}[char]
                current = 0
        return str(total + current)

    text = re.sub(r"[零一二两三四五六七八九十百千]+", chinese_number, text.replace("千克", "kg"))
    claims = set()
    for match in _NUMBER_UNIT.finditer(text):
        kind, scale = _UNITS.get(match.group("unit"), ("number", 1))
        claims.add((kind, float(match.group("number")) * scale))
    return claims


def _ingredient_aliases(ingredients: object) -> list[list[str]]:
    if not isinstance(ingredients, list):
        return []
    aliases = []
    for item in ingredients:
        name = item.get("name") if isinstance(item, dict) else item
        if isinstance(name, str):
            aliases.append([part.strip() for part in re.split(r"[()（）/]", name.casefold()) if part.strip()])
    return aliases


def _ingredients_supported(instruction: object, excerpt: str, aliases: list[list[str]]) -> bool:
    def mentions(text: str) -> set[int]:
        return {index for index, names in enumerate(aliases)
                if any(re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", text.casefold())
                       if name.isascii() else name in text.casefold() for name in names)}

    claimed, evidenced = mentions(str(instruction)), mentions(excerpt)
    # If the source uses another language without supplied aliases, retain the
    # translation. Only reject a substitution we can identify on both sides.
    return not claimed or not evidenced or claimed <= evidenced


def _ingredient_only_evidence(excerpt: str, source_text: str, ingredients: object) -> bool:
    clean = _normalized_text(excerpt).strip(" .,;:。；，：")
    if isinstance(ingredients, list):
        for item in ingredients:
            name = item.get("name") if isinstance(item, dict) else item
            if isinstance(name, str) and clean == _normalized_text(name):
                return True
    for line in source_text.splitlines():
        heading = _INGREDIENT_HEADING.search(line)
        if heading and clean and clean in _normalized_text(line[heading.end():]):
            return True
    return bool(_INGREDIENT_HEADING.search(source_text) and not _action_groups(source_text))


def _text_source_fields(record: dict, source_text: str) -> tuple[dict, list[str]]:
    """Derive caption locations from supplied segments, never model timestamps."""
    fields = source_fields(record)
    supplied = (fields.pop("source_start_seconds", None), fields.pop("source_end_seconds", None))
    excerpt = _normalized_text(fields.get("source_excerpt", ""))
    matches = []
    for match in _CAPTION_LINE.finditer(source_text):
        segment_text = _normalized_text(match.group("text"))
        if excerpt and excerpt in segment_text:
            start, end = float(match.group("start")), float(match.group("end"))
            if 0 <= start <= end <= 86400:
                matches.append((start, end))
    warnings = []
    if matches:
        # A repeated phrase requires review; do not guess a model-supplied distant
        # timestamp when no unique matching segment supports it.
        selected = supplied if supplied in matches else matches[0]
        fields.update(source_start_seconds=selected[0], source_end_seconds=selected[1])
        if supplied != (None, None) and supplied != selected:
            warnings.append("Source timestamps were corrected to match the actual caption segment.")
        if len(set(matches)) > 1 and supplied not in matches:
            warnings.append("This source excerpt appears in multiple caption segments; review its location.")
    elif supplied != (None, None):
        warnings.append("Unverified source timestamps were removed; this text has no matching caption segment.")
    return fields, warnings


def changed_required_actions(initial: list[dict], checked: list[dict]) -> bool:
    """A stable ID alone cannot turn a required action into an optional recap."""
    checked_by_id = {row["id"]: row for row in checked}
    for original in initial:
        replacement = checked_by_id.get(original["id"])
        if replacement is None or any(
            original.get(key) != replacement.get(key)
            for key in ("source_excerpt", "source_start_seconds", "source_end_seconds")
        ):
            return True
    return False


def action_inventory(payload: dict, source_text: str, *, audiovisual: bool) -> tuple[list[dict], list[str]]:
    rows = payload.get("actions")
    if not isinstance(rows, list):
        return [], ["The cooking action inventory is missing; check the tutorial for omitted actions."]
    actions, warnings, seen = [], [], set()
    ingredient_aliases = _ingredient_aliases(payload.get("ingredients"))
    for row in rows:
        if not isinstance(row, dict):
            warnings.append("Some cooking action evidence was invalid.")
            continue
        if row.get("role") in ("recap", "alternative"):
            continue
        action_id = row.get("id")
        if not isinstance(action_id, str) or not action_id.strip() or action_id in seen:
            warnings.append("Some cooking actions had missing or duplicate references.")
            continue
        seen.add(action_id)
        if not _has_evidence(row, source_text, audiovisual=audiovisual):
            warnings.append("Some cooking actions could not be matched to the source evidence.")
            continue
        excerpt = source_fields(row)["source_excerpt"]
        if not audiovisual and _ingredient_only_evidence(excerpt, source_text, payload.get("ingredients")):
            warnings.append("An ingredient name or list does not support a cooking instruction.")
            continue
        fields, location_warnings = (source_fields(row), []) if audiovisual else _text_source_fields(row, source_text)
        warnings.extend(location_warnings)
        uncertain = (not _procedure_supported(row.get("text"), excerpt)
                     or not _ingredients_supported(row.get("text"), excerpt, ingredient_aliases))
        if uncertain:
            warnings.append("Some action evidence does not clearly support the claimed procedure; review the source.")
        cleaned = {key: value for key, value in row.items()
                   if key not in {"source_start_seconds", "source_end_seconds", "source_excerpt", "instruction_source"}}
        actions.append({**cleaned, **fields, "_evidence_uncertain": uncertain,
                        "_ingredient_aliases": ingredient_aliases})
    evidence_order = [action.get("source_start_seconds") if audiovisual else
                      _normalized_text(source_text).find(_normalized_text(action["source_excerpt"]))
                      for action in actions]
    if evidence_order != sorted(evidence_order):
        warnings.append("The action inventory order does not match the source evidence sequence.")
    return actions, warnings


def ground_steps(steps: list[dict], actions: list[dict], source_text: str, *,
                 audiovisual: bool, require_evidence: bool) -> tuple[list[dict], list[str]]:
    """Resolve action IDs to persisted excerpts and audit source coverage and order."""
    by_id = {action["id"]: action for action in actions}
    positions = {action["id"]: index for index, action in enumerate(actions)}
    coverage: list[str] = []
    grounded, warnings = [], []
    for step in steps:
        refs = step.get("source_action_ids")
        refs = [ref for ref in refs if isinstance(ref, str)] if isinstance(refs, list) else []
        valid_refs = [ref for ref in refs if ref in by_id]
        supporting = [by_id[ref] for ref in valid_refs]
        if refs and len(valid_refs) != len(refs):
            warnings.append("Some steps refer to missing source evidence.")
        if (not supporting and _has_evidence(step, source_text, audiovisual=audiovisual)
                and (audiovisual or not _ingredient_only_evidence(source_fields(step)["source_excerpt"], source_text, None))
                and _procedure_supported(step.get("text"), source_fields(step)["source_excerpt"])):
            # Accept explicit evidence but require action coverage before calling it ready.
            fields, location_warnings = (source_fields(step), []) if audiovisual else _text_source_fields(step, source_text)
            supporting = [{**{key: value for key, value in step.items()
                              if key not in {"source_start_seconds", "source_end_seconds"}}, **fields}]
            warnings.extend(location_warnings)
            valid_refs = [action["id"] for action in actions
                          if action.get("source_excerpt") == step.get("source_excerpt")]
        cleaned = {key: value for key, value in step.items()
                   if key not in {"source_action_ids", "instruction_source", "source_excerpt",
                                  "source_start_seconds", "source_end_seconds"}}
        if supporting:
            excerpts = list(dict.fromkeys(item["source_excerpt"] for item in supporting))
            starts = [value for item in supporting
                      if (value := source_seconds(item.get("source_start_seconds"))) is not None]
            ends = [value for item in supporting
                    if (value := source_seconds(item.get("source_end_seconds"))) is not None]
            combined_excerpt = " | ".join(excerpts)
            uncertain = (any(item.get("_evidence_uncertain") for item in supporting)
                         or not _procedure_supported(step.get("text"), combined_excerpt)
                         or not _ingredients_supported(step.get("text"), combined_excerpt,
                                                       supporting[0].get("_ingredient_aliases", [])))
            if (cleaned.get("duration_source") == "stated" and cleaned.get("duration_seconds") is not None
                    and ("time", cleaned["duration_seconds"]) not in _numeric_claims(combined_excerpt)):
                cleaned.update(duration_seconds=None, duration_source="unknown")
                uncertain = True
                warnings.append("A cooking time was not stated in the cited source; its timer was cleared.")
            if uncertain:
                warnings.append("Some instruction wording is not clearly supported by its quoted actions; review the method.")
                cleaned["instruction_source"] = None
            else:
                cleaned.update(instruction_source="source", source_excerpt=combined_excerpt[:500])
                if starts:
                    cleaned["source_start_seconds"] = min(starts)
                if ends:
                    cleaned["source_end_seconds"] = max(ends)
            coverage.extend(valid_refs)
        else:
            warnings.append("Some instructions could not be verified against source evidence.")
            if require_evidence or refs or step.get("source_excerpt"):
                # Do not retain an invented first-pass method whose claimed
                # evidence was rejected. Older drafts without references can
                # still be retained as unverified when the audit fails.
                continue
            cleaned["instruction_source"] = None
        grounded.append(cleaned)
    if actions and set(by_id) - set(coverage):
        warnings.append("The tutorial is missing one or more cooking actions from the source.")
    order = [positions[ref] for ref in coverage]
    if order != sorted(order):
        warnings.append("The tutorial order does not match the source action sequence.")
    if len(coverage) != len(set(coverage)):
        warnings.append("The tutorial repeats a source action; check for duplicate recap steps.")
    if grounded and not actions:
        warnings.append("The cooking action inventory is missing; check the tutorial for omitted actions.")
    return grounded, warnings


def valid_audit(payload: dict | None) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("steps"), list):
        return False
    audit = payload.get("audit")
    return bool(isinstance(audit, dict)
                and all(isinstance(audit.get(key), bool)
                        for key in ("complete", "order_valid", "method_available"))
                and all(isinstance(audit.get(key), list)
                        for key in ("missing_action_ids", "unsupported_step_ids", "warnings")))


def audit_warnings(payload: dict) -> list[str]:
    audit = payload["audit"]
    warnings = [value.strip()[:500] for value in audit["warnings"]
                if isinstance(value, str) and value.strip()]
    if not audit["complete"] or audit["missing_action_ids"]:
        warnings.append("The completeness check found unresolved missing cooking actions.")
    if not audit["order_valid"]:
        warnings.append("The cooking sequence still needs review against the source.")
    if audit["unsupported_step_ids"]:
        warnings.append("The completeness check found unsupported instructions; verify the method.")
    return warnings


def review_result(steps: list[dict], warnings: list[str], *, kind: str, audited: bool) -> dict:
    if not steps:
        warnings.append(MISSING_METHOD)
    if not audited:
        warnings.append(AUDIT_UNAVAILABLE)
    warnings = list(dict.fromkeys(warnings))[:20]
    return {"status": "needs_review" if warnings else "ready", "warnings": warnings,
            "source_kind": source_kind(kind), "can_analyze_video": False}
