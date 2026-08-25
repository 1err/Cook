"""Simple data models. No complex schemas."""
import math
from typing import Annotated, Optional

from pydantic import BaseModel, BeforeValidator, Field, field_validator, model_validator

from app.tutorial import normalize_step_payloads, parse_step_rows

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
    id: Optional[str] = None
    text: str
    duration_seconds: Optional[int] = None
    duration_source: Optional[str] = None
    attention_type: Optional[str] = None
    action_type: Optional[str] = None
    image_url: Optional[str] = None

    @field_validator("id", "duration_source", "attention_type", "action_type", mode="before")
    @classmethod
    def _coerce_metadata_to_string(cls, v: object) -> Optional[str]:
        if v is None or isinstance(v, str):
            return v
        return str(v)

    @field_validator("text", mode="before")
    @classmethod
    def _trim_text(cls, v: object) -> str:
        # Empty/None text is allowed at the model level; coerce_steps filters
        # out empty-text rows before persistence. Direct construction can yield "".
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
            return None  # field is Optional; non-string inputs are silently dropped
        s = v.strip()
        return s or None


def _parse_recipe_step_rows(v: object) -> list[dict[str, object]]:
    """Prepare legacy rows and existing models for nested Pydantic validation."""
    if isinstance(v, list):
        v = [
            item.model_dump(exclude_unset=True) if isinstance(item, RecipeStep) else item
            for item in v
        ]
    return parse_step_rows(v)


def coerce_steps(v: object, total_time_minutes: object = None) -> list[RecipeStep]:
    """Normalize complete recipe steps while preserving legacy field absence."""
    if v is None:
        return []
    if not isinstance(v, list):
        raise ValueError("steps must be a list")
    raw_steps = [
        item.model_dump(exclude_unset=True) if isinstance(item, RecipeStep) else item
        for item in v
    ]
    return [
        RecipeStep(**payload)
        for payload in normalize_step_payloads(raw_steps, total_time_minutes)
    ]


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
    description: Optional[str] = None
    total_time_minutes: Optional[int] = None
    steps: Annotated[list[RecipeStep], BeforeValidator(_parse_recipe_step_rows)] = Field(
        default_factory=list
    )
    tips: list[str] = Field(default_factory=list)
    equipment: list[str] = Field(default_factory=list)

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, v: object) -> Optional[str]:
        if v is None:
            return None
        if not isinstance(v, str):
            return None
        s = v.strip()
        return s or None

    @field_validator("total_time_minutes", mode="before")
    @classmethod
    def normalize_total_time(cls, v: object) -> Optional[int]:
        return coerce_total_time_minutes(v)

    @model_validator(mode="after")
    def normalize_steps(self) -> "RecipeCreate":
        self.steps = coerce_steps(self.steps, self.total_time_minutes)
        if self.total_time_minutes is None and self.steps:
            seconds = sum(step.duration_seconds or 0 for step in self.steps)
            self.total_time_minutes = math.ceil(seconds / 60)
        return self

    @field_validator("tips", mode="before")
    @classmethod
    def normalize_tips(cls, v: object) -> list[str]:
        return coerce_string_list(v)

    @field_validator("equipment", mode="before")
    @classmethod
    def normalize_equipment(cls, v: object) -> list[str]:
        return coerce_string_list(v)

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
