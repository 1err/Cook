"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { RecipeAuthor } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { useRecipeAuthors } from "../lib/useRecipeAuthors";
import { Icon } from "./ui/Icon";
import styles from "./RecipeAuthor.module.css";

type Props = {
  query: string;
  onQueryChange: (query: string) => void;
  selected: RecipeAuthor | null;
  onSelect: (author: RecipeAuthor | null) => void;
  includeAll?: boolean;
  disabled?: boolean;
};

export function AuthorSearch({ query, onQueryChange, selected, onSelect, includeAll, disabled }: Props) {
  const t = useT();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const lookup = useRecipeAuthors(query);
  const options = includeAll && !query.trim() ? [null, ...lookup.authors] : lookup.authors;
  const activeOption = active !== null && active < options.length ? active : null;

  useLayoutEffect(() => {
    // Let touch users browse the list without immediately opening the software keyboard.
    if (!window.matchMedia?.("(pointer: coarse)").matches) input.current?.focus({ preventScroll: true });
  }, []);

  function navigate(index: number) {
    setActive(index);
    const row = list.current?.querySelectorAll<HTMLElement>('[role="option"]')[index];
    if (!list.current || !row) return;
    const bounds = list.current.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.top < bounds.top) list.current.scrollTop += item.top - bounds.top;
    if (item.bottom > bounds.bottom) list.current.scrollTop += item.bottom - bounds.bottom;
  }

  return <div className={styles.directory}>
    <div className={styles.searchField}>
      <Icon name="search" size={17} />
      <input ref={input} type="text" role="combobox" aria-autocomplete="list" aria-expanded="true"
        aria-controls={listId} aria-label={t("recipe.author.search")} placeholder={t("recipe.author.search")}
        aria-activedescendant={activeOption === null ? undefined : listId + "-" + activeOption}
        autoComplete="off" enterKeyHint="search" maxLength={200} value={query} disabled={disabled}
        onChange={event => { setActive(null); onQueryChange(event.target.value); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Enter") {
            event.preventDefault();
            if (activeOption !== null) onSelect(options[activeOption]);
            else if (query.trim() && options.length === 1) onSelect(options[0]);
          }
          if (!options.length || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          const last = options.length - 1;
          const next = event.key === "ArrowDown" ? (activeOption ?? -1) + 1 : (activeOption ?? options.length) - 1;
          navigate(next < 0 ? last : next > last ? 0 : next);
        }} />
      {query && <button type="button" className={styles.clearSearch} aria-label={t("recipe.author.clearSearch")}
        disabled={disabled} onClick={() => { setActive(null); onQueryChange(""); input.current?.focus(); }}>
        <Icon name="close" size={14} />
      </button>}
    </div>
    <div className={styles.options} id={listId} role="listbox" aria-label={t("recipe.author.filter")} ref={list}>
      {options.map((author, index) => {
        const isSelected = (author?.id ?? null) === (selected?.id ?? null);
        return <button key={author?.id ?? "all"} type="button" role="option" id={listId + "-" + index}
          className={styles.option} aria-selected={isSelected} data-highlighted={activeOption === index || undefined}
          disabled={disabled} onClick={() => onSelect(author)}>
          <span className={styles.monogram} aria-hidden="true">
            {author ? Array.from(author.name.trim())[0]?.toLocaleUpperCase() : <Icon name="book" size={17} />}
          </span>
          <span className={styles.identity}>
            <strong>{author?.name ?? t("recipe.author.all")}</strong>
            {author && author.aliases.length > 0 && <small>{author.aliases.join(" · ")}</small>}
          </span>
          {isSelected && <Icon name="check" size={17} />}
        </button>;
      })}
    </div>
    {lookup.loading && <p className={styles.directoryStatus} role="status">{t("recipe.author.loading")}</p>}
    {lookup.error && <div className={styles.directoryStatus} role="alert">{t("recipe.author.lookupError")} <button type="button" onClick={lookup.retry}>{t("library.retry")}</button></div>}
    {!lookup.loading && !lookup.error && !lookup.authors.length && <p className={styles.directoryStatus} role="status">
      {t(query.trim() ? "recipe.author.empty" : "recipe.author.directoryEmpty")}
    </p>}
  </div>;
}
