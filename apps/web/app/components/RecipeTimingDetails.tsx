"use client";

import type { Recipe } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { getRecipeTimingPresentation } from "../lib/recipeTiming";
import styles from "./RecipeTimingDetails.module.css";

type Props = { recipe: Pick<Recipe, "total_time_minutes" | "timing_summary" | "steps"> };

function TimeStat({ label, value, estimate }: { label: string; value: string; estimate?: string | null }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>
        {estimate && <><span className={styles.srOnly}>{estimate} </span><span aria-hidden="true" className={styles.approx}>≈</span></>}
        {value}
      </dd>
    </div>
  );
}

export function RecipeTimingDetails({ recipe }: Props) {
  const t = useT();
  const { totalLabel, splitDurations, passiveLabel, estimatePrefix } = getRecipeTimingPresentation(recipe, t, 0);
  if (!totalLabel && !passiveLabel) return null;
  const estimatedTotal = recipe.steps?.some(step => step.duration_source === "estimated" || step.duration_source === "fallback");

  return (
    <div className={styles.timing} role="group" aria-label={t("recipe.timing.details")}>
      {(totalLabel || splitDurations) && (
        <dl className={styles.values}>
          {totalLabel && <TimeStat label={t(estimatedTotal ? "recipe.estimatedTotal" : "recipe.totalTime")} value={totalLabel} />}
          {splitDurations && <>
            <TimeStat label={t("recipe.timing.handsOnLabel")} value={splitDurations.handsOn} estimate={estimatePrefix} />
            <TimeStat label={t("recipe.timing.passiveLabel")} value={splitDurations.passive} estimate={estimatePrefix} />
          </>}
        </dl>
      )}
      {!splitDurations && passiveLabel && <p className={styles.note}>{passiveLabel}</p>}
    </div>
  );
}
