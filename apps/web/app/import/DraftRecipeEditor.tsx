"use client";

import { useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useT } from "../lib/i18n";
import {
  CATEGORY_LABELS,
  RECIPE_TAG_GROUPS,
  categoryBadgeStyle,
  type RecipeTagSlug,
} from "../lib/recipeCategories";
import type { IngredientItem, Recipe } from "../types";
import { StepListEditor } from "./StepListEditor";
import { StringListEditor } from "./StringListEditor";

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const text = await res.text();
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

async function uploadRecipeImage(file: File, errLabel: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch("/recipes/upload-image", { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, errLabel));
  }
  const { upload_url, file_url } = (await res.json()) as { upload_url: string; file_url: string };
  if (upload_url) {
    await fetch(upload_url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
  }
  return file_url;
}

export interface DraftRecipeEditorProps {
  draft: Recipe;
  onChange: (next: Recipe) => void;
  onBack: () => void;
  onSaveSuccess: (savedId: string) => void;
}

export function DraftRecipeEditor({
  draft,
  onChange,
  onBack,
  onSaveSuccess,
}: DraftRecipeEditorProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftTags = draft.library_tags ?? [];

  const previewText = useMemo(() => {
    const names = draft.ingredients.map((item) => item.name).filter(Boolean);
    return names.join(", ");
  }, [draft.ingredients]);

  function toggleDraftTag(tag: RecipeTagSlug) {
    const nextTags = draft.library_tags ?? [];
    onChange({
      ...draft,
      library_tags: nextTags.includes(tag)
        ? nextTags.filter((item) => item !== tag)
        : [...nextTags, tag],
    });
  }

  function updateDraftIngredient(index: number, field: keyof IngredientItem, value: string | null) {
    const nextIngredients = [...draft.ingredients];
    if (!nextIngredients[index]) return;
    nextIngredients[index] = { ...nextIngredients[index], [field]: value ?? "" };
    onChange({ ...draft, ingredients: nextIngredients });
  }

  function removeDraftIngredient(index: number) {
    onChange({
      ...draft,
      ingredients: draft.ingredients.filter((_, itemIndex) => itemIndex !== index),
    });
  }

  function addDraftIngredient() {
    onChange({
      ...draft,
      ingredients: [...draft.ingredients, { name: "", quantity: "", metric_quantity: "", notes: "" }],
    });
  }

  async function handleDraftImageFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingImage(true);
    try {
      const file_url = await uploadRecipeImage(file, t("common.upload"));
      onChange({ ...draft, thumbnail_url: file_url });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.upload"));
    } finally {
      setUploadingImage(false);
      event.target.value = "";
    }
  }

  async function handleSaveRecipe() {
    setError(null);
    setSaving(true);
    try {
      const res = await apiFetch("/recipes", {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          ingredients: draft.ingredients.filter((item) => item.name.trim()),
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, t("common.save")));
      }
      const saved: Recipe = await res.json();
      onSaveSuccess(saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="import-review-grid">
      <div>
        <div className="import-review-card recipe-card-stitch">
          <div className="recipe-card-stitch__media">
            {draft.thumbnail_url ? (
              <>
                <img src={draft.thumbnail_url} alt="" className="recipe-card-stitch__img recipe-card-stitch__img--bg" />
                <div className="recipe-card-stitch__img-frame">
                  <img src={draft.thumbnail_url} alt="" className="recipe-card-stitch__img recipe-card-stitch__img--full" />
                </div>
              </>
            ) : (
              <div className="recipe-card-stitch__placeholder recipeCardPlaceholder">
                <span className="font-headline recipe-card-stitch__placeholder-text">Recipe</span>
              </div>
            )}
            {draftTags[0] ? (
              <span className="recipe-card-stitch__badge font-headline" style={categoryBadgeStyle(draftTags[0])}>
                {CATEGORY_LABELS[draftTags[0]]}
              </span>
            ) : null}
          </div>
          <div className="recipe-card-stitch__meta">
            <div className="recipe-card-stitch__meta-left">
              <h2 className="font-headline recipe-card-stitch__title">{draft.title || t("import.untitledRecipe")}</h2>
              <p className="recipe-card-stitch__sub" title={previewText}>
                {previewText || t("import.reviewIngredientsReady")}
              </p>
              {draftTags.length > 0 ? (
                <div className="recipe-card-stitch__tag-row">
                  {draftTags.slice(0, 3).map((tag) => (
                    <span key={tag} className="recipe-card-stitch__tag-mini font-headline">
                      {CATEGORY_LABELS[tag]}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="import-review-panel">
        <section className="import-review-section">
          <label className="import-engine__label" htmlFor="draft-title">
            {t("recipe.recipeTitle")}
          </label>
          <input
            id="draft-title"
            className="import-engine__input import-engine__input--plain"
            type="text"
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            disabled={saving}
          />
        </section>

        <section className="import-review-section">
          <label className="field-label">{t("recipe.description")}</label>
          <textarea
            rows={3}
            maxLength={500}
            placeholder={t("recipe.description.placeholder")}
            value={draft.description ?? ""}
            onChange={(e) =>
              onChange({ ...draft, description: e.target.value })
            }
          />
          <div className="char-counter">
            {(draft.description ?? "").length} / 500
          </div>
        </section>

        <section className="import-review-section">
          <label className="field-label">{t("recipe.totalTime")}</label>
          <div className="inline-input-row">
            <input
              type="number"
              min={0}
              placeholder={t("recipe.totalTime.placeholder")}
              value={draft.total_time_minutes ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                const n = raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0));
                onChange({ ...draft, total_time_minutes: n });
              }}
            />
            <span className="suffix">{t("recipe.totalTime.minutesSuffix")}</span>
          </div>
        </section>

        <section className="import-review-section">
          <div className="import-review-section__head">
            <label className="import-engine__label" style={{ marginBottom: 0 }}>
              {t("common.ingredients")}
            </label>
            <button type="button" className="import-review-add font-headline" onClick={addDraftIngredient}>
              + {t("common.add")}
            </button>
          </div>
          <div className="import-review-ingredients">
            {draft.ingredients.map((ingredient, index) => (
              <div key={`${draft.id}-${index}`} className="import-review-ingredient-row">
                <div style={draftQtyStackStyle}>
                  <input
                    className="import-engine__input import-engine__input--plain"
                    type="text"
                    placeholder={t("recipe.qty")}
                    value={ingredient.quantity}
                    onChange={(e) => updateDraftIngredient(index, "quantity", e.target.value)}
                  />
                  <input
                    className="import-engine__input import-engine__input--plain"
                    type="text"
                    placeholder={t("recipe.metricQty")}
                    value={ingredient.metric_quantity ?? ""}
                    onChange={(e) => updateDraftIngredient(index, "metric_quantity", e.target.value)}
                  />
                </div>
                <input
                  className="import-engine__input import-engine__input--plain"
                  type="text"
                  placeholder={t("recipe.ingredient")}
                  value={ingredient.name}
                  onChange={(e) => updateDraftIngredient(index, "name", e.target.value)}
                />
                <button
                  type="button"
                  className="import-review-remove"
                  onClick={() => removeDraftIngredient(index)}
                  aria-label={t("recipe.removeIngredient")}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            ))}
          </div>
        </section>

        <StepListEditor
          steps={draft.steps ?? []}
          onChange={(steps) => onChange({ ...draft, steps })}
          uploadImage={(file) => uploadRecipeImage(file, t("common.upload"))}
        />

        <StringListEditor
          label={t("recipe.tips")}
          addLabel={t("recipe.tips.addRow")}
          placeholder={t("recipe.tips.placeholder")}
          values={draft.tips ?? []}
          onChange={(tips) => onChange({ ...draft, tips })}
        />

        <StringListEditor
          label={t("recipe.equipment")}
          addLabel={t("recipe.equipment.addRow")}
          placeholder={t("recipe.equipment.placeholder")}
          values={draft.equipment ?? []}
          onChange={(equipment) => onChange({ ...draft, equipment })}
        />

        <section className="import-review-section">
          <label className="import-engine__label">
            {t("common.tags")}
          </label>
          <div className="recipe-tag-picker recipe-tag-picker--compact">
            {RECIPE_TAG_GROUPS.map((group) => (
              <div key={group.id} className="recipe-tag-group">
                <p className="recipe-tag-group__title font-headline">{group.label}</p>
                <div className="recipe-tag-group__chips">
                  {group.tags.map((tag) => {
                    const active = draftTags.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`library-chip ${active ? "library-chip--active" : "library-chip--idle"}`}
                        onClick={() => toggleDraftTag(tag.id)}
                      >
                        {tag.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="import-review-section">
          <div className="import-review-section__head">
            <label className="import-engine__label" style={{ marginBottom: 0 }}>
              {t("recipe.coverImage")}
            </label>
            <button
              type="button"
              className="import-review-add font-headline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage}
            >
              {uploadingImage ? t("recipe.uploading") : t("import.uploadImage")}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleDraftImageFile}
            style={{ display: "none" }}
          />
          <input
            className="import-engine__input import-engine__input--plain"
            type="url"
            placeholder={t("import.orPasteImageUrl")}
            value={draft.thumbnail_url ?? ""}
            onChange={(e) => onChange({ ...draft, thumbnail_url: e.target.value })}
            disabled={uploadingImage || saving}
          />
        </section>

        {error ? (
          <p style={{ color: "var(--error)", fontSize: "0.9rem", marginTop: "0.5rem" }} role="alert">
            {error}
          </p>
        ) : null}

        <div className="import-engine__actions">
          <button
            type="button"
            className="import-engine__cta"
            onClick={handleSaveRecipe}
            disabled={saving}
          >
            {saving ? (
              <>
                {t("common.saving")}
                <span className="material-symbols-outlined ms-fill import-spin" style={{ fontSize: "1.25rem" }}>
                  progress_activity
                </span>
              </>
            ) : (
              <>
                {t("import.saveRecipe")}
                <span className="material-symbols-outlined" style={{ fontSize: "1.25rem" }}>
                  check
                </span>
              </>
            )}
          </button>
          <button
            type="button"
            className="import-review-secondary font-headline"
            onClick={onBack}
            disabled={saving}
          >
            {t("import.backToImport")}
          </button>
        </div>
      </div>
    </div>
  );
}

const draftQtyStackStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  minWidth: 132,
};
