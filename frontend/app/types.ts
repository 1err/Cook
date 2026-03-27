export interface IngredientItem {
  name: string;
  quantity: string;
  notes?: string | null;
}

import type { LibraryCategorySlug } from "./lib/recipeCategories";

export interface Recipe {
  id: string;
  title: string;
  source_url?: string | null;
  thumbnail_url?: string | null;
  ingredients: IngredientItem[];
  raw_extraction_text?: string | null;
  /** Optional library filter chip (set on edit). */
  library_category?: LibraryCategorySlug | null;
}
