"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatRecipeStepMetadata, type CookingDish, type CookingStep } from "@cooking/shared";
import { Button } from "../components/ui/Button";
import { useT } from "../lib/i18n";
import styles from "./CookingStepNavigation.module.css";

export function CookingStepNavigation({ dish, step, timerStep, compact, onPrevious, onNext, onViewStep, onReturnToTimer }: {
  dish: CookingDish;
  step: CookingStep;
  timerStep: CookingStep | null;
  compact: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onViewStep: (id: string) => void;
  onReturnToTimer: () => void;
}) {
  const t = useT();
  const id = useId();
  const [previewMode, setPreviewMode] = useState<"auto" | "pinned" | "closed">("auto");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const focusAfterSelection = useRef(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const index = dish.steps.findIndex(item => item.id === step.id);
  const upcoming = dish.steps.slice(index + 1, index + 4);
  const previewOpen = upcoming.length > 0 && (previewMode === "pinned" || (previewMode === "auto" && (hovered || focused))) && !overviewOpen;

  const isLast = index === dish.steps.length - 1;

  useEffect(() => {
    if (!focusAfterSelection.current) return;
    focusAfterSelection.current = false;
    const next = actionsRef.current?.querySelector<HTMLButtonElement>("button:last-child");
    if (next && !next.disabled) next.focus();
    else toolsRef.current?.querySelector<HTMLButtonElement>("[data-cooking-overview]")?.focus();
  }, [overviewOpen, step.id]);

  function closePanels() {
    if (overviewOpen) toolsRef.current?.querySelector<HTMLButtonElement>("[data-cooking-overview]")?.focus();
    setOverviewOpen(false);
    setPreviewMode("closed");
    setHovered(false);
    setFocused(false);
  }

  return (
    <div className={`${styles.navigation}${compact ? ` ${styles.compact}` : ""}`} onPointerLeave={() => { setHovered(false); setPreviewMode(mode => mode === "closed" ? "auto" : mode); }} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); closePanels(); }
    }}>
      {timerStep && timerStep.id !== step.id ? <div className={styles.browseNotice}>
        <Button variant="ghost" size="sm" onClick={onReturnToTimer}>{t("cook.navigation.returnTimer")}</Button>
      </div> : null}
      <div ref={actionsRef} className={styles.actions}>
        <Button aria-label={t("cook.navigation.previous")} disabled={index <= 0} onClick={onPrevious} variant="secondary">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8H4m4-4L4 8l4 4" /></svg>
          {t("cook.navigation.previousCompact")}
        </Button>
        <Button disabled={isLast} onClick={onNext}>
          {t("cook.navigation.next")}
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h8m-4-4 4 4-4 4" /></svg>
        </Button>
      </div>
      <div ref={toolsRef} className={styles.tools}>
        <div className={styles.peek} onPointerEnter={event => { if (event.pointerType === "mouse") { setHovered(true); setPreviewMode(mode => mode === "closed" ? "auto" : mode); } }} onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}>
          <Button aria-expanded={previewOpen} aria-controls={`${id}-upcoming`} disabled={!upcoming.length} leadingIcon="chevronDown" onFocus={() => { setFocused(true); setPreviewMode(mode => mode === "closed" ? "auto" : mode); }} onClick={() => { setPreviewMode(mode => mode === "pinned" ? "closed" : "pinned"); setFocused(false); setOverviewOpen(false); }} variant="ghost" size="sm">
            {t("cook.navigation.upNext")}
          </Button>
        </div>
        <Button data-cooking-overview aria-expanded={overviewOpen} aria-controls={`${id}-overview`} leadingIcon="menu" onClick={() => { setOverviewOpen(value => !value); setPreviewMode("closed"); }} variant="ghost" size="sm">
          {t("cook.navigation.overview")}
        </Button>
      </div>
      {previewOpen ? <section id={`${id}-upcoming`} aria-label={t("cook.navigation.upcomingLabel", { dish: dish.title })} className={styles.preview}>
        <p className={styles.panelEyebrow}>{t("cook.navigation.upNext")}</p>
        <ol className={styles.stepList}>
          {upcoming.map(item => <li key={item.id}>
            <span className={styles.stepNumber}>{item.position + 1}</span>
            <div><p>{item.text}</p><small>{formatRecipeStepMetadata(item, t)}</small></div>
          </li>)}
        </ol>
      </section> : null}
      {overviewOpen ? <section id={`${id}-overview`} aria-label={t("cook.navigation.overviewLabel", { dish: dish.title })} className={styles.overview}>
        <header><h3>{t("cook.navigation.overview")}</h3><Button aria-label={t("cook.navigation.closeOverview")} leadingIcon="close" onClick={closePanels} variant="ghost" size="sm" /></header>
        <ol className={styles.stepList}>
          {dish.steps.map(item => <li key={item.id}>
            <button aria-label={t("cook.navigation.viewStep", { number: item.position + 1, text: item.text })} aria-current={item.id === step.id ? "step" : undefined} className={styles.overviewStep} data-cooking-current={item.id === step.id || undefined} onClick={() => {
              focusAfterSelection.current = true;
              onViewStep(item.id);
              setOverviewOpen(false);
              setHovered(false);
              setFocused(false);
            }} type="button">
              <span className={styles.stepNumber}>{item.position + 1}</span>
              <span className={styles.overviewCopy}><span>{item.text}</span><small>{formatRecipeStepMetadata(item, t)}</small></span>
              {item.id === step.id ? <span className={styles.stepStatus}>{t("cook.navigation.viewing")}</span> : null}
            </button>
          </li>)}
        </ol>
      </section> : null}
    </div>
  );
}
