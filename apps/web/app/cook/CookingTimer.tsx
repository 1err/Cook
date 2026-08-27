"use client";

import { useEffect, useState } from "react";
import type { CookingStep } from "@cooking/shared";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";
import { formatCookingTime, getRemainingSeconds } from "./cookingTime";

function remaining(step: CookingStep, nowMs: number): number {
  if (step.state === "timer_paused") return Math.max(0, step.paused_remaining_seconds ?? 0);
  return getRemainingSeconds(step.timer_ends_at, nowMs);
}

export function CookingTimer({ step }: { step: CookingStep }) {
  const t = useT();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (step.state !== "timer_running") return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [step.state]);

  const seconds = remaining(step, nowMs);
  const label = step.state === "timer_paused"
    ? t("cook.timer.paused")
    : seconds === 0
      ? t("cook.attention.needsAttention")
      : t("cook.timer.remaining");

  return (
    <div aria-label={`${label} ${formatCookingTime(seconds)}`} className={styles.timer} role="timer">
      <span>{label}</span>
      <strong>{formatCookingTime(seconds)}</strong>
    </div>
  );
}
