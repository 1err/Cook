import type { Recipe } from "./types";
import { createRecipeStep } from "./recipeTutorial";
import { createUuid } from "./uuid";

/** A local draft only: no source extraction, estimation, or provider request. */
export function createManualRecipeDraft(): Recipe {
  return {
    id: createUuid(),
    title: "",
    source_url: null,
    thumbnail_url: null,
    ingredients: [{ name: "", quantity: "" }],
    steps: [createRecipeStep()],
    library_tags: [],
  };
}

export function isCompleteRecipeDraft(draft: Recipe): boolean {
  return Boolean(draft.title.trim()
    && draft.ingredients.some(item => item.name.trim())
    && draft.steps?.some(step => step.text.trim()));
}
