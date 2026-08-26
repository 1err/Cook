"use client";

import { useState } from "react";
import {
  getCurrentCookingStep,
  getDishProgress,
  getEffectiveStepState,
  type CookingAction,
  type CookingDish,
  type CookingStep,
} from "@cooking/shared";
import { Button } from "../components/ui/Button";
import { RecipeStepIllustration } from "../components/RecipeStepIllustration";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";
import { CookingTimer } from "./CookingTimer";

function StepVisual({ step }: { step: CookingStep }) {
  const [failed, setFailed] = useState(false);
  if (step.image_url && !failed) {
    return <img alt="" className={styles.focusVisual} onError={() => setFailed(true)} src={step.image_url} />;
  }
  return (
    <div className={styles.focusIllustration}>
      <RecipeStepIllustration actionType={step.action_type} decorative size={152} title={step.text} />
    </div>
  );
}

export function FocusedCookingStep({
  dish,
  onAction,
}: {
  dish: CookingDish;
  onAction: (stepId: string, action: CookingAction, extensionSeconds?: number) => void;
}) {
  const t = useT();
  const step = getCurrentCookingStep(dish);
  const progress = getDishProgress(dish);

  if (!step) {
    const lastResolved = [...dish.steps].reverse().find((item) => item.state === "completed" || item.state === "skipped");
    return (
      <section className={styles.focusCard} data-testid="focused-step">
        <h2>{dish.title}</h2>
        <p>{t("cook.dish.complete")}</p>
        <p>{t("cook.progress", { progress })}</p>
        {lastResolved ? (
          <Button variant="secondary" onClick={() => onAction(lastResolved.id, "reopen")}>
            {t("cook.action.reopen")}
          </Button>
        ) : null}
      </section>
    );
  }

  const state = getEffectiveStepState(step);
  const showTimer = ["timer_running", "timer_paused", "needs_attention"].includes(state);
  const stateLabel = state === "needs_attention"
    ? t("cook.attention.needsAttention")
    : step.attention_type === "passive"
      ? t("cook.attention.passive")
      : t("cook.attention.handsOn");

  return (
    <section className={styles.focusCard} data-testid="focused-step">
      <header className={styles.focusHeader}>
        <div>
          <p className={styles.eyebrow}>{t("cook.step.number", { current: step.position + 1, total: dish.steps.length })}</p>
          <h2>{dish.title}</h2>
        </div>
        <span className={state === "needs_attention" ? styles.attentionBadge : styles.stepBadge}>{stateLabel}</span>
      </header>
      <div className={styles.focusGrid}>
        <StepVisual step={step} />
        <div className={styles.stepBody}>
          <p className={styles.stepText}>{step.text}</p>
          {showTimer ? <CookingTimer step={{ ...step, state }} /> : null}
          <div className={styles.stepActions}>
            {step.attention_type === "passive" && state === "ready" ? (
              <Button onClick={() => onAction(step.id, "start_timer")}>{t("cook.action.startTimer")}</Button>
            ) : null}
            {state === "timer_running" ? (
              <Button variant="secondary" onClick={() => onAction(step.id, "pause_timer")}>{t("cook.action.pause")}</Button>
            ) : null}
            {state === "timer_paused" ? (
              <Button variant="secondary" onClick={() => onAction(step.id, "resume_timer")}>{t("cook.action.resume")}</Button>
            ) : null}
            {["timer_running", "timer_paused", "needs_attention"].includes(state) ? (
              <Button variant="secondary" onClick={() => onAction(step.id, "extend_timer", 60)}>{t("cook.action.extend")}</Button>
            ) : null}
            <Button onClick={() => onAction(step.id, "complete")}>{t("cook.action.complete")}</Button>
            <Button variant="ghost" onClick={() => onAction(step.id, "skip")}>{t("cook.action.skip")}</Button>
          </div>
        </div>
      </div>
      <p className={styles.progressLabel}>{t("cook.progress", { progress })}</p>
    </section>
  );
}
