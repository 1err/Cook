import type { CSSProperties } from "react";

/** Matches backend LIBRARY_CATEGORY_SLUGS + "all" for UI filter state. */
export type LibraryCategorySlug =
  | "quick_dinner"
  | "vegetarian"
  | "dessert"
  | "breakfast"
  | "italian"
  | "healthy";

export type LibraryFilterId = "all" | LibraryCategorySlug;

export const LIBRARY_FILTER_CHIPS: { id: LibraryFilterId; label: string }[] = [
  { id: "all", label: "All recipes" },
  { id: "quick_dinner", label: "Quick dinners" },
  { id: "vegetarian", label: "Vegetarian" },
  { id: "dessert", label: "Desserts" },
  { id: "breakfast", label: "Breakfast" },
  { id: "italian", label: "Italian" },
  { id: "healthy", label: "Healthy" },
];

export const CATEGORY_LABELS: Record<LibraryCategorySlug, string> = {
  quick_dinner: "Quick dinners",
  vegetarian: "Vegetarian",
  dessert: "Desserts",
  breakfast: "Breakfast",
  italian: "Italian",
  healthy: "Healthy",
};

/** Badge look (Stitch-inspired tonal pills). */
export function categoryBadgeStyle(slug: LibraryCategorySlug): CSSProperties {
  const map: Record<LibraryCategorySlug, CSSProperties> = {
    vegetarian: {
      background: "rgba(25, 169, 146, 0.22)",
      color: "#00362d",
    },
    quick_dinner: {
      background: "rgba(154, 68, 45, 0.12)",
      color: "var(--primary)",
    },
    italian: {
      background: "rgba(251, 146, 60, 0.2)",
      color: "#9a3412",
    },
    dessert: {
      background: "rgba(120, 113, 108, 0.15)",
      color: "#44403c",
    },
    breakfast: {
      background: "rgba(228, 226, 225, 0.65)",
      color: "var(--on-surface)",
    },
    healthy: {
      background: "rgba(0, 107, 91, 0.12)",
      color: "#006b5b",
    },
  };
  return map[slug];
}
