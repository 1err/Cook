"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { uploadRecipeImage } from "../../lib/uploadRecipeImage";
import { RequireAuth } from "../../components/RequireAuth";
import { PageShell } from "../../components/PageShell";
import { useT } from "../../lib/i18n";
import {
  CATEGORY_LABELS,
  RECIPE_TAG_GROUPS,
  type RecipeTagSlug,
} from "../../lib/recipeCategories";
import { getRecipeTags } from "../../lib/recipeTags";
import type { Recipe, IngredientItem, RecipeStep } from "../../types";
import { StepListEditor } from "../../import/StepListEditor";
import { StringListEditor } from "../../import/StringListEditor";
import styles from "./RecipeEdit.module.css";

function RecipeEditContent() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [title, setTitle] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [libraryTags, setLibraryTags] = useState<RecipeTagSlug[]>([]);
  const [ingredients, setIngredients] = useState<IngredientItem[]>([]);
  const [description, setDescription] = useState("");
  const [totalTimeMinutes, setTotalTimeMinutes] = useState<number | null>(null);
  const [steps, setSteps] = useState<RecipeStep[]>([]);
  const [stepsValid, setStepsValid] = useState(true);
  const [tips, setTips] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [canManageCatalog, setCanManageCatalog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch(`/recipes/${id}`);
        if (!res.ok) throw new Error("Recipe not found");
        const data: Recipe = await res.json();
        const nextTags = getRecipeTags(data);
        if (!cancelled) {
          setRecipe(data);
          setTitle(data.title);
          setThumbnailUrl(data.thumbnail_url ?? "");
          setLibraryTags(nextTags);
          setIngredients(data.ingredients?.length ? [...data.ingredients] : []);
          setDescription(data.description ?? "");
          setTotalTimeMinutes(typeof data.total_time_minutes === "number" ? data.total_time_minutes : null);
          setSteps(Array.isArray(data.steps) ? data.steps.map((s) => ({ ...s })) : []);
          setTips(Array.isArray(data.tips) ? [...data.tips] : []);
          setEquipment(Array.isArray(data.equipment) ? [...data.equipment] : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function loadCatalogStatus() {
      try {
        const res = await apiFetch("/recipes/catalog/editor-status");
        if (!res.ok) return;
        const data = (await res.json()) as { can_manage?: boolean };
        if (!cancelled) setCanManageCatalog(Boolean(data.can_manage));
      } catch {
        if (!cancelled) setCanManageCatalog(false);
      }
    }
    loadCatalogStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateIngredient(index: number, field: keyof IngredientItem, value: string | null) {
    setIngredients((prev) => {
      const next = [...prev];
      if (!next[index]) return next;
      next[index] = { ...next[index], [field]: value ?? "" };
      return next;
    });
  }

  function removeIngredient(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  function addIngredient() {
    setIngredients((prev) => [...prev, { name: "", quantity: "", metric_quantity: "", notes: null }]);
  }

  function toggleTag(tag: RecipeTagSlug) {
    setLibraryTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  }

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingImage(true);
    try {
      const file_url = await uploadRecipeImage(file, t("common.upload"));
      setThumbnailUrl(file_url ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingImage(false);
      e.target.value = "";
    }
  }

  async function handleSave() {
    if (!id || !stepsValid) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim() || recipe?.title,
        thumbnail_url: thumbnailUrl.trim() || null,
        ingredients: ingredients.filter((i) => i.name.trim() !== ""),
        library_tags: libraryTags,
        description: description.trim() || null,
        total_time_minutes: totalTimeMinutes,
        steps,
        tips,
        equipment,
      };
      const res = await apiFetch(`/recipes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save");
      router.push("/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !recipe) return;
    if (!confirm(`Delete “${recipe.title}”?`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await apiFetch(`/recipes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      router.push("/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function handleCatalogToggle() {
    if (!id || !recipe) return;
    setCatalogSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/recipes/${id}/catalog`, {
        method: "POST",
        body: JSON.stringify({ is_public: !recipe.is_public_catalog }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Could not update public library");
      }
      const updated: Recipe = await res.json();
      setRecipe(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update public library");
    } finally {
      setCatalogSaving(false);
    }
  }

  if (loading) return <p className={styles.status}>{t("common.loading")}</p>;
  if (error && !recipe) return <p className={styles.error}>{error}</p>;
  if (!recipe) return null;

  return (
    <div className={styles.editor}>
      <Link href="/library" className={styles.back}>← {t("nav.library")}</Link>

      <header className={styles.pageHeader}>
        <h1>{t("recipe.editRecipeTitle")}</h1>
        <div className={styles.headerActions}>
          <button type="button" className={styles.cancelButton} onClick={() => router.push("/library")}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSave}
            disabled={saving || !stepsValid}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.workflow}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>{t("recipe.basicDetails")}</h2>
          </div>
          <div className={styles.basicGrid}>
            <div className={styles.basicFields}>
              <label className={styles.field}>
                <span>{t("recipe.recipeTitle")}</span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Lemon garlic salmon"
                />
              </label>

              <label className={styles.field}>
                <span>{t("recipe.description")}</span>
                <textarea
                  rows={4}
                  maxLength={500}
                  placeholder={t("recipe.description.placeholder")}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <small>{description.length} / 500</small>
              </label>

              <label className={`${styles.field} ${styles.timeField}`}>
                <span>{t("recipe.totalTime")}</span>
                <span className={styles.timeControl}>
                  <input
                    type="number"
                    min={0}
                    placeholder={t("recipe.totalTime.placeholder")}
                    value={totalTimeMinutes ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setTotalTimeMinutes(raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0)));
                    }}
                  />
                  <span>{t("recipe.totalTime.minutesSuffix")}</span>
                </span>
              </label>
            </div>

            <div className={styles.coverEditor}>
              <span className={styles.controlLabel}>{t("recipe.coverImage")}</span>
              <div className={styles.coverPreview}>
                {thumbnailUrl.trim() ? (
                  <img src={thumbnailUrl.trim()} alt="" />
                ) : (
                  <span aria-hidden>CW</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageFile}
                className={styles.hiddenInput}
                tabIndex={-1}
                aria-hidden
              />
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
              >
                {uploadingImage ? t("recipe.uploading") : t("common.upload")}
              </button>
              <label className={styles.field}>
                <span>{t("recipe.imageUrl")}</span>
                <input
                  type="url"
                  value={thumbnailUrl}
                  onChange={(event) => setThumbnailUrl(event.target.value)}
                  placeholder="https://…"
                />
              </label>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>{t("common.ingredients")}</h2>
            <button type="button" className={styles.textButton} onClick={addIngredient}>
              + {t("common.add")}
            </button>
          </div>
          <div className={styles.ingredientLabels} aria-hidden>
            <span>{t("recipe.ingredient")}</span>
            <span>{t("recipe.originalAmount")}</span>
            <span>{t("recipe.metricQty")}</span>
          </div>
          <ul className={styles.ingredientRows}>
            {ingredients.map((item, index) => (
              <li key={index}>
                <input
                  type="text"
                  value={item.name}
                  onChange={(event) => updateIngredient(index, "name", event.target.value)}
                  placeholder={t("recipe.ingredient")}
                  aria-label={`${t("recipe.ingredient")} ${index + 1}`}
                />
                <input
                  type="text"
                  value={item.quantity}
                  onChange={(event) => updateIngredient(index, "quantity", event.target.value)}
                  placeholder={t("recipe.originalAmount")}
                  aria-label={`${t("recipe.originalAmount")} ${index + 1}`}
                />
                <input
                  type="text"
                  value={item.metric_quantity ?? ""}
                  onChange={(event) => updateIngredient(index, "metric_quantity", event.target.value)}
                  placeholder={t("recipe.metricQty")}
                  aria-label={`${t("recipe.metricQty")} ${index + 1}`}
                />
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => removeIngredient(index)}
                  aria-label={t("recipe.removeIngredient")}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className={`${styles.section} ${styles.stepsSection}`}>
          <StepListEditor
            steps={steps}
            onChange={setSteps}
            uploadImage={(file) => uploadRecipeImage(file, t("common.upload"))}
            onValidityChange={setStepsValid}
          />
        </div>

        <section className={`${styles.section} ${styles.moreSection}`}>
          <div className={styles.sectionHeader}>
            <h2>{t("recipe.moreDetails")}</h2>
          </div>
          <div className={styles.optionalRows}>
            <StringListEditor
              label={t("recipe.tips")}
              addLabel={t("recipe.tips.addRow")}
              placeholder={t("recipe.tips.placeholder")}
              values={tips}
              onChange={setTips}
              collapsed
            />
            <StringListEditor
              label={t("recipe.equipment")}
              addLabel={t("recipe.equipment.addRow")}
              placeholder={t("recipe.equipment.placeholder")}
              values={equipment}
              onChange={setEquipment}
              collapsed
            />
            <details className={styles.tagsDisclosure}>
              <summary>{t("common.tags")}{libraryTags.length ? ` (${libraryTags.length})` : ""}</summary>
              <div className={styles.tagsEditor}>
                <div className="recipe-tag-picker">
                  {RECIPE_TAG_GROUPS.map((group) => (
                    <div key={group.id} className="recipe-tag-group">
                      <p className="recipe-tag-group__title">{group.label}</p>
                      <div className="recipe-tag-group__chips">
                        {group.tags.map((tag) => {
                          const active = libraryTags.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              className={`library-chip ${active ? "library-chip--active" : "library-chip--idle"}`}
                              onClick={() => toggleTag(tag.id)}
                            >
                              {tag.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {libraryTags.length ? (
                  <p className={styles.selectionSummary}>
                    {t("recipe.selectedTags", { tags: libraryTags.map((tag) => CATEGORY_LABELS[tag]).join(", ") })}
                  </p>
                ) : null}
              </div>
            </details>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>{t("recipe.sharingAndSource")}</h2>
          </div>
          <div className={styles.sharingRows}>
            {canManageCatalog ? (
              <div className={styles.sharingRow}>
                <div>
                  <h3>{t("recipe.publicLibrary")}</h3>
                  <p>{t("recipe.publicLibraryDesc")}</p>
                </div>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleCatalogToggle}
                  disabled={catalogSaving}
                >
                  {catalogSaving
                    ? t("common.saving")
                    : recipe.is_public_catalog
                      ? t("recipe.removeFromPublicLibrary")
                      : t("recipe.addToPublicLibrary")}
                </button>
              </div>
            ) : null}
            {recipe.source_url ? (
              <a href={recipe.source_url} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
                {t("recipe.openSourceLink")} ↗
              </a>
            ) : null}
          </div>
        </section>

        <section className={styles.dangerZone} aria-label={t("recipe.deleteRecipe")}>
          <div>
            <strong>{t("recipe.deleteRecipe")}</strong>
            <p>{recipe.title}</p>
          </div>
          <button type="button" onClick={handleDelete} disabled={deleting}>
            {deleting ? t("recipe.deleting") : t("common.delete")}
          </button>
        </section>
      </div>
    </div>
  );
}

export default function RecipeEditPage() {
  return (
    <RequireAuth>
      <PageShell>
        <RecipeEditContent />
      </PageShell>
    </RequireAuth>
  );
}
