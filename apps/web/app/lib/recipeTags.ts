import type { Recipe, RecipeTagSlug } from "@cooking/shared";

type RecipeTagSource = Pick<Recipe, "library_tags" | "library_category">;

/**
 * Resolve a recipe's display tags, falling back to the legacy `library_category`
 * column for rows written before the multi-tag migration.
 */
export function getRecipeTags(recipe: RecipeTagSource): RecipeTagSlug[] {
  const tags = recipe.library_tags;
  if (tags && tags.length > 0) return tags;
  return recipe.library_category ? [recipe.library_category] : [];
}
