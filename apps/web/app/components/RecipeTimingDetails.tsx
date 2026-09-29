"use client";

import type { Recipe } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { getRecipeTimingPresentation } from "../lib/recipeTiming";
import styles from "./RecipeTimingDetails.module.css";

type Props = { recipe: Pick<Recipe, "total_time_minutes" | "timing_summary" | "steps"> };

export function RecipeTimingDetails({ recipe }: Props) {
  const t = useT();
  const timing = getRecipeTimingPresentation(recipe, t, 0);
  if (!timing.totalLabel && !timing.hasDetails) return null;
  const estimatedTotal = recipe.steps?.some(step => step.duration_source === "estimated" || step.duration_source === "fallback");
  return (
    <div className={styles.timing} role="group" aria-label={t("recipe.timing.details")}>
      {timing.totalLabel ? (
        <dl className={styles.total}>
          <div>
            <dt>{t(estimatedTotal ? "recipe.estimatedTotal" : "recipe.totalTime")}</dt>
            <dd>{timing.totalLabel}</dd>
          </div>
        </dl>
      ) : null}
      {timing.hasDetails ? (
        <p className={styles.breakdown}>
          {timing.estimatePrefix ? <><span>{timing.estimatePrefix}</span>{" "}</> : null}
          {timing.handsOnLabel ? <><strong>{timing.handsOnLabel}</strong>{" · "}</> : null}
          <span className={styles.passive}>{timing.passiveLabel}</span>
        </p>
      ) : null}
    </div>
  );
}
