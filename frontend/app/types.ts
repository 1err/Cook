export interface IngredientItem {
  name: string;
  quantity: string;
  notes?: string | null;
}

import type { RecipeTagSlug } from "./lib/recipeCategories";

export interface Recipe {
  id: string;
  title: string;
  source_url?: string | null;
  thumbnail_url?: string | null;
  ingredients: IngredientItem[];
  raw_extraction_text?: string | null;
  /** Multi-tag metadata used for library/planner filtering. */
  library_tags?: RecipeTagSlug[];
  /** Legacy single-tag field kept for older rows/compatibility. */
  library_category?: RecipeTagSlug | null;
  /** True when this recipe is visible in the shared public catalog. */
  is_public_catalog?: boolean;
  /** Source public recipe id when this row was copied from the shared catalog. */
  catalog_source_recipe_id?: string | null;
}
