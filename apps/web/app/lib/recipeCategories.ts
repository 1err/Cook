import type { CSSProperties } from "react";
import { recipeTagGroupFor, type RecipeTagGroupId } from "@cooking/shared";
import type { RecipeTagSlug } from "@cooking/shared";

export {
  RECIPE_TAG_GROUPS,
  TAG_LABELS,
  CATEGORY_LABELS,
  LIBRARY_FILTER_CHIPS,
  recipeTagGroupFor,
} from "@cooking/shared";
export type {
  RecipeTagSlug,
  LibraryCategorySlug,
  LibraryFilterId,
  RecipeTagGroupId,
} from "@cooking/shared";

/** Badge look (Stitch-inspired tonal pills). Web-only — needs CSSProperties. */
export function categoryBadgeStyle(slug: RecipeTagSlug): CSSProperties {
  const group = recipeTagGroupFor(slug);
  const map: Record<RecipeTagGroupId, CSSProperties> = {
    cuisine: {
      background: "rgba(154, 68, 45, 0.14)",
      color: "var(--primary)",
    },
    time: {
      background: "rgba(251, 146, 60, 0.18)",
      color: "#9a3412",
    },
    diet: {
      background: "rgba(25, 169, 146, 0.2)",
      color: "#00362d",
    },
    dish: {
      background: "rgba(228, 226, 225, 0.78)",
      color: "var(--on-surface)",
    },
    flavor: {
      background: "rgba(120, 113, 108, 0.18)",
      color: "#44403c",
    },
  };
  return map[group];
}
