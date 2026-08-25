"use client";

import { useState } from "react";
import { apiFetch } from "../lib/api";
import { useT } from "../lib/i18n";
import { RECIPE_TAG_GROUPS, type RecipeTagSlug } from "../lib/recipeCategories";
import type { IngredientItem, Recipe } from "../types";
import { StepListEditor } from "./StepListEditor";
import { StringListEditor } from "./StringListEditor";
import styles from "./ImportFlow.module.css";

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    if (!text.trim()) return fallback;
    try {
      const data = JSON.parse(text);
      if (data && typeof data === "object" && typeof data.detail === "string" && data.detail.trim()) {
        return data.detail;
      }
    } catch {
      return text;
    }
    return text;
  } catch {
    return fallback;
  }
}

export interface DraftRecipeEditorProps {
  draft: Recipe;
  onChange: (next: Recipe) => void;
  onBack: () => void;
  onSaveSuccess: (savedId: string) => void;
}

export function DraftRecipeEditor({ draft, onChange, onBack, onSaveSuccess }: DraftRecipeEditorProps) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftTags = draft.library_tags ?? [];

  function toggleDraftTag(tag: RecipeTagSlug) {
    onChange({
      ...draft,
      library_tags: draftTags.includes(tag)
        ? draftTags.filter((item) => item !== tag)
        : [...draftTags, tag],
    });
  }

  function updateDraftIngredient(index: number, field: "quantity" | "name", value: string) {
    const nextIngredients = [...draft.ingredients];
    if (!nextIngredients[index]) return;
    nextIngredients[index] = { ...nextIngredients[index], [field]: value };
    onChange({ ...draft, ingredients: nextIngredients });
  }

  function removeDraftIngredient(index: number) {
    onChange({ ...draft, ingredients: draft.ingredients.filter((_, itemIndex) => itemIndex !== index) });
  }

  function addDraftIngredient() {
    const ingredient: IngredientItem = { name: "", quantity: "", metric_quantity: "", notes: "" };
    onChange({ ...draft, ingredients: [...draft.ingredients, ingredient] });
  }

  async function handleSaveRecipe() {
    setError(null);
    setSaving(true);
    try {
      const response = await apiFetch("/recipes", {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          ingredients: draft.ingredients.filter((item) => item.name.trim()),
        }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, t("common.save")));
      const saved: Recipe = await response.json();
      onSaveSuccess(saved.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("common.save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.review}>
      <div className={styles.reviewBackRow}>
        <button type="button" aria-label="Back to source" onClick={onBack} disabled={saving}>← Back to source</button>
      </div>

      <header className={styles.reviewHeader}>
        <h1 className="cw-display">Review recipe</h1>
        <button
          type="button"
          className={styles.saveButton}
          onClick={() => void handleSaveRecipe()}
          disabled={saving}
        >
          {saving ? t("common.saving") : t("import.saveRecipe")}
        </button>
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.reviewColumns}>
        <aside className={styles.overviewColumn}>
          <div className={styles.reviewImage}>
            {draft.thumbnail_url ? <img src={draft.thumbnail_url} alt="" /> : <span className="cw-display">CW</span>}
          </div>

          <div className={styles.field}>
            <label htmlFor="draft-title">{t("recipe.recipeTitle")}</label>
            <input
              id="draft-title"
              type="text"
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              disabled={saving}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="draft-description">{t("recipe.description")}</label>
            <textarea
              id="draft-description"
              rows={4}
              maxLength={500}
              value={draft.description ?? ""}
              onChange={(event) => onChange({ ...draft, description: event.target.value })}
              disabled={saving}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="draft-total-time">{t("recipe.totalTime")}</label>
            <div className={styles.timeField}>
              <input
                id="draft-total-time"
                type="number"
                min={0}
                value={draft.total_time_minutes ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  onChange({
                    ...draft,
                    total_time_minutes: raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0)),
                  });
                }}
                disabled={saving}
              />
              <span>{t("recipe.totalTime.minutesSuffix")}</span>
            </div>
          </div>

          <fieldset className={styles.tagPicker}>
            <legend>{t("common.tags")}</legend>
            {RECIPE_TAG_GROUPS.map((group) => (
              <div key={group.id}>
                <p>{group.label}</p>
                <div>
                  {group.tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={draftTags.includes(tag.id)}
                      onClick={() => toggleDraftTag(tag.id)}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        </aside>

        <div className={styles.contentColumn}>
          <section className={styles.editorSection}>
            <div className={styles.sectionHeader}>
              <h2 className="cw-display">{t("common.ingredients")}</h2>
              <button type="button" onClick={addDraftIngredient}>+ {t("common.add")}</button>
            </div>
            <div className={styles.ingredientRows}>
              {draft.ingredients.map((ingredient, index) => (
                <div key={`${draft.id}-${index}`} className={styles.ingredientRow}>
                  <input
                    type="text"
                    aria-label={`Ingredient ${index + 1} amount`}
                    placeholder={t("recipe.qty")}
                    value={ingredient.quantity}
                    onChange={(event) => updateDraftIngredient(index, "quantity", event.target.value)}
                  />
                  <input
                    type="text"
                    aria-label={`Ingredient ${index + 1}`}
                    placeholder={t("recipe.ingredient")}
                    value={ingredient.name}
                    onChange={(event) => updateDraftIngredient(index, "name", event.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeDraftIngredient(index)}
                    aria-label={t("recipe.removeIngredient")}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>

          <StepListEditor
            steps={draft.steps ?? []}
            onChange={(steps) => onChange({ ...draft, steps })}
          />

          <StringListEditor
            label={t("recipe.tips")}
            addLabel={t("recipe.tips.addRow")}
            placeholder={t("recipe.tips.placeholder")}
            values={draft.tips ?? []}
            onChange={(tips) => onChange({ ...draft, tips })}
            collapsed
          />

          <StringListEditor
            label={t("recipe.equipment")}
            addLabel={t("recipe.equipment.addRow")}
            placeholder={t("recipe.equipment.placeholder")}
            values={draft.equipment ?? []}
            onChange={(equipment) => onChange({ ...draft, equipment })}
            collapsed
          />
        </div>
      </div>
    </div>
  );
}
