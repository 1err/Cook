import type { MealPlanDay, MealPlanSlots } from "./types";

export const MEAL_PLAN_SLOTS = ["breakfast", "lunch", "dinner"] as const;

export type MealType = (typeof MEAL_PLAN_SLOTS)[number];

function normalizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

export function emptyMealPlanSlots(): MealPlanSlots {
  return { breakfast: [], lunch: [], dinner: [] };
}

export function normalizeMealPlanSlots(plan?: Partial<MealPlanDay> | null): MealPlanSlots {
  if (!plan) return emptyMealPlanSlots();
  if (Array.isArray(plan.recipe_ids)) {
    return { breakfast: [], lunch: [], dinner: normalizeIds(plan.recipe_ids) };
  }
  return {
    breakfast: normalizeIds(plan.breakfast),
    lunch: normalizeIds(plan.lunch),
    dinner: normalizeIds(plan.dinner),
  };
}

export function buildMealPlanFingerprint(plans: MealPlanDay[]): string {
  const normalized = [...plans]
    .map((plan) => ({
      date: plan.date,
      breakfast: normalizeIds(plan.breakfast),
      lunch: normalizeIds(plan.lunch),
      dinner: normalizeIds(plan.dinner),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return JSON.stringify(normalized);
}

export function buildWeekMealPlanFingerprint(weekDates: string[], plans: MealPlanDay[]): string {
  const byDate = new Map<string, MealPlanSlots>();
  for (const p of plans) {
    byDate.set(p.date, normalizeMealPlanSlots(p));
  }
  const normalized = [...weekDates]
    .map((date) => {
      const slots = byDate.get(date) ?? emptyMealPlanSlots();
      return {
        date,
        breakfast: normalizeIds(slots.breakfast),
        lunch: normalizeIds(slots.lunch),
        dinner: normalizeIds(slots.dinner),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return JSON.stringify(normalized);
}

export function plannerFingerprintStorageKey(weekStart: string): string {
  return `plannerWeekFingerprint:${weekStart}`;
}
