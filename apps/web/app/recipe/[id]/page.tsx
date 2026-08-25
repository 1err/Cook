"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { formatIngredientQuantity } from "@cooking/shared";
import { PageShell } from "../../components/PageShell";
import { RequireAuth } from "../../components/RequireAuth";
import { apiFetch } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { CATEGORY_LABELS } from "../../lib/recipeCategories";
import { getRecipeTags } from "../../lib/recipeTags";
import type { Recipe } from "../../types";
import styles from "./RecipeDetail.module.css";
import { RecipeTutorial } from "./RecipeTutorial";

function RecipeDetailContent() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
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
    if (!id || !recipe || !confirm(t("recipe.deleteConfirm", { title: recipe.title }))) return;
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

  if (loading) return <PageShell><p className={styles.status}>{t("common.loading")}</p></PageShell>;
  if (error && !recipe) return <PageShell><p className={styles.error}>{error}</p></PageShell>;
  if (!recipe) return null;

  const ingredients = recipe.ingredients.filter((ingredient) => ingredient.name?.trim());
  const tags = getRecipeTags(recipe);

  return (
    <PageShell>
      <article>
        <div className={styles.topbar}>
          <Link href="/library" className={styles.back}>← {t("nav.library")}</Link>
          <div className={styles.actions}>
            <Link href="/planner">{t("recipe.mealPlanner")}</Link>
            <Link href={`/library/${id}`} className={styles.primaryAction}>{t("common.edit")}</Link>
            <button type="button" onClick={handleDelete} disabled={deleting}>
              {deleting ? t("recipe.deleting") : t("common.delete")}
            </button>
          </div>
        </div>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        <div className={styles.hero}>
          <div className={styles.heroMedia}>
            {recipe.thumbnail_url ? (
              <img src={recipe.thumbnail_url} alt="" />
            ) : (
              <span className="cw-display" aria-hidden>CW</span>
            )}
          </div>
          <header className={styles.recipeHeader}>
            {tags.length ? (
              <div className={styles.tags}>
                {tags.map((tag) => (
                  <span key={tag}>{CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}</span>
                ))}
              </div>
            ) : null}
            <h1 className="cw-display">{recipe.title}</h1>
            {recipe.description ? <p>{recipe.description}</p> : null}
            {typeof recipe.total_time_minutes === "number" ? (
              <dl className={styles.meta}>
                <div>
                  <dt>{t("recipe.totalTime.minutesSuffix")}</dt>
                  <dd>{recipe.total_time_minutes} min</dd>
                </div>
              </dl>
            ) : null}
          </header>
        </div>

        <div className={styles.content}>
          <aside className={styles.ingredients}>
            <h2 className="cw-display">{t("common.ingredients")}</h2>
            {ingredients.length ? (
              <ul>
                {ingredients.map((ingredient, index) => (
                  <li key={`${ingredient.name}-${index}`}>
                    <span>{ingredient.name?.trim()}</span>
                    <strong>{formatIngredientQuantity(ingredient) || "—"}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("recipe.noIngredients")}</p>
            )}

            {(recipe.equipment ?? []).length ? (
              <section className={styles.equipment}>
                <h3>{t("recipe.equipment")}</h3>
                <ul>{recipe.equipment!.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
              </section>
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

        {recipe.source_url ? (
          <a className={styles.source} href={recipe.source_url} target="_blank" rel="noopener noreferrer">
            {t("recipe.originalVideo")} ↗
          </a>
        ) : null}
      </article>
    </PageShell>
  );
}

export default function RecipeDetailPage() {
  return <RequireAuth><RecipeDetailContent /></RequireAuth>;
}
