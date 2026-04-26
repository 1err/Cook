export type RecipeTagSlug =
  | "chinese"
  | "japanese"
  | "korean"
  | "thai"
  | "italian"
  | "american"
  | "mexican"
  | "indian"
  | "mediterranean"
  | "quick"
  | "weeknight"
  | "slow_cooked"
  | "healthy"
  | "high_protein"
  | "low_carb"
  | "vegetarian"
  | "vegan"
  | "gluten_free"
  | "breakfast"
  | "main_dish"
  | "side"
  | "soup"
  | "noodles"
  | "rice"
  | "salad"
  | "dessert"
  | "spicy"
  | "comfort_food"
  | "light"
  | "savory"
  | "sweet";

export interface IngredientItem {
  name: string;
  quantity: string;
  metric_quantity?: string | null;
  notes?: string | null;
}

export interface Recipe {
  id: string;
  title: string;
  source_url?: string | null;
  thumbnail_url?: string | null;
  ingredients: IngredientItem[];
  raw_extraction_text?: string | null;
  library_tags?: RecipeTagSlug[];
  library_category?: RecipeTagSlug | null;
  is_public_catalog?: boolean;
  catalog_source_recipe_id?: string | null;
}

export type MealPlanDay = {
  date: string;
  breakfast: string[];
  lunch: string[];
  dinner: string[];
  recipe_ids?: string[];
};

export type MealPlanSlots = Record<"breakfast" | "lunch" | "dinner", string[]>;

export interface ShoppingListItem {
  name: string;
  total_quantity: string;
}
