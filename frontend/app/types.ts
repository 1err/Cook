export interface IngredientItem {
  name: string;
  quantity: string;
  notes?: string | null;
}

export interface Recipe {
  id: string;
  title: string;
  source_url?: string | null;
  thumbnail_url?: string | null;
  ingredients: IngredientItem[];
  raw_extraction_text?: string | null;
}
