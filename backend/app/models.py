"""Simple data models. No complex schemas."""
from typing import Optional

from pydantic import BaseModel, field_validator

# Library filter chips (optional per recipe)
LIBRARY_CATEGORY_SLUGS = frozenset(
    {"quick_dinner", "vegetarian", "dessert", "breakfast", "italian", "healthy"}
)


def coerce_library_category(v: Optional[str]) -> Optional[str]:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if not isinstance(v, str):
        raise ValueError("library_category must be a string or null")
    s = v.strip()
    if s not in LIBRARY_CATEGORY_SLUGS:
        raise ValueError(
            f"library_category must be one of: {', '.join(sorted(LIBRARY_CATEGORY_SLUGS))}"
        )
    return s


class IngredientItem(BaseModel):
    name: str
    quantity: str  # free text, e.g. "2 cups", "to taste"
    notes: Optional[str] = None


class RecipeCreate(BaseModel):
    title: str
    source_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    ingredients: list[IngredientItem]
    raw_extraction_text: Optional[str] = None
    library_category: Optional[str] = None

    @field_validator("library_category", mode="before")
    @classmethod
    def normalize_category(cls, v: Optional[str]) -> Optional[str]:
        return coerce_library_category(v)


class Recipe(RecipeCreate):
    id: str


class MealPlan(BaseModel):
    """One row per date. date is YYYY-MM-DD."""
    id: str  # same as date for simplicity
    date: str
    recipe_ids: list[str]


class ShoppingListItem(BaseModel):
    name: str
    total_quantity: str

