import { createUuid } from "../uuid";
import type { MenuDraft, MenuItem, MenuRecipe, MenuSection } from "./types";

export const DEFAULT_MENU_SECTION_ID = "dishes";

export class MissingMenuRecipeError extends Error {
  readonly missingIds: string[];

  constructor(missingIds: readonly string[]) {
    const uniqueIds = [...new Set(missingIds)];
    super(`Missing selected recipe IDs: ${uniqueIds.join(", ")}`);
    this.name = "MissingMenuRecipeError";
    this.missingIds = uniqueIds;
  }
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function recipesById(recipes: readonly MenuRecipe[]): Map<string, MenuRecipe> {
  return new Map(recipes.map((recipe) => [recipe.id, recipe]));
}

function selectedRecipes(recipes: readonly MenuRecipe[], selectedIds: readonly string[]): MenuRecipe[] {
  const byId = recipesById(recipes);
  const ids = uniqueIds(selectedIds);
  const missingIds = ids.filter((id) => !byId.has(id));
  if (missingIds.length > 0) {
    throw new MissingMenuRecipeError(missingIds);
  }
  return ids.map((id) => byId.get(id)!);
}

function itemFromRecipe(recipe: MenuRecipe): MenuItem {
  return {
    recipeId: recipe.id,
    sectionId: DEFAULT_MENU_SECTION_ID,
    name: recipe.title,
    description: recipe.description ?? "",
  };
}

export function createMenuDraft(
  recipes: readonly MenuRecipe[],
  selectedIds: readonly string[],
  labels: { title: string; section: string },
): MenuDraft {
  return {
    title: labels.title,
    subtitle: "",
    styleId: "cozy-cafe",
    instructions: "",
    sections: [{ id: DEFAULT_MENU_SECTION_ID, title: labels.section }],
    items: selectedRecipes(recipes, selectedIds).map(itemFromRecipe),
    artwork: null,
  };
}

export function reconcileMenuSelection(
  draft: MenuDraft,
  recipes: readonly MenuRecipe[],
  selectedIds: readonly string[],
): MenuDraft {
  const selected = selectedRecipes(recipes, selectedIds);
  const selectedIdSet = new Set(selected.map((recipe) => recipe.id));
  const retainedIds = new Set<string>();
  const retained = draft.items.filter((item) => {
    if (!selectedIdSet.has(item.recipeId) || retainedIds.has(item.recipeId)) {
      return false;
    }
    retainedIds.add(item.recipeId);
    return true;
  });
  const appended = selected.filter((recipe) => !retainedIds.has(recipe.id)).map(itemFromRecipe);

  return { ...draft, items: [...retained, ...appended] };
}

function insertionIndexForSection(
  items: readonly MenuItem[],
  sections: readonly MenuSection[],
  sectionId: string,
  targetIndex: number,
): number {
  const matchingIndexes = items.flatMap((item, index) => (item.sectionId === sectionId ? [index] : []));
  const boundedIndex = Number.isFinite(targetIndex)
    ? Math.max(0, Math.min(matchingIndexes.length, Math.trunc(targetIndex)))
    : 0;

  if (boundedIndex < matchingIndexes.length) {
    return matchingIndexes[boundedIndex];
  }
  if (matchingIndexes.length > 0) {
    return matchingIndexes[matchingIndexes.length - 1] + 1;
  }

  const sectionOrder = new Map(sections.map((section, index) => [section.id, index]));
  const targetSectionIndex = sectionOrder.get(sectionId)!;
  const nextSectionItem = items.findIndex(
    (item) => (sectionOrder.get(item.sectionId) ?? Number.POSITIVE_INFINITY) > targetSectionIndex,
  );
  return nextSectionItem === -1 ? items.length : nextSectionItem;
}

export function moveMenuItem(
  draft: MenuDraft,
  recipeId: string,
  sectionId: string,
  targetIndex: number,
): MenuDraft {
  const itemIndex = draft.items.findIndex((item) => item.recipeId === recipeId);
  if (itemIndex === -1) {
    throw new Error(`Missing menu item: ${recipeId}`);
  }
  if (!draft.sections.some((section) => section.id === sectionId)) {
    throw new Error(`Missing menu section: ${sectionId}`);
  }

  const movedItem = { ...draft.items[itemIndex], sectionId };
  const remaining = draft.items.filter((_, index) => index !== itemIndex);
  const insertionIndex = insertionIndexForSection(remaining, draft.sections, sectionId, targetIndex);
  return {
    ...draft,
    items: [...remaining.slice(0, insertionIndex), movedItem, ...remaining.slice(insertionIndex)],
  };
}

export function updateMenuItem(
  draft: MenuDraft,
  recipeId: string,
  patch: Partial<Pick<MenuItem, "name" | "description">>,
): MenuDraft {
  const itemIndex = draft.items.findIndex((item) => item.recipeId === recipeId);
  if (itemIndex === -1) {
    throw new Error(`Missing menu item: ${recipeId}`);
  }

  return {
    ...draft,
    items: draft.items.map((item, index) => (index === itemIndex ? { ...item, ...patch } : item)),
  };
}

export function createMenuSection(title: string): MenuSection {
  return { id: createUuid(), title };
}
