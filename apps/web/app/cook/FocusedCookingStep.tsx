"use client";

import { useState } from "react";
import {
  formatRecipeStepMetadata,
  type CookingAction,
  type CookingDish,
  type CookingStep,
} from "@cooking/shared";
import { Button } from "../components/ui/Button";
import { RecipeStepIllustration } from "../components/RecipeStepIllustration";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";
import { CookingTimer } from "./CookingTimer";
import { getActiveCookingTimer, getCookingStepPosition, getDisplayedCookingStep } from "./cookingStepPosition";
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

export function FocusedCookingStep({ dish, layout = "focused", onAction, onFocus, showAlertTakeover = false, viewedStepId, onViewStep }: {
  dish: CookingDish;
  layout?: "focused" | "stacked";
  onAction: (stepId: string, action: CookingAction, extensionSeconds?: number) => void | Promise<void>;
  onFocus?: () => void;
  showAlertTakeover?: boolean;
  viewedStepId?: string | null;
  onViewStep?: (id: string) => void;
}) {
  const t = useT();
  const [localStepId, setLocalStepId] = useState<string | null>(null);
  const step = getDisplayedCookingStep(dish, viewedStepId ?? localStepId);
  const liveTimer = getActiveCookingTimer(dish);
  const compact = layout === "stacked";
  const cardClassName = `${styles.focusCard}${compact ? ` ${styles.stackedCard}` : ""}`;
  const focusButton = onFocus ? <Button aria-label={t("cook.dish.focus", { dish: dish.title })} className={compact ? styles.stackedFocus : undefined} onClick={onFocus} variant="ghost">
    {t("cook.view.focusDish")}{compact ? <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 16 16" width="14"><path d="M4 12 12 4M5 4h7v7" /></svg> : null}
  </Button> : null;
  if (!step) return <section aria-label={dish.title} className={cardClassName} data-testid={compact ? "stacked-step" : "focused-step"}>
    <header className={styles.focusHeader}><h2>{dish.title}</h2>{focusButton}</header><p>{t("cook.navigation.noSteps")}</p>
  </section>;

  const index = dish.steps.findIndex(item => item.id === step.id);
  const progress = getCookingStepPosition(dish, step.id);
  const isTimerStep = liveTimer?.id === step.id;
  const stateLabel = isTimerStep && liveTimer.state === "needs_attention" ? t("cook.attention.needsAttention")
    : compact && isTimerStep && liveTimer.state === "timer_running" ? t("cook.dish.timerRunning")
    : compact && isTimerStep && liveTimer.state === "timer_paused" ? t("cook.timer.paused")
    : t(step.attention_type === "passive" ? "cook.attention.passive" : "cook.attention.handsOn");
  const badgeClassName = isTimerStep && liveTimer.state === "needs_attention" ? styles.attentionBadge : styles.stepBadge;
  const canStartTimer = !liveTimer && step.attention_type === "passive" && step.duration_seconds != null && step.duration_seconds > 0 && step.duration_source !== "unknown";
  function viewStep(id: string) { if (onViewStep) onViewStep(id); else setLocalStepId(id); }
  const timerActions = <>
    {liveTimer?.state === "timer_running" ? <Button aria-label={t("cook.action.pause")} variant={compact ? "ghost" : "secondary"} onClick={() => onAction(liveTimer.id, "pause_timer")}>{t(compact ? "cook.action.pauseCompact" : "cook.action.pause")}</Button> : null}
    {liveTimer?.state === "timer_paused" ? <Button aria-label={t("cook.action.resume")} variant={compact ? "ghost" : "secondary"} onClick={() => onAction(liveTimer.id, "resume_timer")}>{t(compact ? "cook.action.resumeCompact" : "cook.action.resume")}</Button> : null}
    {liveTimer ? <><Button aria-label={t("cook.action.extend")} variant={compact ? "ghost" : "secondary"} onClick={() => onAction(liveTimer.id, "extend_timer", 60)}>{t(compact ? "cook.action.extendCompact" : "cook.action.extend")}</Button>
      <Button aria-label={t("cook.navigation.stopTimer")} variant="ghost" onClick={() => onAction(liveTimer.id, "stop_timer")}>{t("cook.navigation.stopTimer")}</Button></> : null}
    {canStartTimer ? <Button onClick={() => onAction(step.id, "start_timer")}>{t("cook.action.startTimer")}</Button> : null}
  </>;
  const timer = liveTimer ? <>{!isTimerStep ? <p className={styles.timerStepContext}>{t("cook.navigation.timerStep", { number: liveTimer.position + 1 })}</p> : null}<CookingTimer step={liveTimer} /></> : null;
  const progressBar = <span aria-hidden="true" className={styles.progressTrack}><span style={{ inlineSize: `${progress}%` }} /></span>;
  const takeover = showAlertTakeover && liveTimer ? <aside className={styles.takeover}><span>{t("cook.alerts.otherDevice")}</span><Button onClick={() => onAction(liveTimer.id, "take_alert_ownership")} variant="secondary">{t("cook.alerts.takeOver")}</Button></aside> : null;
  const navigation = <CookingStepNavigation dish={dish} step={step} timerStep={liveTimer} compact={compact}
    onPrevious={() => { if (index > 0) viewStep(dish.steps[index - 1].id); }}
    onNext={() => { if (index < dish.steps.length - 1) viewStep(dish.steps[index + 1].id); }}
    onViewStep={viewStep} onReturnToTimer={() => { if (liveTimer) viewStep(liveTimer.id); }} />;

  if (compact) return <section aria-label={dish.title} className={cardClassName} data-testid="stacked-step">
    <div className={styles.stackedVisual}><StepVisual compact key={step.id} step={step} thumbnailUrl={dish.thumbnail_url} /></div>
    <header className={styles.stackedHeading}><p>{t("cook.step.number", { current: index + 1, total: dish.steps.length })}</p><h2>{dish.title}</h2></header>
    <div className={styles.stackedStatus}><span className={badgeClassName}>{stateLabel}</span>{focusButton}<p className={styles.stackedMobileMetadata}>{formatRecipeStepMetadata(step, t)}</p></div>
    <div className={styles.stackedInstruction}><p className={styles.stepText}>{step.text}</p><p className={styles.stepMeta}>{formatRecipeStepMetadata(step, t)}</p></div>
    <div className={styles.stackedControls}>{liveTimer ? <div className={styles.stackedTimerPanel}>{timer}<div className={styles.stackedTimerActions}>{timerActions}</div></div> : null}<div className={styles.stepActions}>{!liveTimer ? timerActions : null}<span className={styles.mobileFocus}>{focusButton}</span></div></div>
    <div aria-label={t("cook.navigation.positionProgress", { progress })} className={styles.stackedProgress}>{progressBar}<span className={styles.liveRegion}>{t("cook.navigation.positionProgress", { progress })}</span></div>
    <div className={styles.stackedNavigation}>{navigation}</div>{takeover}
  </section>;

  return <section aria-label={dish.title} className={cardClassName} data-testid="focused-step">
    <div className={styles.focusGrid}><StepVisual compact={false} key={step.id} step={step} thumbnailUrl={dish.thumbnail_url} /><div className={styles.stepBody}>
      <div className={styles.stepContext}><span className={badgeClassName}>{stateLabel}</span><span className={styles.stepPosition}>{t("cook.step.number", { current: index + 1, total: dish.steps.length })}</span></div>
      <h2 className={styles.stepText}>{step.text}</h2><p className={styles.stepMeta}>{formatRecipeStepMetadata(step, t)}</p>{timer}
      <div className={styles.focusProgress}>{progressBar}<span>{t("cook.navigation.positionProgress", { progress })}</span></div>
      {liveTimer || canStartTimer ? <div className={styles.stepActions}>{timerActions}</div> : null}{navigation}
    </div></div>{takeover}
  </section>;
}
