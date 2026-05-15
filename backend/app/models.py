"""Simple data models. No complex schemas."""
from typing import Optional

from pydantic import BaseModel, Field, field_validator

# Library tags (multiple allowed per recipe)
RECIPE_TAG_SLUGS = frozenset(
    {
        "chinese",
        "japanese",
        "korean",
        "thai",
        "italian",
        "american",
        "mexican",
        "indian",
        "mediterranean",
        "quick",
        "weeknight",
        "slow_cooked",
        "healthy",
        "high_protein",
        "low_carb",
        "vegetarian",
        "vegan",
        "gluten_free",
        "breakfast",
        "main_dish",
        "side",
        "soup",
        "noodles",
        "rice",
        "salad",
        "dessert",
        "spicy",
        "comfort_food",
        "light",
        "savory",
        "sweet",
    }
)

LEGACY_LIBRARY_CATEGORY_TO_TAG = {
    "quick_dinner": "quick",
    "under_30_min": "quick",
    "vegetarian": "vegetarian",
    "dessert": "dessert",
    "breakfast": "breakfast",
    "italian": "italian",
    "healthy": "healthy",
}


def coerce_library_category(v: Optional[str]) -> Optional[str]:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if not isinstance(v, str):
        raise ValueError("library_category must be a string or null")
    s = v.strip()
    if s in LEGACY_LIBRARY_CATEGORY_TO_TAG:
        return LEGACY_LIBRARY_CATEGORY_TO_TAG[s]
    if s not in RECIPE_TAG_SLUGS:
        raise ValueError(
            f"library_category must be one of: {', '.join(sorted(RECIPE_TAG_SLUGS))}"
        )
    return s


def coerce_library_tags(v: object) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        tag = coerce_library_category(v)
        return [tag] if tag else []
    if not isinstance(v, list):
        raise ValueError("library_tags must be a list of strings")
    out: list[str] = []
    seen: set[str] = set()
    for item in v:
        tag = coerce_library_category(item if isinstance(item, str) else None)
        if tag and tag not in seen:
            seen.add(tag)
            out.append(tag)
    return out


class IngredientItem(BaseModel):
    name: str
    quantity: str  # free text, e.g. "2 cups", "to taste"
    metric_quantity: Optional[str] = None
    notes: Optional[str] = None


class RecipeStep(BaseModel):
    text: str
    duration_seconds: Optional[int] = None
    image_url: Optional[str] = None

    @field_validator("text", mode="before")
    @classmethod
    def _trim_text(cls, v: object) -> str:
        if v is None:
            return ""
        if not isinstance(v, str):
            raise ValueError("step text must be a string")
        return v.strip()

    @field_validator("duration_seconds", mode="before")
    @classmethod
    def _nonneg_duration(cls, v: object) -> Optional[int]:
        if v is None or v == "":
            return None
        try:
            n = int(v)
        except (TypeError, ValueError):
            return None
        return n if n >= 0 else None

    @field_validator("image_url", mode="before")
    @classmethod
    def _trim_image_url(cls, v: object) -> Optional[str]:
        if v is None:
            return None
        if not isinstance(v, str):
            return None
        s = v.strip()
        return s or None


def coerce_steps(v: object) -> list["RecipeStep"]:
    if v is None:
        return []
    if not isinstance(v, list):
        raise ValueError("steps must be a list")
    out: list[RecipeStep] = []
    for item in v:
        if isinstance(item, RecipeStep):
            step = item
        elif isinstance(item, dict):
            step = RecipeStep(**item)
        elif isinstance(item, str):
            step = RecipeStep(text=item)
        else:
            continue
        if step.text:
            out.append(step)
    return out


def coerce_string_list(v: object) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        s = v.strip()
        return [s] if s else []
    if not isinstance(v, list):
        raise ValueError("expected a list of strings")
    seen: set[str] = set()
    out: list[str] = []
    for item in v:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def coerce_total_time_minutes(v: object) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


class RecipeCreate(BaseModel):
    title: str
    source_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    ingredients: list[IngredientItem]
    raw_extraction_text: Optional[str] = None
    library_tags: list[str] = Field(default_factory=list)
    library_category: Optional[str] = None
    is_public_catalog: bool = False
    catalog_source_recipe_id: Optional[str] = None

    @field_validator("library_tags", mode="before")
    @classmethod
    def normalize_tags(cls, v: object) -> list[str]:
        return coerce_library_tags(v)

    @field_validator("library_category", mode="before")
    @classmethod
    def normalize_category(cls, v: Optional[str]) -> Optional[str]:
        return coerce_library_category(v)


class Recipe(RecipeCreate):
    id: str


def _coerce_recipe_id_list(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, str):
            s = item.strip()
            if s:
                out.append(s)
    return out


def normalize_meal_plan_slots(raw: object) -> dict[str, list[str]]:
    """Normalize legacy recipe_ids arrays and new slot-based payloads."""
    if isinstance(raw, dict):
        if any(k in raw for k in ("breakfast", "lunch", "dinner")):
            return {
                "breakfast": _coerce_recipe_id_list(raw.get("breakfast")),
                "lunch": _coerce_recipe_id_list(raw.get("lunch")),
                "dinner": _coerce_recipe_id_list(raw.get("dinner")),
            }
        if "recipe_ids" in raw:
            return {
                "breakfast": [],
                "lunch": [],
                "dinner": _coerce_recipe_id_list(raw.get("recipe_ids")),
            }
    if isinstance(raw, list):
        return {"breakfast": [], "lunch": [], "dinner": _coerce_recipe_id_list(raw)}
    return {"breakfast": [], "lunch": [], "dinner": []}


class MealPlan(BaseModel):
    """One row per date. date is YYYY-MM-DD."""
    id: str  # same as date for simplicity
    date: str
    breakfast: list[str] = Field(default_factory=list)
    lunch: list[str] = Field(default_factory=list)
    dinner: list[str] = Field(default_factory=list)

    def all_recipe_ids(self) -> list[str]:
        return [*self.breakfast, *self.lunch, *self.dinner]


class ShoppingListItem(BaseModel):
    name: str
    total_quantity: str

