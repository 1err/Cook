import type { Recipe } from "./types";

export type RecipeImageInput = {
  title: string;
  description: string;
  ingredients: string[];
  steps: string[];
};

const bounded = (text: string | null | undefined, limit: number) =>
  Array.from((text ?? "").trim()).slice(0, limit).join("");

/** Keep private source metadata out of the prompt and bound large recipe drafts. */
export function buildRecipeImageInput(
  recipe: Pick<Recipe, "title"> & Partial<Pick<Recipe, "description" | "ingredients" | "steps">>,
): RecipeImageInput {
  return {
    title: bounded(recipe.title, 512),
    description: bounded(recipe.description, 2000),
    ingredients: (recipe.ingredients ?? []).map((item) => bounded(item.name, 100)).filter(Boolean).slice(0, 40),
    steps: (recipe.steps ?? []).map((step) => bounded(step.text, 300)).filter(Boolean).slice(0, 12),
  };
}
