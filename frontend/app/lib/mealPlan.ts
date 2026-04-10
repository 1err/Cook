export const MEAL_PLAN_SLOTS = ["breakfast", "lunch", "dinner"] as const;

export type MealType = (typeof MEAL_PLAN_SLOTS)[number];

export type MealPlanDay = {
  date: string;
  breakfast: string[];
  lunch: string[];
  dinner: string[];
  recipe_ids?: string[];
};

export type MealPlanSlots = Record<MealType, string[]>;

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

export function plannerFingerprintStorageKey(weekStart: string): string {
  return `plannerWeekFingerprint:${weekStart}`;
}
