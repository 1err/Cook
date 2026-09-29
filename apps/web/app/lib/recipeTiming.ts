import type { Recipe } from "@cooking/shared";

type TimingRecipe = Pick<Recipe, "total_time_minutes" | "timing_summary">;
type Translate = (key: string, vars?: Record<string, string | number>) => string;

export type RecipeTimingPresentation = {
  totalLabel: string | null;
  handsOnLabel: string | null;
  passiveLabel: string | null;
  estimatePrefix: string | null;
  hasDetails: boolean;
};

function positiveMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function formatRecipeMinutes(value: number, t: Translate): string {
  const rounded = Math.ceil(value);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (!hours) return `${minutes} ${t("recipe.totalTime.minutesSuffix")}`;
  return t(minutes ? "recipe.timing.hoursMinutes" : "recipe.timing.hours", { hours, minutes });
}

/** A presentation of recorded timings, never total-minus-wait inference. */
export function getRecipeTimingPresentation(
  recipe: TimingRecipe,
  t: Translate,
  minimumPassiveMinutes = 10,
): RecipeTimingPresentation {
  const total = positiveMinutes(recipe.total_time_minutes) ? recipe.total_time_minutes : null;
  const summary = recipe.timing_summary;
  const handsOn = summary?.hands_on_minutes;
  const passive = summary?.passive_minutes;
  const valid = typeof summary?.is_estimate === "boolean"
    && (handsOn === null || (typeof handsOn === "number" && Number.isFinite(handsOn) && handsOn >= 0))
    && positiveMinutes(passive);
  const showPassive = valid && passive >= minimumPassiveMinutes && (total === null || passive <= total);
  // Subtotals round up independently; preserve a conflicting recorded total.
  const matchesTotal = total === null || (positiveMinutes(handsOn) && positiveMinutes(passive)
    && Math.abs(handsOn + passive - total) <= 1);
  const fullSplit = showPassive && positiveMinutes(handsOn) && matchesTotal;
  const format = (minutes: number) => formatRecipeMinutes(minutes, t);
  let passiveLabel: string | null = null;
  if (showPassive) {
    if (fullSplit) passiveLabel = t("recipe.timing.passive", { duration: format(passive) });
    else if (total === null && handsOn === 0) {
      passiveLabel = `${summary?.is_estimate ? `${t("recipe.timing.about")} ` : ""}${t("recipe.timing.passive", { duration: format(passive) })}`;
    } else {
      passiveLabel = t(summary?.is_estimate ? "recipe.timing.includesEstimatedPassive" : "recipe.timing.includesPassive", { duration: format(passive) });
    }
  }
  return {
    totalLabel: total === null ? null : format(total),
    handsOnLabel: fullSplit ? t("recipe.timing.handsOn", { duration: format(handsOn) }) : null,
    passiveLabel,
    estimatePrefix: fullSplit && summary?.is_estimate ? t("recipe.timing.about") : null,
    hasDetails: passiveLabel !== null,
  };
}
