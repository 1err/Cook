"use client";

import type { Recipe } from "@cooking/shared";
import { useT } from "../lib/i18n";
import styles from "./RecipeTiming.module.css";

type Props = Pick<Recipe, "total_time_minutes" | "timing_summary">;

function positiveMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Library-only presentation of recorded timing; never derives effort from the total. */
export function RecipeTiming({ total_time_minutes, timing_summary }: Props) {
  const t = useT();
  const total = positiveMinutes(total_time_minutes) ? total_time_minutes : null;
  const format = (value: number) => {
    const rounded = Math.ceil(value);
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    if (!hours) return `${minutes} ${t("recipe.totalTime.minutesSuffix")}`;
    return t(minutes ? "recipe.timing.hoursMinutes" : "recipe.timing.hours", { hours, minutes });
  };

  const handsOn = timing_summary?.hands_on_minutes;
  const passive = timing_summary?.passive_minutes;
  const validSummary = typeof timing_summary?.is_estimate === "boolean"
    && (handsOn === null || (typeof handsOn === "number" && Number.isFinite(handsOn) && handsOn >= 0))
    && positiveMinutes(passive);
  const showPassive = validSummary && passive >= 10 && (total === null || passive <= total);
  // Preserve a conflicting recorded total; each rounded-up subtotal can add one minute.
  const matchesTotal = total === null || (positiveMinutes(handsOn) && positiveMinutes(passive)
    && Math.abs(handsOn + passive - total) <= 1);

  if (showPassive && positiveMinutes(handsOn) && matchesTotal) {
    return (
      <p className={`${styles.timing} ${styles.breakdown}`} data-timing-breakdown title={t("recipe.timing.explanation")}>
        {timing_summary?.is_estimate ? <><span>{t("recipe.timing.about")}</span>{" "}</> : null}
        <strong className={styles.primary}>{t("recipe.timing.handsOn", { duration: format(handsOn) })}</strong>
        {" · "}<span className={styles.passive}>{t("recipe.timing.passive", { duration: format(passive) })}</span>
      </p>
    );
  }

  if (showPassive) {
    const passiveLabel = total === null && handsOn === 0
      ? `${timing_summary?.is_estimate ? `${t("recipe.timing.about")} ` : ""}${t("recipe.timing.passive", { duration: format(passive) })}`
      : t(timing_summary?.is_estimate ? "recipe.timing.includesEstimatedPassive" : "recipe.timing.includesPassive", { duration: format(passive) });
    return (
      <p className={`${styles.timing} ${styles.breakdown}`} data-timing-breakdown title={t("recipe.timing.explanation")}>
        {total !== null ? <span>{t("recipe.timing.total", { duration: format(total) })}</span> : null}
        <span className={total !== null ? styles.detail : undefined}>{passiveLabel}</span>
      </p>
    );
  }
  if (total === null) return null;
  return <p className={styles.timing}>{format(total)}</p>;
}
