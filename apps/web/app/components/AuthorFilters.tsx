"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RecipeAuthor } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { useRecipeAuthors } from "../lib/useRecipeAuthors";
import styles from "./RecipeAuthor.module.css";

/** Loaded-scope chips, plus directory search so later recipe pages remain reachable. */
export function AuthorFilters({ authors, selected, onSelect }: {
  authors: RecipeAuthor[]; selected: RecipeAuthor | null; onSelect: (author: RecipeAuthor | null) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const lookup = useRecipeAuthors(query, open);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 80, width: 300, maxHeight: 360 });
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 32);
      const top = Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - 200));
      setPosition({ width, top, left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), maxHeight: Math.min(420, window.innerHeight - top - 16) });
    }
    place();
    searchInput.current?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const chips = [...new Map([...(selected ? [selected] : []), ...authors].map(author => [author.id, author])).values()].slice(0, 8);
  return <div ref={root} className={styles.filter} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); } }} role="group" aria-label={t("recipe.author.filter")}>
    <span>{t("recipe.author.filter")}</span>
    <button type="button" aria-pressed={!selected} onClick={() => onSelect(null)}>{t("recipe.author.all")}</button>
    {chips.map(author => <button type="button" key={author.id} aria-pressed={selected?.id === author.id} onClick={() => onSelect(selected?.id === author.id ? null : author)}>{author.name}</button>)}
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary ref={trigger}>{t("recipe.author.search")}</summary>
      {open ? <div className={styles.filterSearch} style={{ position: "fixed", ...position }}>
        <input ref={searchInput} maxLength={200} aria-label={t("recipe.author.search")} value={query} onChange={event => setQuery(event.target.value)} type="search" />
        {lookup.loading ? <p role="status">{t("common.loading")}</p> : null}
        {lookup.error ? <div role="alert"><p>{t("recipe.author.lookupError")}</p><button type="button" onClick={lookup.retry}>{t("library.retry")}</button></div> : null}
        <ul className={styles.results}>{lookup.authors.map(author => <li key={author.id}><button type="button" onClick={() => { onSelect(author); setOpen(false); }}><strong>{author.name}</strong>{author.aliases.length ? <small>{author.aliases.join(" · ")}</small> : null}</button></li>)}</ul>
        {!lookup.loading && !lookup.error && lookup.authors.length === 0 ? <p className={styles.help}>{t("common.noMatches")}</p> : null}
      </div> : null}
    </details>
  </div>;
}
