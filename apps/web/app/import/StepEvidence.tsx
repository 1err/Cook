"use client";
import { recipeSourceMomentUrl, type RecipeStep } from "@cooking/shared";
import { useT } from "../lib/i18n";
import styles from "./StepEvidence.module.css";

export function StepEvidence({
  step,
  sourceUrl,
  showSuggestedWarning = false,
}: {
  step: RecipeStep;
  sourceUrl?: string | null;
  showSuggestedWarning?: boolean;
}) {
  const t = useT();
  const moment = step.instruction_source === "source" ? recipeSourceMomentUrl(sourceUrl, step.source_start_seconds) : null;
  if (moment) {
    return <a className={styles.sourceLink} href={moment} target="_blank" rel="noopener noreferrer">
      {t("recipe.tutorial.evidence.moment")}
      <span aria-hidden="true">↗</span>
    </a>;
  }
  if (showSuggestedWarning && step.instruction_source === "suggested") {
    return <p className={styles.suggestedWarning}>{t("recipe.tutorial.evidence.suggested")}</p>;
  }
  return null;
}
