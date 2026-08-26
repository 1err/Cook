"use client";

import { useEffect, useMemo, useState } from "react";
import type { Recipe } from "@cooking/shared";
import { Button } from "../components/ui/Button";
import { webApiClient } from "../lib/api";
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
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    webApiClient.recipes.list()
      .then((items) => {
        if (!cancelled) setRecipes(items);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t("cook.add.error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const choices = useMemo(
    () => recipes.filter((recipe) => recipe.steps?.length && !existingRecipeIds.includes(recipe.id)),
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
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.dialogActions}>
          <Button disabled={busy} onClick={onClose} variant="secondary">{t("common.cancel")}</Button>
          <Button disabled={!selected.length} loading={busy} onClick={() => void submit()}>{t("cook.add.confirm")}</Button>
        </div>
      </section>
    </div>
  );
}
