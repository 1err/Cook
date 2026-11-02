"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { RecipeAuthor } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { useRecipeAuthors } from "../lib/useRecipeAuthors";
import { Icon } from "./ui/Icon";
import styles from "./AuthorFilterPopover.module.css";
import popover from "./TagFilterPopover.module.css";

export function AuthorFilterPopover({ selected, onSelect, ariaLabel }: {
  selected: RecipeAuthor | null;
  onSelect: (author: RecipeAuthor | null) => void;
  ariaLabel: string;
}) {
  const t = useT();
  const summaryId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const lookup = useRecipeAuthors(query, open);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 80, width: 320, maxHeight: 420 });

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 32);
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const openAbove = below < 280 && above > below;
      const maxHeight = Math.min(440, window.innerHeight - 32, Math.max(160, openAbove ? above : below));
      const top = openAbove ? rect.top - maxHeight - 8 : rect.bottom + 8;
      setPosition({ width, maxHeight,
        left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
        top: Math.max(16, Math.min(top, window.innerHeight - maxHeight - 16)),
      });
    }
    place();
    input.current?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
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

  function select(author: RecipeAuthor | null) {
    onSelect(author);
    close();
  }

  return <div ref={root} className={`author-filter-popover ${popover.root}`} onKeyDownCapture={event => {
    if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  }} onBlur={event => {
    if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className={`${popover.trigger} ${styles.trigger}`}
      aria-label={ariaLabel} aria-describedby={summaryId} aria-expanded={open} aria-haspopup="dialog"
      title={selected?.name ?? t("recipe.author.all")} data-active={selected ? "true" : undefined}
      onClick={() => { setQuery(""); setOpen(value => !value); }}>
      <span id={summaryId} className={styles.label}>{selected?.name ?? t("recipe.author.all")}</span>
      <span aria-hidden="true"><Icon name="chevronDown" size={16} /></span>
    </button>
    {open ? <div role="dialog" aria-label={t("recipe.author.filter")} className={`${popover.panel} ${styles.panel}`}
      style={{ position: "fixed", ...position }}>
      <div className={popover.heading}>
        <strong>{t("recipe.author.filter")}</strong>
        <button type="button" aria-label={t("common.close")} onClick={close}><Icon name="close" size={18} /></button>
      </div>
      <div className={styles.search}>
        <input ref={input} type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)}
          aria-label={t("recipe.author.search")} placeholder={t("recipe.author.search")} />
      </div>
      <div className={styles.results}>
        <button type="button" aria-pressed={!selected} onClick={() => select(null)}>{t("recipe.author.all")}</button>
        {lookup.loading ? <p role="status">{t("recipe.author.loading")}</p> : null}
        {lookup.error ? <div role="alert"><p>{t("recipe.author.lookupError")}</p><button type="button" onClick={lookup.retry}>{t("library.retry")}</button></div> : null}
        {lookup.authors.map(author => <button type="button" key={author.id} aria-pressed={selected?.id === author.id}
          onClick={() => select(author)}><strong>{author.name}</strong>{author.aliases.length ? <small>{author.aliases.join(" · ")}</small> : null}</button>)}
        {!lookup.loading && !lookup.error && lookup.authors.length === 0 ? <p>{t("recipe.author.empty")}</p> : null}
      </div>
    </div> : null}
  </div>;
}
