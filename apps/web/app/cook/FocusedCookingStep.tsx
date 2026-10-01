"use client";

import { useState } from "react";
import {
  formatRecipeStepMetadata,
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

function StepVisual({ step, compact, thumbnailUrl }: { step: CookingStep; compact: boolean; thumbnailUrl: string | null }) {
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const images = (compact ? [thumbnailUrl, step.image_url] : [step.image_url, thumbnailUrl])
    .filter((source): source is string => Boolean(source))
    .filter((source, index, candidates) => candidates.indexOf(source) === index);
  const imageUrl = images.find((source) => !failedImages.includes(source));
  if (imageUrl) {
    return (
      <img
        alt=""
        className={styles.focusVisual}
        onError={() => setFailedImages((current) => current.includes(imageUrl) ? current : [...current, imageUrl])}
        src={imageUrl}
      />
    );
  }
  return (
    <div className={styles.focusIllustration}>
      <RecipeStepIllustration actionType={step.action_type} decorative size={compact ? 64 : 152} title={step.text} />
    </div>
  );
}

export function FocusedCookingStep({
  dish,
  layout = "focused",
  onAction,
  onFocus,
  showAlertTakeover = false,
}: {
  dish: CookingDish;
  layout?: "focused" | "stacked";
  onAction: (stepId: string, action: CookingAction, extensionSeconds?: number) => void;
  onFocus?: () => void;
  showAlertTakeover?: boolean;
}) {
  const t = useT();
  const step = getCurrentCookingStep(dish);
  const progress = getDishProgress(dish);
  const compact = layout === "stacked";
  const cardClassName = `${styles.focusCard}${compact ? ` ${styles.stackedCard}` : ""}`;
  const focusButton = onFocus ? (
    <Button aria-label={t("cook.dish.focus", { dish: dish.title })} className={compact ? styles.stackedFocus : undefined} onClick={onFocus} variant="ghost">
      {t("cook.view.focusDish")}
      {compact ? <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 16 16" width="14"><path d="M4 12 12 4M5 4h7v7" /></svg> : null}
    </Button>
  ) : null;

  if (!step) {
    const lastResolved = [...dish.steps].reverse().find((item) => item.state === "completed" || item.state === "skipped");
    return (
      <section aria-label={dish.title} className={cardClassName} data-testid={compact ? "stacked-step" : "focused-step"}>
        <header className={styles.focusHeader}>
          <h2>{dish.title}</h2>
          {focusButton}
        </header>
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
    : compact && state === "timer_running"
      ? t("cook.dish.timerRunning")
      : compact && state === "timer_paused"
        ? t("cook.timer.paused")
        : step.attention_type === "passive"
          ? t("cook.attention.passive")
          : t("cook.attention.handsOn");

  const timerActions = <>
    {state === "timer_running" ? (
      <Button aria-label={t("cook.action.pause")} variant={compact ? "ghost" : "secondary"} onClick={() => onAction(step.id, "pause_timer")}>
        {t(compact ? "cook.action.pauseCompact" : "cook.action.pause")}
      </Button>
    ) : null}
    {state === "timer_paused" ? (
      <Button aria-label={t("cook.action.resume")} variant={compact ? "ghost" : "secondary"} onClick={() => onAction(step.id, "resume_timer")}>
        {t(compact ? "cook.action.resumeCompact" : "cook.action.resume")}
      </Button>
    ) : null}
    {showTimer ? (
      <Button aria-label={t("cook.action.extend")} variant={compact ? "ghost" : "secondary"} onClick={() => onAction(step.id, "extend_timer", 60)}>
        {t(compact ? "cook.action.extendCompact" : "cook.action.extend")}
      </Button>
    ) : null}
  </>;
  const stepActions = <>
    {step.attention_type === "passive" && step.duration_seconds != null && step.duration_seconds > 0 && state === "ready" ? (
      <Button onClick={() => onAction(step.id, "start_timer")}>{t("cook.action.startTimer")}</Button>
    ) : null}
    <Button onClick={() => onAction(step.id, "complete")}>{t("cook.action.complete")}</Button>
    <Button aria-label={t("cook.action.skip")} variant="ghost" onClick={() => onAction(step.id, "skip")}>
      {t(compact ? "cook.action.skipCompact" : "cook.action.skip")}
    </Button>
  </>;
  const progressBar = <span aria-hidden="true" className={styles.progressTrack}>
    <span style={{ inlineSize: `${progress}%` }} />
  </span>;
  const takeover = showAlertTakeover ? <aside className={styles.takeover}>
    <span>{t("cook.alerts.otherDevice")}</span>
    <Button onClick={() => onAction(step.id, "take_alert_ownership")} variant="secondary">
      {t("cook.alerts.takeOver")}
    </Button>
  </aside> : null;

  if (compact) return (
    <section aria-label={dish.title} className={cardClassName} data-testid="stacked-step">
      <div className={styles.stackedVisual}>
        <StepVisual compact key={step.id} step={step} thumbnailUrl={dish.thumbnail_url} />
      </div>
      <header className={styles.stackedHeading}>
        <p>{t("cook.step.number", { current: step.position + 1, total: dish.steps.length })}</p>
        <h2>{dish.title}</h2>
      </header>
      <div className={styles.stackedStatus}>
        <span className={state === "needs_attention" ? styles.attentionBadge : styles.stepBadge}>{stateLabel}</span>
        <p className={styles.stackedMobileMetadata}>{formatRecipeStepMetadata(step, t)}</p>
      </div>
      <div className={styles.stackedInstruction}>
        <p className={styles.stepText}>{step.text}</p>
        <p className={styles.stepMeta}>{formatRecipeStepMetadata(step, t)}</p>
      </div>
      <div className={styles.stackedControls}>
        {showTimer ? <div className={styles.stackedTimerPanel}>
          <CookingTimer step={{ ...step, state }} />
          {timerActions}
        </div> : null}
        <div className={styles.stepActions}>
          {stepActions}
          {focusButton}
        </div>
      </div>
      <div aria-label={t("cook.progress", { progress })} className={styles.stackedProgress}>
        {progressBar}
        <span className={styles.liveRegion}>{t("cook.progress", { progress })}</span>
      </div>
      {takeover}
    </section>
  );

  return (
    <section aria-label={dish.title} className={cardClassName} data-testid="focused-step">
      <div className={styles.focusGrid}>
        <StepVisual compact={false} key={step.id} step={step} thumbnailUrl={dish.thumbnail_url} />
        <div className={styles.stepBody}>
          <div className={styles.stepContext}>
            <span className={state === "needs_attention" ? styles.attentionBadge : styles.stepBadge}>{stateLabel}</span>
          </div>
          <h2 className={styles.stepText}>{step.text}</h2>
          <p className={styles.stepMeta}>{formatRecipeStepMetadata(step, t)}</p>
          {showTimer ? <CookingTimer step={{ ...step, state }} /> : null}
          <div className={styles.focusProgress}>
            {progressBar}
            <span>{t("cook.progress", { progress })}</span>
          </div>
          <div className={styles.stepActions}>{timerActions}{stepActions}</div>
        </div>
      </div>
      {takeover}
    </section>
  );
}
