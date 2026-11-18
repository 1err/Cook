"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { RecipeAuthor } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { AuthorSearch } from "./AuthorSearch";
import { Icon } from "./ui/Icon";
import styles from "./AuthorFilterPopover.module.css";
import popover from "./TagFilterPopover.module.css";

export function AuthorFilterPopover({ selected, onSelect, ariaLabel }: {
  selected: RecipeAuthor | null;
  onSelect: (author: RecipeAuthor | null) => void;
  ariaLabel: string;
}) {
  const t = useT();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<CSSProperties>({});

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    function place() {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth);
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight);
      const width = Math.min(336, rightEdge - leftEdge - 24);
      const below = bottomEdge - rect.bottom - 20;
      const above = rect.top - topEdge - 20;
      const flip = below < 250 && above > below;
      setPosition({
        width,
        left: Math.max(leftEdge + 12, Math.min(rect.left, rightEdge - width - 12)),
        maxHeight: Math.max(0, Math.min(400, flip ? above : below)),
        ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    }
    place();
    if (window.matchMedia?.("(pointer: coarse)").matches) panel.current?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return <div ref={root} className={"author-filter-popover " + popover.root}
    onKeyDownCapture={event => {
      if (open && event.key === "Escape" && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); close();
      }
    }}
    onBlur={event => {
      if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
    <button type="button" ref={trigger} className={popover.trigger + " " + styles.trigger}
      aria-label={ariaLabel} aria-describedby={id + "-label"} aria-expanded={open} aria-haspopup="dialog"
      aria-controls={open ? id : undefined} title={selected?.name ?? t("recipe.author.all")}
      data-active={selected ? true : undefined} onClick={() => { setQuery(""); setOpen(current => !current); }}>
      <span className={styles.triggerIcon}><Icon name="account" size={17} /></span>
      <span className={styles.label} id={id + "-label"}>{selected?.name ?? t("recipe.author.all")}</span>
      <span className={styles.chevron}><Icon name="chevronDown" size={15} /></span>
    </button>
    {open && <div id={id} tabIndex={-1} ref={panel} role="dialog" aria-label={t("recipe.author.filter")}
      className={popover.panel + " " + styles.panel} style={position}>
      <div className={styles.heading}>
        <strong>{t("recipe.author.filter")}</strong>
        <button type="button" aria-label={t("common.close")} onClick={close}><Icon name="close" size={16} /></button>
      </div>
      <AuthorSearch includeAll selected={selected} query={query} onQueryChange={setQuery}
        onSelect={author => { onSelect(author); close(); }} />
    </div>}
  </div>;
}
