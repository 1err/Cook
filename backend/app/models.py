"""Simple data models. No complex schemas."""
from pydantic import BaseModel
from typing import Optional


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

