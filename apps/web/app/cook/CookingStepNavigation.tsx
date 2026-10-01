"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatRecipeStepMetadata, type CookingDish, type CookingStep } from "@cooking/shared";
import { Button } from "../components/ui/Button";
import { useT } from "../lib/i18n";
import styles from "./CookingStepNavigation.module.css";

export function CookingStepNavigation({ dish, step, currentStep, compact, advancing, onPrevious, onNext, onViewStep, onReturnToCurrent }: {
  dish: CookingDish;
  step: CookingStep;
  currentStep: CookingStep | null;
  compact: boolean;
  advancing: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onViewStep: (id: string) => void;
  onReturnToCurrent: () => void;
}) {
  const t = useT();
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const focusAfterSelection = useRef(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const index = dish.steps.findIndex(item => item.id === step.id);
  const upcoming = dish.steps.slice(index + 1, index + 4);
  const previewOpen = upcoming.length > 0 && (pinned || hovered || focused) && !overviewOpen;
  const isCurrent = currentStep?.id === step.id;
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
    setPinned(false);
    setHovered(false);
    setFocused(false);
  }

  return (
    <div className={`${styles.navigation}${compact ? ` ${styles.compact}` : ""}`} onPointerLeave={() => setHovered(false)} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); closePanels(); }
    }}>
      {currentStep && !isCurrent ? <div className={styles.browseNotice}>
        <Button variant="ghost" size="sm" onClick={onReturnToCurrent}>{t("cook.navigation.returnCurrent")}</Button>
      </div> : null}
      <div ref={actionsRef} className={styles.actions}>
        <Button aria-label={t("cook.navigation.previous")} disabled={index <= 0 || advancing} onClick={onPrevious} variant="secondary">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8H4m4-4L4 8l4 4" /></svg>
          {t("cook.navigation.previousCompact")}
        </Button>
        <Button disabled={advancing || (isLast && !isCurrent)} loading={advancing} onClick={onNext}>
          {t(isLast && isCurrent ? "cook.navigation.finishDish" : "cook.navigation.next")}
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h8m-4-4 4 4-4 4" /></svg>
        </Button>
      </div>
      <div ref={toolsRef} className={styles.tools}>
        <div className={styles.peek} onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }} onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}>
          <Button aria-expanded={previewOpen} aria-controls={`${id}-upcoming`} disabled={!upcoming.length} leadingIcon="chevronDown" onFocus={() => setFocused(true)} onClick={() => { setPinned(value => !value); setFocused(false); }} variant="ghost" size="sm">
            {t("cook.navigation.upNext")}
          </Button>
        </div>
        <Button data-cooking-overview aria-expanded={overviewOpen} aria-controls={`${id}-overview`} leadingIcon="menu" onClick={() => { setOverviewOpen(value => !value); setPinned(false); }} variant="ghost" size="sm">
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
            <button aria-label={t("cook.navigation.viewStep", { number: item.position + 1, text: item.text })} aria-current={item.id === step.id ? "step" : undefined} className={styles.overviewStep} data-cooking-current={item.id === currentStep?.id || undefined} onClick={() => {
              focusAfterSelection.current = true;
              onViewStep(item.id);
              setOverviewOpen(false);
              setHovered(false);
              setFocused(false);
            }} type="button">
              <span className={styles.stepNumber}>{item.position + 1}</span>
              <span className={styles.overviewCopy}><span>{item.text}</span><small>{formatRecipeStepMetadata(item, t)}</small></span>
              <span className={styles.stepStatus}>{t(item.id === currentStep?.id ? "cook.navigation.current" : item.state === "completed" || item.state === "skipped" ? "cook.navigation.done" : "cook.navigation.upcoming")}</span>
            </button>
          </li>)}
        </ol>
      </section> : null}
    </div>
  );
}
