"use client";

import { isCompleteRecipeDraft } from "@cooking/shared";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/ui/Icon";
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
  disabled?: boolean;
  requireCompleteRecipe?: boolean;
  onChange: (next: Recipe) => void;
  onBack: () => void;
  onSaveSuccess: (savedId: string) => void;
}

export function DraftRecipeEditor({ draft, onChange, onBack, onSaveSuccess, requireCompleteRecipe = false, disabled = false }: DraftRecipeEditorProps) {
  const t = useT();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [savingRequest, setSaving] = useState(false);
  const saving = savingRequest || disabled;
  const [error, setError] = useState<string | null>(null);
  const [tutorialValid, setTutorialValid] = useState(true);
  const complete = !requireCompleteRecipe || isCompleteRecipeDraft(draft);
  const draftTags = draft.library_tags ?? [];

  function toggleDraftTag(tag: RecipeTagSlug) {
    onChange({
      ...draft,
      library_tags: draftTags.includes(tag)
        ? draftTags.filter((item) => item !== tag)
        : [...draftTags, tag],
    });
  }

  function updateDraftIngredient(index: number, field: "quantity" | "name" | "metric_quantity", value: string) {
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
    if (saving || !tutorialValid || !complete) return;
    setError(null);
    setSaving(true);
    try {
      const response = await apiFetch("/recipes", {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          ingredients: draft.ingredients.filter((item) => item.name.trim()),
          ...(requireCompleteRecipe ? { title: draft.title.trim(), steps: draft.steps?.filter(step => step.text.trim()) } : {}),
        }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, t("common.save")));
      const saved: Recipe = await response.json();
      if (mounted.current) onSaveSuccess(saved.id);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : t("common.save"));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className={styles.review} aria-busy={saving || undefined}>
      <div className={styles.reviewBackRow}>
        <button type="button" aria-label={t("import.backToSource")} onClick={onBack} disabled={saving}>← {t("import.backToSource")}</button>
      </div>

      <header className={styles.reviewHeader}>
        <div>
          <h1 className="cw-display">{t("import.reviewRecipe")}</h1>
          <p>{t("import.reviewPersonalize")}</p>
        </div>
        <button
          type="button"
          className={styles.saveButton}
          onClick={() => void handleSaveRecipe()}
          disabled={saving || !tutorialValid || !complete}
        >
          {saving ? t("common.saving") : t("import.saveRecipe")}
        </button>
      </header>

      {!complete ? <p>{t("import.manualRequired")}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.reviewColumns}>
        <aside className={styles.overviewColumn}>
          <h2 className={styles.overviewHeading}>{t("import.recipeDetails")}</h2>
          {draft.thumbnail_url ? <div className={styles.reviewImage}><img src={draft.thumbnail_url} alt="" /></div> : null}

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

          <div className={styles.reviewTags}>
            <p>{t("common.tags")}</p>
            {draftTags.length > 0 ? (
              <div className={styles.selectedTags}>
                {RECIPE_TAG_GROUPS.flatMap((group) => group.tags)
                  .filter((tag) => draftTags.includes(tag.id))
                  .map((tag) => <span key={tag.id}>{tag.label}</span>)}
              </div>
            ) : null}
            <details>
              <summary>{t("import.editTags")}</summary>
              <fieldset className={styles.tagPicker} aria-label={t("common.tags")} disabled={saving}>
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
            </details>
          </div>
        </aside>

        <div className={styles.contentColumn}>
          <section className={styles.editorSection}>
            <div className={styles.sectionHeader}>
              <h2 className="cw-display">{t("common.ingredients")}</h2>
              <button type="button" onClick={addDraftIngredient} disabled={saving}><Icon name="add" size={16} /> {t("common.add")}</button>
            </div>
            <p className={styles.conversionHint} id="draft-conversion-help">{t("recipe.metricQtyHelp")}</p>
            <div className={styles.ingredientRows}>
              {draft.ingredients.map((ingredient, index) => (
                <div key={`${draft.id}-${index}`} className={styles.ingredientRow}>
                  <label>
                    <span>{t("recipe.originalAmount")}</span>
                    <input
                      type="text"
                      aria-label={`${t("recipe.originalAmount")} ${index + 1}`}
                      placeholder={t("recipe.originalAmount")}
                      value={ingredient.quantity}
                      onChange={(event) => updateDraftIngredient(index, "quantity", event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <label>
                    <span>{t("recipe.ingredient")}</span>
                    <input
                      type="text"
                      aria-label={`${t("recipe.ingredient")} ${index + 1}`}
                      placeholder={t("recipe.ingredient")}
                      value={ingredient.name}
                      onChange={(event) => updateDraftIngredient(index, "name", event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <label className={styles.conversionField}>
                    <span>{t("recipe.metricQty")}</span>
                    <input
                      type="text"
                      aria-label={`${t("recipe.metricQty")} ${index + 1}`}
                      aria-describedby="draft-conversion-help"
                      placeholder="—"
                      value={ingredient.metric_quantity ?? ""}
                      onChange={(event) => updateDraftIngredient(index, "metric_quantity", event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeDraftIngredient(index)}
                    aria-label={t("recipe.removeIngredient")}
                    disabled={saving}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <StepListEditor
            sourceUrl={draft.source_url}
            steps={draft.steps ?? []}
            onChange={(steps) => onChange({ ...draft, steps })}
            onValidityChange={setTutorialValid}
            disabled={saving}
          />

          <StringListEditor
            label={t("recipe.tips")}
            addLabel={t("recipe.tips.addRow")}
            placeholder={t("recipe.tips.placeholder")}
            values={draft.tips ?? []}
            onChange={(tips) => onChange({ ...draft, tips })}
            collapsed
            disabled={saving}
          />

          <StringListEditor
            label={t("recipe.equipment")}
            addLabel={t("recipe.equipment.addRow")}
            placeholder={t("recipe.equipment.placeholder")}
            values={draft.equipment ?? []}
            onChange={(equipment) => onChange({ ...draft, equipment })}
            collapsed
            disabled={saving}
          />
        </div>
      </div>
    </div>
  );
}
