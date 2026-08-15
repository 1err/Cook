import type { MealPlanSlots, MealType } from "@cooking/shared";

export const MAX_VISIBLE_SLOT_RECIPES = 2;

export function splitSlotRecipeIds(recipeIds: readonly string[]) {
  return {
    visible: recipeIds.slice(0, MAX_VISIBLE_SLOT_RECIPES),
    overflow: recipeIds.slice(MAX_VISIBLE_SLOT_RECIPES),
  };
}

function cloneSlots(slots: MealPlanSlots): MealPlanSlots {
  return {
    breakfast: [...slots.breakfast],
    lunch: [...slots.lunch],
    dinner: [...slots.dinner],
  };
}

export function addRecipeToSlots(
  slots: MealPlanSlots,
  slot: MealType,
  recipeId: string,
): MealPlanSlots {
  if (slots[slot].includes(recipeId)) return slots;
  const next = cloneSlots(slots);
  next[slot] = [...next[slot], recipeId];
  return next;
}

export function removeRecipeFromSlots(
  slots: MealPlanSlots,
  slot: MealType,
  recipeId: string,
): MealPlanSlots {
  const next = cloneSlots(slots);
  next[slot] = next[slot].filter((id) => id !== recipeId);
  return next;
}
