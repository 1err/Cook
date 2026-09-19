"use client";

import { useMemo, useState } from "react";
import { useRecipePage } from "../lib/useRecipePage";
import { Button } from "../components/ui/Button";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";

export function AddDishDialog({
  existingRecipeIds,
  onAdd,
  onClose,
}: {
  existingRecipeIds: string[];
  onAdd: (recipeIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const page = useRecipePage("mine", {q: search});
  const recipes = page.items;
  const loading = page.loading && !recipes.length;
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = useMemo(
    () => recipes.filter((recipe) => recipe.step_count && !existingRecipeIds.includes(recipe.id)),
    [existingRecipeIds, recipes],
  );

  async function submit() {
    if (!selected.length) return;
    setBusy(true);
    await onAdd(selected);
    setBusy(false);
    onClose();
  }

  return (
    <div className={styles.dialogBackdrop}>
      <section aria-label={t("cook.add.title")} aria-modal="true" className={styles.dialog} role="dialog">
        <h2>{t("cook.add.title")}</h2>
        <input aria-label="Search recipes" type="search" value={search} onChange={event => setSearch(event.target.value)} />
        {loading ? <p role="status">{t("common.loading")}</p> : (
          <div className={styles.recipeChoices}>
            {choices.map((recipe) => (
              <label className={styles.recipeChoice} key={recipe.id}>
                <input
                  checked={selected.includes(recipe.id)}
                  onChange={() => setSelected((current) =>
                    current.includes(recipe.id)
                      ? current.filter((id) => id !== recipe.id)
                      : [...current, recipe.id]
                  )}
                  type="checkbox"
                />
                <span>{recipe.title}</span>
              </label>
            ))}
            {!choices.length ? <p>{t("cook.add.empty")}</p> : null}
          </div>
        )}
        {page.next ? <Button disabled={page.loading} onClick={() => void page.more()}>{t("common.loadMoreRecipes")}</Button> : null}
        {page.error ? <p role="alert">{page.error}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.dialogActions}>
          <Button disabled={busy} onClick={onClose} variant="secondary">{t("common.cancel")}</Button>
          <Button disabled={!selected.length} loading={busy} onClick={() => void submit()}>{t("cook.add.confirm")}</Button>
        </div>
      </section>
    </div>
  );
}
