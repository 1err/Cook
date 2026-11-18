"use client";

import { useEffect, useMemo, useState } from "react";
import type { RecipeAuthor, RecipeSummary } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { Icon } from "./ui/Icon";
import styles from "./RecipeAuthor.module.css";

export function AuthorFilters({ recipes, unfiltered, selected, onSelect }: {
  recipes: RecipeSummary[];
  unfiltered: boolean;
  selected: RecipeAuthor | null;
  onSelect: (author: RecipeAuthor | null) => void;
}) {
  const t = useT();
  const pageAuthors = useMemo(() => {
    const seen = new Map<string, RecipeAuthor>();
    for (const recipe of recipes) if (recipe.author) seen.set(recipe.author.id, recipe.author);
    return [...seen.values()].slice(0, 8);
  }, [recipes]);
  const [shortcuts, setShortcuts] = useState(pageAuthors);
  useEffect(() => { if (unfiltered) setShortcuts(pageAuthors); }, [pageAuthors, unfiltered]);
  // Choosing one shortcut should leave the others in place for a one-tap switch.
  const visible = unfiltered || !shortcuts.length ? pageAuthors : shortcuts;
  const chips = selected && !visible.some(author => author.id === selected.id)
    ? [selected, ...visible.slice(0, 7)] : visible;
  if (!chips.length) return null;
  return <div className={styles.shortcuts} role="group" aria-label={t("recipe.author.filter")}>
    {chips.map(author => {
      const active = selected?.id === author.id;
      return <button type="button" key={author.id} aria-pressed={active}
        onClick={() => onSelect(active ? null : author)}>
        <Icon name={active ? "check" : "account"} size={14} /><span>{author.name}</span>
      </button>;
    })}
  </div>;
}
