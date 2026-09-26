import type { Recipe } from "../types";

export type MenuStyleId =
  | "cozy-cafe"
  | "french-bistro"
  | "garden-table"
  | "italian-supper"
  | "chinese-teahouse"
  | "minimal-modern";

export type MenuItem = {
  recipeId: string;
  sectionId: string;
  name: string;
  description: string;
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
};

export type MenuRecipe = Pick<Recipe, "id" | "title" | "description">;
