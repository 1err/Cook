import type { Recipe, RecipeTagSlug } from "./types";

export type LibraryCategorySlug = RecipeTagSlug;
export type LibraryFilterId = "all" | RecipeTagSlug;

export type RecipeTagGroupId = "cuisine" | "time" | "diet" | "dish" | "flavor";

type RecipeTagOption = { id: RecipeTagSlug; label: string };

export const RECIPE_TAG_GROUPS: { id: RecipeTagGroupId; label: string; tags: RecipeTagOption[] }[] = [
  {
    id: "cuisine",
    label: "Cuisine",
    tags: [
      { id: "chinese", label: "Chinese" },
      { id: "japanese", label: "Japanese" },
      { id: "korean", label: "Korean" },
      { id: "thai", label: "Thai" },
      { id: "italian", label: "Italian" },
      { id: "american", label: "American" },
      { id: "mexican", label: "Mexican" },
      { id: "indian", label: "Indian" },
      { id: "mediterranean", label: "Mediterranean" },
    ],
  },
  {
    id: "time",
    label: "Cooking time",
    tags: [
      { id: "quick", label: "Quick" },
      { id: "weeknight", label: "Weeknight" },
      { id: "slow_cooked", label: "Slow-cooked" },
    ],
  },
  {
    id: "diet",
    label: "Dietary / health",
    tags: [
      { id: "healthy", label: "Healthy" },
      { id: "high_protein", label: "High-protein" },
      { id: "low_carb", label: "Low-carb" },
      { id: "vegetarian", label: "Vegetarian" },
      { id: "vegan", label: "Vegan" },
      { id: "gluten_free", label: "Gluten-free" },
    ],
  },
  {
    id: "dish",
    label: "Dish type",
    tags: [
      { id: "breakfast", label: "Breakfast" },
      { id: "main_dish", label: "Main dish" },
      { id: "side", label: "Side" },
      { id: "soup", label: "Soup" },
      { id: "noodles", label: "Noodles" },
      { id: "rice", label: "Rice" },
      { id: "salad", label: "Salad" },
      { id: "dessert", label: "Dessert" },
    ],
  },
  {
    id: "flavor",
    label: "Flavor / style",
    tags: [
      { id: "spicy", label: "Spicy" },
      { id: "comfort_food", label: "Comfort food" },
      { id: "light", label: "Light" },
      { id: "savory", label: "Savory" },
      { id: "sweet", label: "Sweet" },
    ],
  },
];

export const TAG_LABELS: Record<RecipeTagSlug, string> = Object.fromEntries(
  RECIPE_TAG_GROUPS.flatMap((group) => group.tags.map((tag) => [tag.id, tag.label]))
) as Record<RecipeTagSlug, string>;

export const LIBRARY_FILTER_CHIPS: { id: LibraryFilterId; label: string }[] = [
  { id: "all", label: "All recipes" },
  ...RECIPE_TAG_GROUPS.flatMap((group) => group.tags),
];

export const CATEGORY_LABELS = TAG_LABELS;

export function recipeTagGroupFor(tag: RecipeTagSlug): RecipeTagGroupId {
  const found = RECIPE_TAG_GROUPS.find((group) => group.tags.some((item) => item.id === tag));
  return found?.id ?? "dish";
}

type RecipeTagSource = Pick<Recipe, "library_tags" | "library_category">;

export function getRecipeTags(recipe: RecipeTagSource): RecipeTagSlug[] {
  const tags = recipe.library_tags;
  if (tags && tags.length > 0) return tags;
  return recipe.library_category ? [recipe.library_category] : [];
}
