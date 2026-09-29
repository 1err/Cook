"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Recipe } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { getRecipeTimingPresentation } from "../lib/recipeTiming";
import styles from "./RecipeTiming.module.css";

type Props = Pick<Recipe, "total_time_minutes" | "timing_summary">;
type Presentation = ReturnType<typeof getRecipeTimingPresentation>;

function TimingDisclosure({ label, timing }: { label: string; timing: Presentation }) {
  const t = useT();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const focused = useRef(false);
  const hovered = useRef(false);
  const pointerFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 280, maxHeight: 400 });

  function cancelClose() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }
  function close() {
    cancelClose();
    pinned.current = false;
    hovered.current = false;
    setOpen(false);
  }
  function enter() {
    cancelClose();
    hovered.current = true;
    setOpen(true);
  }
  function leave() {
    hovered.current = false;
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (!hovered.current && !focused.current && !pinned.current) setOpen(false);
    }, 150);
  }

  useEffect(() => () => cancelClose(), []);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !tooltip.current?.contains(target)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 24);
      const maxHeight = Math.max(80, window.innerHeight - 24);
      const height = Math.min(tooltip.current?.getBoundingClientRect().height || 120, maxHeight);
      const above = window.innerHeight - rect.bottom < height + 8 && rect.top > height + 8;
      setPosition({ width, maxHeight,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(above ? rect.top - height - 8 : rect.bottom + 8, window.innerHeight - height - 12)),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, label, timing.handsOnLabel, timing.passiveLabel, timing.estimatePrefix]);

  return <>
    <button ref={trigger} type="button" className={styles.trigger}
      aria-label={t("recipe.timing.detailsLabel", { time: label })}
      aria-expanded={open} aria-describedby={open ? id : undefined}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") enter(); }}
      onPointerLeave={leave}
      onPointerDown={() => { pointerFocus.current = true; }}
      onPointerCancel={() => { pointerFocus.current = false; }}
      onFocus={() => { focused.current = true; if (!pointerFocus.current) { cancelClose(); setOpen(true); } }}
      onBlur={(event) => {
        focused.current = false;
        pointerFocus.current = false;
        if (!hovered.current && !tooltip.current?.contains(event.relatedTarget as Node | null)) close();
      }}
      onClick={() => { pointerFocus.current = false; cancelClose(); pinned.current = !pinned.current; setOpen(pinned.current); }}
    >{label}</button>
    {open ? createPortal(
      <div ref={tooltip} id={id} role="tooltip" className={styles.tooltip} style={position}
        onPointerEnter={enter} onPointerLeave={leave}>
        <p className={styles.breakdown}>
          {timing.estimatePrefix ? <><span>{timing.estimatePrefix}</span>{" "}</> : null}
          {timing.handsOnLabel ? <><strong>{timing.handsOnLabel}</strong>{" · "}</> : null}
          {!timing.handsOnLabel && timing.totalLabel ? <><span>{t("recipe.timing.total", { duration: timing.totalLabel })}</span><br /></> : null}
          <span>{timing.passiveLabel}</span>
        </p>
      </div>, document.body,
    ) : null}
  </>;
}

/** Quiet library label with the same recorded-time guards as the recipe details. */
export function RecipeTiming(recipe: Props) {
  const t = useT();
  const timing = getRecipeTimingPresentation(recipe, t);
  const label = timing.totalLabel ?? (timing.passiveLabel
    ? `${timing.estimatePrefix ? `${timing.estimatePrefix} ` : ""}${timing.passiveLabel}` : null);
  if (!label) return null;
  return <p className={styles.timing}>
    {timing.hasDetails ? <TimingDisclosure label={label} timing={timing} /> : label}
  </p>;
}
