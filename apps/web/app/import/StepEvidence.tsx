"use client";
import { recipeSourceMomentUrl, type RecipeStep } from "@cooking/shared";
import { useT } from "../lib/i18n";
import styles from "./ImportFlow.module.css";

export function StepEvidence({ step, sourceUrl }: { step: RecipeStep; sourceUrl?: string | null }) {
  const t = useT();
  const moment = step.instruction_source === "source" ? recipeSourceMomentUrl(sourceUrl, step.source_start_seconds) : null;
  if (!step.instruction_source && !moment) return null;
  return <div className={styles.stepEvidence}>
    {step.instruction_source ? <small>{t(`recipe.tutorial.evidence.${step.instruction_source}`)}</small> : null}
    {moment ? <p><a href={moment} target="_blank" rel="noopener noreferrer">{t("recipe.tutorial.evidence.moment")}</a></p> : null}
  </div>;
}
