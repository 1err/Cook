import type { MealPlanDay, MealType } from "@cooking/shared";

export function getPlannedSelection(
  plans: MealPlanDay[],
  date: string,
  meal: MealType,
): string[] {
  const plan = plans.find((item) => item.date === date);
  if (!plan) return [];
  return [...new Set(plan[meal] ?? [])];
}
