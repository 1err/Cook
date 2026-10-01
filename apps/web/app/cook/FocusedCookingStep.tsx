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
import { CookingStepNavigation } from "./CookingStepNavigation";

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
  onAction: (stepId: string, action: CookingAction, extensionSeconds?: number) => void | Promise<void>;
  onFocus?: () => void;
  showAlertTakeover?: boolean;
}) {
  const t = useT();
  const [viewedStepId, setViewedStepId] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState(false);
  const currentStep = getCurrentCookingStep(dish);
  const step = dish.steps.find(item => item.id === viewedStepId) ?? currentStep ?? dish.steps[dish.steps.length - 1];
  const progress = getDishProgress(dish);
  const compact = layout === "stacked";
  const cardClassName = `${styles.focusCard}${compact ? ` ${styles.stackedCard}` : ""}`;
  const focusButton = onFocus ? (
    <Button aria-label={t("cook.dish.focus", { dish: dish.title })} className={compact ? styles.stackedFocus : undefined} onClick={onFocus} variant="ghost">
      {t("cook.view.focusDish")}
      {compact ? <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 16 16" width="14"><path d="M4 12 12 4M5 4h7v7" /></svg> : null}
    </Button>
  ) : null;

  if (!step) return (
    <section aria-label={dish.title} className={cardClassName} data-testid={compact ? "stacked-step" : "focused-step"}>
      <header className={styles.focusHeader}><h2>{dish.title}</h2>{focusButton}</header>
      <p>{t("cook.dish.complete")}</p>
    </section>
  );

  const index = dish.steps.findIndex(item => item.id === step.id);
  const isCurrent = step.id === currentStep?.id;
  const currentState = currentStep ? getEffectiveStepState(currentStep) : null;
  const liveTimer = currentStep && currentState && ["timer_running", "timer_paused", "needs_attention"].includes(currentState)
    ? { ...currentStep, state: currentState }
    : null;
  const stateLabel = !currentStep
    ? t("cook.dish.complete")
    : !isCurrent
      ? t(index < dish.steps.findIndex(item => item.id === currentStep.id) ? "cook.navigation.reviewing" : "cook.navigation.lookingAhead")
      : currentState === "needs_attention"
        ? t("cook.attention.needsAttention")
        : compact && currentState === "timer_running"
          ? t("cook.dish.timerRunning")
          : compact && currentState === "timer_paused"
            ? t("cook.timer.paused")
            : step.attention_type === "passive"
              ? t("cook.attention.passive")
              : t("cook.attention.handsOn");
  const badgeClassName = `${currentState === "needs_attention" && isCurrent ? styles.attentionBadge : styles.stepBadge}${!currentStep || !isCurrent ? ` ${styles.navigationStatus}` : ""}`;
  const canStartTimer = isCurrent && currentState === "ready" && step.attention_type === "passive" && step.duration_seconds != null && step.duration_seconds > 0;

  function viewStep(id: string) {
    setViewedStepId(id === currentStep?.id ? null : id);
    setAdvanceError(false);
  }

  async function nextStep() {
    if (advancing) return;
    if (!isCurrent) {
      const next = dish.steps[index + 1];
      if (next) viewStep(next.id);
      return;
    }
    setViewedStepId(null);
    setAdvanceError(false);
    setAdvancing(true);
    try {
      await onAction(step.id, "complete");
    } catch {
      setAdvanceError(true);
    } finally {
      setAdvancing(false);
    }
  }

  const timerActions = <>
    {currentStep && currentState === "timer_running" ? <Button aria-label={t("cook.action.pause")} disabled={advancing} variant={compact ? "ghost" : "secondary"} onClick={() => onAction(currentStep.id, "pause_timer")}>
      {t(compact ? "cook.action.pauseCompact" : "cook.action.pause")}
    </Button> : null}
    {currentStep && currentState === "timer_paused" ? <Button aria-label={t("cook.action.resume")} disabled={advancing} variant={compact ? "ghost" : "secondary"} onClick={() => onAction(currentStep.id, "resume_timer")}>
      {t(compact ? "cook.action.resumeCompact" : "cook.action.resume")}
    </Button> : null}
    {liveTimer ? <Button aria-label={t("cook.action.extend")} disabled={advancing} variant={compact ? "ghost" : "secondary"} onClick={() => onAction(liveTimer.id, "extend_timer", 60)}>
      {t(compact ? "cook.action.extendCompact" : "cook.action.extend")}
    </Button> : null}
    {canStartTimer ? <Button disabled={advancing} onClick={() => onAction(step.id, "start_timer")}>{t("cook.action.startTimer")}</Button> : null}
  </>;
  const timer = liveTimer ? <>
    {!isCurrent ? <p className={styles.timerStepContext}>{t("cook.navigation.timerStep", { number: liveTimer.position + 1 })}</p> : null}
    <CookingTimer step={liveTimer} />
  </> : null;
  const progressBar = <span aria-hidden="true" className={styles.progressTrack}><span style={{ inlineSize: `${progress}%` }} /></span>;
  const takeover = showAlertTakeover && currentStep ? <aside className={styles.takeover}>
    <span>{t("cook.alerts.otherDevice")}</span>
    <Button disabled={advancing} onClick={() => onAction(currentStep.id, "take_alert_ownership")} variant="secondary">{t("cook.alerts.takeOver")}</Button>
  </aside> : null;
  const navigation = <>
    {advanceError ? <p className={styles.error} role="alert">{t("cook.navigation.advanceFailed")}</p> : null}
    <CookingStepNavigation dish={dish} step={step} currentStep={currentStep} compact={compact} advancing={advancing}
      onPrevious={() => { if (index > 0) viewStep(dish.steps[index - 1].id); }}
      onNext={() => void nextStep()}
      onViewStep={viewStep}
      onReturnToCurrent={() => { setViewedStepId(null); setAdvanceError(false); }} />
  </>;

  if (compact) return (
    <section aria-label={dish.title} className={cardClassName} data-testid="stacked-step">
      <div className={styles.stackedVisual}><StepVisual compact key={step.id} step={step} thumbnailUrl={dish.thumbnail_url} /></div>
      <header className={styles.stackedHeading}><p>{t("cook.step.number", { current: step.position + 1, total: dish.steps.length })}</p><h2>{dish.title}</h2></header>
      <div className={styles.stackedStatus}>
        <span className={badgeClassName}>{stateLabel}</span>
        <p className={styles.stackedMobileMetadata}>{formatRecipeStepMetadata(step, t)}</p>
      </div>
      <div className={styles.stackedInstruction}><p className={styles.stepText}>{step.text}</p><p className={styles.stepMeta}>{formatRecipeStepMetadata(step, t)}</p></div>
      <div className={styles.stackedControls}>
        {liveTimer ? <div className={styles.stackedTimerPanel}>{timer}{timerActions}</div> : null}
        <div className={styles.stepActions}>{!liveTimer ? timerActions : null}{focusButton}</div>
      </div>
      <div aria-label={t("cook.progress", { progress })} className={styles.stackedProgress}>{progressBar}<span className={styles.liveRegion}>{t("cook.progress", { progress })}</span></div>
      <div className={styles.stackedNavigation}>{navigation}</div>
      {takeover}
    </section>
  );

  return (
    <section aria-label={dish.title} className={cardClassName} data-testid="focused-step">
      <div className={styles.focusGrid}>
        <StepVisual compact={false} key={step.id} step={step} thumbnailUrl={dish.thumbnail_url} />
        <div className={styles.stepBody}>
          <div className={styles.stepContext}>
            <span className={badgeClassName}>{stateLabel}</span>
            <span className={styles.stepPosition}>{t("cook.step.number", { current: step.position + 1, total: dish.steps.length })}</span>
          </div>
          <h2 className={styles.stepText}>{step.text}</h2>
          <p className={styles.stepMeta}>{formatRecipeStepMetadata(step, t)}</p>
          {timer}
          <div className={styles.focusProgress}>{progressBar}<span>{t("cook.progress", { progress })}</span></div>
          {liveTimer || canStartTimer ? <div className={styles.stepActions}>{timerActions}</div> : null}
          {navigation}
        </div>
      </div>
      {takeover}
    </section>
  );
}
