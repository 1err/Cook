"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { isSafeExternalUrl } from "@cooking/shared";
import { presentIngredient } from "../../lib/ingredientPresentation";
import { PageShell } from "../../components/PageShell";
import { RecipeCoverEditor } from "../../components/RecipeCoverEditor";
import { RequireAuth } from "../../components/RequireAuth";
import { apiFetch } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { CATEGORY_LABELS } from "../../lib/recipeCategories";
import { getRecipeTags } from "../../lib/recipeTags";
import type { Recipe } from "../../types";
import styles from "./RecipeDetail.module.css";
import { RecipeTutorial } from "./RecipeTutorial";
import { RecipeCookAction } from "./RecipeCookAction";
import { RecipeTimingDetails } from "../../components/RecipeTimingDetails";

function RecipeDetailContent() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const t = useT();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await apiFetch(`/recipes/${id}`);
        if (!response.ok) throw new Error(t("recipe.recipe"));
        if (!cancelled) setRecipe(await response.json());
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t("common.loading"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  async function handleDelete() {
    if (!id || !recipe || coverBusy || !confirm(t("recipe.deleteConfirm", { title: recipe.title }))) return;
    setDeleting(true);
    try {
      const response = await apiFetch(`/recipes/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(t("recipe.deleteRecipe"));
      router.push("/library");
    } catch {
      setError(t("recipe.deleteRecipe"));
    } finally {
      setDeleting(false);
    }
  }

  async function updateCover(url: string) {
    const response = await apiFetch(`/recipes/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ thumbnail_url: url }),
    });
    if (!response.ok) throw new Error(t("recipe.cover.saveFailed"));
    const updated: Recipe = await response.json();
    setRecipe(current => current?.id === id ? { ...current, thumbnail_url: updated.thumbnail_url } : current);
  }

  if (loading) return <PageShell><p className={styles.status}>{t("common.loading")}</p></PageShell>;
  if (error && !recipe) return <PageShell><p className={styles.error}>{error}</p></PageShell>;
  if (!recipe) return null;

  const ingredients = recipe.ingredients.filter((ingredient) => ingredient.name?.trim());
  const tags = getRecipeTags(recipe);
  const ingredientRows = ingredients.map(ingredient => ({ ingredient, display: presentIngredient(ingredient) }));

  return (
    <PageShell>
      <article>
        <div className={styles.topbar}>
          <Link href="/library" className={styles.back}>← {t("nav.library")}</Link>

        </div>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        <div className={styles.hero}>
          <RecipeCoverEditor key={id} value={recipe.thumbnail_url} variant="hero" onChange={updateCover} onBusyChange={setCoverBusy} disabled={deleting} />
          <header className={styles.recipeHeader}>
            <h1 className="cw-display">{recipe.title}</h1>
            {recipe.description ? <p>{recipe.description}</p> : null}
            <div className={styles.recipeMetadata}>
            <RecipeTimingDetails recipe={recipe} />
            {tags.length ? (
              <div className={styles.tags}>
                {tags.map((tag) => (
                  <span key={tag}>{CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}</span>
                ))}
              </div>
            ) : null}
            </div>
          <div className={styles.actions}>
            <RecipeCookAction recipe={recipe} />
            <Link href="/planner">{t("recipe.mealPlanner")}</Link>
          </div>
          <div className={styles.utilityActions}>
            <Link href={`/library/${id}`}>{t("common.edit")}</Link>
            {isSafeExternalUrl(recipe.source_url) ? (
              <a href={recipe.source_url} target="_blank" rel="noopener noreferrer">
                {t("recipe.originalVideo")} ↗
              </a>
            ) : null}
            <details className={styles.moreActions}>
              <summary aria-label={t("common.moreActions")}>•••</summary>
              <div className={styles.moreActionsMenu}>
                <button type="button" onClick={handleDelete} disabled={deleting || coverBusy}>
                  {deleting ? t("recipe.deleting") : t("common.delete")}
                </button>
              </div>
            </details>
          </div>
          </header>
        </div>

        <div className={styles.content}>
          <aside className={styles.ingredients}>
            <h2 className="cw-display">{t("common.ingredients")}</h2>
            {ingredients.length ? (
              <ul>
                {ingredientRows.map(({ ingredient, display }, index) => (
                  <li key={`${ingredient.name}-${index}`}>
                    <span className={styles.ingredientName}>{ingredient.name.trim()}</span>
                    <strong>{display.amount || "—"}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("recipe.noIngredients")}</p>
            )}

            {ingredientRows.some(({ display }) => display.metricAmount || display.alternatives.length) ? (
              <details className={styles.ingredientOriginals}>
                <summary>{t("recipe.originalDetails")}</summary>
                <dl>{ingredientRows.map(({ ingredient }, index) => (
                  <div key={`${ingredient.name}-${index}`}>
                    <dt>{ingredient.name}</dt>
                    <dd>{[ingredient.quantity, ingredient.metric_quantity, ingredient.notes]
                      .filter((value, itemIndex, values) => value?.trim() && values.indexOf(value) === itemIndex).join(" · ")}</dd>
                  </div>
                ))}</dl>
              </details>
            ) : null}

          </aside>

          <div className={styles.method}>
            <RecipeTutorial recipe={recipe} />

            {(recipe.tips ?? []).length ? (
              <section className={styles.tips}>
                <h3>{t("recipe.tips")}</h3>
                <ul>{recipe.tips!.map((tip, index) => <li key={`${tip}-${index}`}>{tip}</li>)}</ul>
              </section>
            ) : null}
          </div>
        </div>

      </article>
    </PageShell>
  );
}

export default function RecipeDetailPage() {
  return <RequireAuth><RecipeDetailContent /></RequireAuth>;
}
