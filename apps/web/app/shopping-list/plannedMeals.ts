import { getWeekBounds, type MealPlanDay } from "@cooking/shared";
import type { Recipe } from "../types";

const SLOT_ORDER = ["breakfast", "lunch", "dinner"] as const;
const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type PlanSlot = (typeof SLOT_ORDER)[number];

export type PlannedMealOccurrence = {
  date: string;
  dayShort: string;
  slot: PlanSlot;
};

export type PlannedMealRow = {
  recipeId: string;
  title: string;
  thumbnailUrl?: string;
  occurrences: PlannedMealOccurrence[];
};

function compareOccurrences(a: PlannedMealOccurrence, b: PlannedMealOccurrence) {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot);
}

export function buildPlannedMealRows(
  plans: MealPlanDay[],
  recipes: Record<string, Recipe | undefined>,
  weekMondayYmd: string,
): PlannedMealRow[] {
  const { dates: weekDates } = getWeekBounds(weekMondayYmd);
  const dowByDate = new Map(weekDates.map((date, index) => [date, DOW_SHORT[index]]));
  const grouped = new Map<string, PlannedMealRow>();

  for (const plan of plans) {
    const dayShort = dowByDate.get(plan.date);
    if (!dayShort) continue;

    for (const slot of SLOT_ORDER) {
      for (const recipeId of plan[slot] ?? []) {
        if (!recipeId?.trim()) continue;
        const recipe = recipes[recipeId];
        const title = recipe?.title?.trim();
        if (!title) continue;

        const occurrence = { date: plan.date, dayShort, slot };
        const existing = grouped.get(recipeId);
        if (existing) {
          existing.occurrences.push(occurrence);
        } else {
          grouped.set(recipeId, {
            recipeId,
            title,
            thumbnailUrl: recipe?.thumbnail_url?.trim() || undefined,
            occurrences: [occurrence],
          });
        }
      }
    }
  }

  const rows = [...grouped.values()];
  rows.forEach((row) => row.occurrences.sort(compareOccurrences));
  rows.sort((a, b) => {
    const occurrenceOrder = compareOccurrences(a.occurrences[0], b.occurrences[0]);
    return occurrenceOrder || a.title.localeCompare(b.title);
  });
  return rows;
}

export function formatMealOccurrence(occurrence: PlannedMealOccurrence): string {
  return `${occurrence.dayShort} ${occurrence.slot}`;
}

export function formatPlannedMealSchedule(row: PlannedMealRow): string {
  const labels = row.occurrences.map(formatMealOccurrence);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `2 meals · ${labels.join(" · ")}`;
  return `${labels.length} meals · ${labels[0]} · +${labels.length - 1} more`;
}
