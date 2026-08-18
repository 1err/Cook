import type { MealPlanSlots, MealType } from "@cooking/shared";

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
