import type {
  RecipeActionType,
  RecipeAttentionType,
  RecipeDurationSource,
} from "./recipeTutorial";

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

export interface RecipeStep {
  id?: string | null;
  text: string;
  duration_seconds?: number | null;
  duration_source?: RecipeDurationSource | null;
  attention_type?: RecipeAttentionType | null;
  action_type?: RecipeActionType | null;
  image_url?: string | null;
  instruction_source?: "source" | "suggested" | "user" | null;
  source_start_seconds?: number | null;
  source_end_seconds?: number | null;
  source_excerpt?: string | null;
}

export interface RecipeTimingSummary {
  hands_on_minutes: number | null;
  passive_minutes: number | null;
  is_estimate: boolean;
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
  description?: string | null;
  total_time_minutes?: number | null;
  timing_summary?: RecipeTimingSummary | null;
  steps?: RecipeStep[];
  tips?: string[];
  equipment?: string[];
  import_review?: {
    status: "ready" | "needs_review";
    warnings: string[];
    source_kind: "captions" | "description" | "video" | "media" | "text";
    can_analyze_video: boolean;
  } | null;
}

export type RecipeImportJob = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  recipe?: Recipe | null;
  error?: { code: string; message: string } | null;
};

export type RecipeImportCapabilities = {
  video_analysis: boolean;
  media_upload: boolean;
  max_media_bytes: number;
};

export type MealPlanDay = {
  date: string;
  revision?: number;
  breakfast: string[];
  lunch: string[];
  dinner: string[];
  recipe_ids?: string[];
};

export type MealPlanSlots = Record<"breakfast" | "lunch" | "dinner", string[]>;

export interface ShoppingSourceItem {
  name: string;
  quantity: string;
}

export interface ShoppingListItem {
  name: string;
  total_quantity: string;
  source_items?: ShoppingSourceItem[] | null;
}

export interface User {
  id: string;
  email: string;
  email_verified?: boolean;
  email_verification_required?: boolean;
  is_library_public: boolean;
  is_admin?: boolean;
}


export type RecipeSummary = Pick<Recipe, "id" | "title" | "source_url" | "thumbnail_url" | "library_tags" | "library_category" | "is_public_catalog" | "catalog_source_recipe_id" | "total_time_minutes" | "timing_summary"> & {
  ingredient_count: number;
  step_count: number;
  already_saved: boolean;
};
export type RecipePage = { items: RecipeSummary[]; next_cursor: string | null };
