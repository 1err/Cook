"""Conservative whole-name ingredient matching; shared with PostgreSQL expressions."""
import json
import re
import unicodedata
from pathlib import Path
from sqlalchemy import cast, func, literal, literal_column
from sqlalchemy.dialects.postgresql import JSONB

OPTIONS = json.loads(Path(__file__).with_suffix(".json").read_text())
ALIASES = {alias: item["id"] for item in OPTIONS for alias in item["aliases"]}
# Remove recorded preparation notes, not ingredient identities (stock/starch/oil).
NOTES = r"\s*[(（](sliced|chopped|minced|diced|grated|peeled|optional|to taste|切片|切丝|切块|切丁|剁碎|拍碎|去皮|去骨)[)）]\s*"
PREPARATION = r"^(fresh|chopped|minced|diced|sliced|grated|peeled|boneless|skinless) +"

def normalized_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).strip().lower()
    value = re.sub(NOTES, " ", value)
    for _ in range(3):value = re.sub(PREPARATION, "", value)
    return re.sub(r"\s+", " ", value).strip()

def canonical_ingredient(value: str) -> str:
    name=normalized_name(value)
    return ALIASES.get(name, name)

def canonical_sql(value):
    name=func.lower(func.trim(func.normalize(value,literal_column("NFKC"))))
    name=func.regexp_replace(name, NOTES, " ", "g")
    for _ in range(3):name=func.regexp_replace(name, PREPARATION, "")
    name=func.trim(func.regexp_replace(name,r"\s+"," ","g"))
    return func.coalesce(cast(literal(json.dumps(ALIASES)), JSONB).op("->>")(name), name)

def selected_ingredients(values):
    if len(values)>20:raise ValueError("Choose at most 20 ingredients")
    if any(not isinstance(v,str) or not v.strip() or len(v)>100 for v in values):
        raise ValueError("Ingredient names must contain 1 to 100 characters")
    names=sorted(set(canonical_ingredient(v) for v in values))
    if any(not name for name in names):raise ValueError("Ingredient name is empty")
    return names
