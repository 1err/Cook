"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { presentIngredient } from "../../lib/ingredientPresentation";
import { PageShell } from "../../components/PageShell";
import { RecipeAuthorEditor } from "../../components/RecipeAuthorEditor";
import { RecipeCoverEditor } from "../../components/RecipeCoverEditor";
import { RequireAuth } from "../../components/RequireAuth";
import { apiFetch } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { Icon } from "../../components/ui/Icon";
import type { Recipe } from "../../types";
import styles from "./RecipeDetail.module.css";
import { RecipeTutorial } from "./RecipeTutorial";
import { RecipeCookAction } from "./RecipeCookAction";
import { RecipeHeader } from "./RecipeHeader";
import { RecipeManagementActions } from "./RecipeManagementActions";

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
  const ingredientRows = ingredients.map(ingredient => ({ ingredient, display: presentIngredient(ingredient) }));

  return (
    <PageShell>
      <article>
        <div className={styles.topbar}>
          <Link href="/library" className={styles.back}><Icon name="arrowLeft" size={15} />{t("nav.library")}</Link>
        </div>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        <div className={styles.hero}>
          <RecipeCoverEditor key={id} value={recipe.thumbnail_url} variant="hero" onChange={updateCover} onBusyChange={setCoverBusy} disabled={deleting} />
          <RecipeHeader recipe={recipe}
            author={<RecipeAuthorEditor key={id} recipeId={id} author={recipe.author} disabled={deleting || coverBusy}
              onSaved={author => setRecipe(current => current ? { ...current, author, author_id: author?.id ?? null } : current)} />}
            management={<RecipeManagementActions id={id} deleting={deleting} disabled={coverBusy} onDelete={handleDelete} />}>
            <RecipeCookAction recipe={recipe} />
            <Link href="/planner"><Icon name="calendar" size={17} />{t("recipe.mealPlanner")}</Link>
          </RecipeHeader>
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
