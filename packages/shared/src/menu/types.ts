import type { Recipe } from "../types";

export type MenuStyleId =
  | "cozy-cafe"
  | "french-bistro"
  | "garden-table"
  | "italian-supper"
  | "chinese-teahouse"
  | "minimal-modern";

/** Versioned, inert presentation data shared with the menu-design API. */
export type MenuDesign = {
  version: 1;
  layout: "photo-grid" | "illustrated-list" | "category-board";
  palette: { background: string; panel: string; text: string; accent: string; muted: string };
  typography: { title: "serif" | "sans" | "playful"; body: "serif" | "sans"; align: "left" | "center" };
  columns: 1 | 2 | 3;
  density: "airy" | "comfortable" | "compact";
  decorations: "minimal" | "balanced" | "expressive";
  section_treatment: "plain" | "band" | "rule" | "pill";
  photo_frame: "none" | "rounded" | "circle";
  artwork_placement: "header" | "sidebar" | "inset";
  art_direction: string;
  show_descriptions: boolean;
};

export type MenuItem = {
  recipeId: string;
  sectionId: string;
  name: string;
  description: string;
  imageUrl?: string | null;
  price?: string;
  badge?: string;
};

export type MenuSection = {
  id: string;
  title: string;
};

export type AcceptedMenuArtwork = {
  requestId: string;
  styleId: MenuStyleId;
  instructions: string;
};

export type MenuDraft = {
  title: string;
  subtitle: string;
  styleId: MenuStyleId;
  instructions: string;
  sections: MenuSection[];
  items: MenuItem[];
  artwork: AcceptedMenuArtwork | null;
  /** Absent on legacy drafts, whose original layout remains intact. */
  design?: MenuDesign;
};

export type MenuRecipe = Pick<Recipe, "id" | "title" | "description"> & { thumbnail_url?: string | null };
