from dotenv import load_dotenv
load_dotenv()

import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import re
from collections import defaultdict
from pydantic import BaseModel
from typing import Optional

from app.db import (
    init_db,
    save_recipe,
    get_recipe,
    list_recipes,
    delete_recipe,
    get_meal_plans_in_range,
    put_meal_plan,
)
from app.models import Recipe, IngredientItem, MealPlan, ShoppingListItem
from app.extract import (
    get_transcript_from_video_link,
    get_transcript_from_uploaded_file,
    get_ocr_text_from_video,
    extract_recipe_from_text,
)
from app.refine import refine_shopping_list


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Cooking Recipe API", lifespan=lifespan)

# Development CORS: allow any origin so frontend works from phone on local network
# (e.g. http://192.168.1.178:3000 → http://192.168.1.178:8000). In production, restrict
# allow_origins to your deployed frontend URL(s).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/recipes/import/link")
async def import_from_link(url: str):
    """Import recipe from video link. Fetches YouTube captions when possible, then LLM extraction."""
    transcript = get_transcript_from_video_link(url)
    # TODO: When implementing real transcript, pass url to backend service that fetches video
    ocr_text = get_ocr_text_from_video(url)
    recipe = await extract_recipe_from_text(transcript, ocr_text)
    recipe = recipe.model_copy(update={"source_url": url})
    await save_recipe(recipe)
    return recipe


@app.post("/recipes/import/upload")
async def import_from_upload(
    file: UploadFile = File(...),
):
    """Import recipe from uploaded video file. Transcript stubbed; real impl would use Whisper."""
    # TODO: Save file temporarily, run speech-to-text, optionally OCR
    transcript = get_transcript_from_uploaded_file("")
    ocr_text = get_ocr_text_from_video("")
    recipe = await extract_recipe_from_text(transcript, ocr_text)
    await save_recipe(recipe)
    return recipe


class TranscriptBody(BaseModel):
    transcript: str = ""


@app.post("/recipes/import/transcript")
async def import_from_transcript(body: TranscriptBody):
    """Import by pasted transcript only. Useful for testing and manual paste."""
    recipe = await extract_recipe_from_text(body.transcript, "")
    await save_recipe(recipe)
    return recipe


@app.get("/recipes", response_model=list[Recipe])
async def recipes_list():
    return await list_recipes()


@app.get("/recipes/{recipe_id}", response_model=Recipe)
async def recipe_get(recipe_id: str):
    r = await get_recipe(recipe_id)
    if not r:
        raise HTTPException(404, "Recipe not found")
    return r


class RecipeUpdate(BaseModel):
    title: Optional[str] = None
    ingredients: Optional[list[IngredientItem]] = None


@app.patch("/recipes/{recipe_id}", response_model=Recipe)
async def recipe_update(recipe_id: str, body: RecipeUpdate):
    r = await get_recipe(recipe_id)
    if not r:
        raise HTTPException(404, "Recipe not found")
    updates = body.model_dump(exclude_unset=True)
    updated = r.model_copy(update=updates)
    await save_recipe(updated)
    return updated


@app.delete("/recipes/{recipe_id}", status_code=204)
async def recipe_delete(recipe_id: str):
    deleted = await delete_recipe(recipe_id)
    if not deleted:
        raise HTTPException(404, "Recipe not found")


@app.post("/recipes", response_model=Recipe)
async def recipe_create(recipe: Recipe):
    await save_recipe(recipe)
    return recipe


# ----- Meal plan -----

@app.get("/meal-plan", response_model=list[MealPlan])
async def meal_plan_list(start: str, end: str):
    """Get meal plans for dates in [start, end] (YYYY-MM-DD inclusive)."""
    return await get_meal_plans_in_range(start, end)


class MealPlanPutBody(BaseModel):
    recipe_ids: list[str]


@app.put("/meal-plan/{date}", response_model=MealPlan)
async def meal_plan_put(date: str, body: MealPlanPutBody):
    """Create or update meal plan for the given date (YYYY-MM-DD)."""
    return await put_meal_plan(date, body.recipe_ids)


# ----- Shopping list -----
# TODO (future): Store-specific SKU mapping could be implemented here or in a
# dedicated module; map ingredient names to store product IDs for cart prefill.
# TODO (future): Cart-prefill logic could plug in after aggregation: take
# ShoppingListItem list + store choice, return deep links or cart payloads.
# TODO (future): Pantry tracking could be introduced by filtering or reducing
# the aggregated list (e.g. subtract on-hand quantities) before returning.


def _parse_quantity(qty: str) -> tuple[float, str] | None:
    """
    Parse a quantity string into (numeric_value, unit).
    E.g. "100g" -> (100.0, "g"), "1.5 cups" -> (1.5, "cups").
    Returns None if no leading number (e.g. "to taste", "4-5 medium").
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


def _aggregate_quantities(quantities: list[str]) -> str:
    """
    Aggregate quantity strings: sum when same unit and numeric parse succeeds,
    otherwise concatenate. No unit conversion.
    """
    summed: dict[str, float] = defaultdict(float)
    unparsed: list[str] = []
    for q in quantities:
        if not q:
            continue
        parsed = _parse_quantity(q)
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


# ----- Shopping list refine (stateless, no DB) -----

class RefineItem(BaseModel):
    name: str
    quantity: str = ""


class RefineRequest(BaseModel):
    items: list[RefineItem]


class LikelyPantryItem(BaseModel):
    name: str
    reason: str


class PurchaseItem(BaseModel):
    name: str
    suggested_purchase: str


class RefineResponse(BaseModel):
    remove: list[str]
    likely_pantry: list[LikelyPantryItem]
    purchase_items: list[PurchaseItem]


@app.post("/shopping-list/refine", response_model=RefineResponse)
async def shopping_list_refine(body: RefineRequest):
    """Refine aggregated list: remove non-purchasables, flag pantry, suggest purchase quantities. Stateless."""
    raw = [{"name": i.name, "quantity": i.quantity} for i in body.items]
    result = await refine_shopping_list(raw, pantry_names=[])
    return RefineResponse(
        remove=result["remove"],
        likely_pantry=[LikelyPantryItem(name=p["name"], reason=p["reason"]) for p in result["likely_pantry"]],
        purchase_items=[PurchaseItem(name=p["name"], suggested_purchase=p["suggested_purchase"]) for p in result["purchase_items"]],
    )


@app.get("/shopping-list", response_model=list[ShoppingListItem])
async def shopping_list(start: str, end: str):
    """
    Aggregated ingredients for meal plans in [start, end].
    Groups by ingredient name (case-insensitive). Quantities with same unit
    are summed when parseable; otherwise concatenated.
    """
    plans = await get_meal_plans_in_range(start, end)
    recipe_cache: dict[str, Recipe | None] = {}
    for p in plans:
        for rid in p.recipe_ids:
            if rid not in recipe_cache:
                recipe_cache[rid] = await get_recipe(rid)
    all_ingredients: list[tuple[str, str]] = []
    for p in plans:
        for rid in p.recipe_ids:
            r = recipe_cache.get(rid)
            if r:
                for i in r.ingredients:
                    name = (i.name or "").strip()
                    qty = (i.quantity or "").strip()
                    all_ingredients.append((name, qty))
    by_key: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for name, qty in all_ingredients:
        key = name.lower() if name else ""
        by_key[key].append((name, qty))
    out: list[ShoppingListItem] = []
    for key, pairs in sorted(by_key.items()):
        display_name = pairs[0][0] if pairs else key
        quantities = [q for _, q in pairs if q]
        total_quantity = _aggregate_quantities(quantities)
        out.append(ShoppingListItem(name=display_name, total_quantity=total_quantity))
    return out
