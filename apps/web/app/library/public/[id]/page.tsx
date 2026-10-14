"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { isSafeExternalUrl } from "@cooking/shared";
import { PageShell } from "../../../components/PageShell";
import { RequireAuth } from "../../../components/RequireAuth";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useT } from "../../../lib/i18n";
import { presentIngredient } from "../../../lib/ingredientPresentation";
import { CATEGORY_LABELS } from "../../../lib/recipeCategories";
import { getRecipeTags } from "../../../lib/recipeTags";
import { RecipeTutorial } from "../../../recipe/[id]/RecipeTutorial";
import { RecipeTimingDetails } from "../../../components/RecipeTimingDetails";
import { BlockUserButton, ReportRecipeControl, SharedPhotoStatus } from "../../../components/safety/SharingSafety";
import { useAccountScope } from "../../../components/safety/useAccountScope";
import styles from "../../../recipe/[id]/RecipeDetail.module.css";
import type { Recipe } from "../../../types";

function PublicRecipeContent({ id }: { id: string }) {
  const t = useT();
  const scope = useAccountScope();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ownedId, setOwnedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const captured = scope.capture();
    if (!captured) return;
    const actor = captured;
    setLoading(true);
    setLoadFailed(false);

    async function loadCatalog() {
      try {
        const response = await apiFetch("/recipes/catalog", { headers: { "X-Chef-World-Account-ID": actor.id } });
        if (!response.ok) throw new Error("Catalog unavailable");
        const catalog: Recipe[] = await response.json();
        if (!Array.isArray(catalog)) throw new Error("Invalid catalog response");
        if (!cancelled && scope.active(actor)) setRecipe(catalog.find(item => item.id === id && item.is_public_catalog) ?? null);
      } catch {
        if (!cancelled && scope.active(actor)) setLoadFailed(true);
      } finally {
        if (!cancelled && scope.active(actor)) setLoading(false);
      }
    }

    async function loadOwnedCopy() {
      try {
        const response = await apiFetch("/recipes", { headers: { "X-Chef-World-Account-ID": actor.id } });
        if (!response.ok) return;
        const mine: Recipe[] = await response.json();
        if (!Array.isArray(mine) || cancelled || !scope.active(actor)) return;
        const owned = mine.find(item => item.id === id || item.catalog_source_recipe_id === id);
        // A pending library read must not erase a copy just created on this page.
        if (owned) setOwnedId(owned.id);
      } catch {
        // Reading the public recipe remains available. Copying is idempotent.
      }
    }

    void loadCatalog();
    void loadOwnedCopy();
    return () => { cancelled = true; };
  }, [id, attempt, scope.accountId]);

  async function addToLibrary() {
    const actor = scope.capture();
    if (!actor || !recipe || ownedId || adding) return;
    setAdding(true);
    setCopyFailed(false);
    try {
      const response = await apiFetch(`/recipes/catalog/${encodeURIComponent(id)}/copy`, { method: "POST", headers: { "X-Chef-World-Account-ID": actor.id } });
      if (!scope.active(actor)) return;
      if (response.status === 404) {
        setRecipe(null);
        return;
      }
      if (!response.ok) throw new Error("Copy failed");
      const copied: Recipe = await response.json();
      if (scope.active(actor)) setOwnedId(copied.id);
    } catch {
      if (scope.active(actor)) setCopyFailed(true);
    } finally {
      if (scope.active(actor)) setAdding(false);
    }
  }

  const backLink = <Link href="/library?view=public" className={styles.back}>← {t("library.publicLibrary")}</Link>;

  if (loading) return <PageShell>{backLink}<p className={styles.status}>{t("common.loading")}</p></PageShell>;
  if (loadFailed) return (
    <PageShell>
      {backLink}
      <p className={styles.error} role="alert">{t("library.publicRecipe.loadFailed")}</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => setAttempt(current => current + 1)}>{t("library.retry")}</button>
      </div>
    </PageShell>
  );
  if (!recipe) return (
    <PageShell>
      {backLink}
      <h1 className="cw-display">{t("library.publicRecipe.unavailable")}</h1>
      <p className={styles.status}>{t("library.publicRecipe.unavailableDescription")}</p>
    </PageShell>
  );

  const tags = getRecipeTags(recipe);
  const ingredientRows = recipe.ingredients.filter(ingredient => ingredient.name?.trim())
    .map(ingredient => ({ ingredient, display: presentIngredient(ingredient) }));

  return (
    <PageShell>
      <article>
        <div className={styles.topbar}>{backLink}</div>
        <div className={styles.hero}>
          <div className={styles.heroMedia}>
            {recipe.thumbnail_url ? <img src={recipe.thumbnail_url} alt="" /> : <span className="cw-display" aria-hidden>CW</span>}
          </div>
          <header className={styles.recipeHeader}>
            <h1 className="cw-display">{recipe.title}</h1>
            {recipe.description ? <p>{recipe.description}</p> : null}
            <div className={styles.recipeMetadata}>
              <RecipeTimingDetails recipe={recipe} />
              {tags.length ? (
                <div className={styles.tags}>
                  {tags.map(tag => <span key={tag}>{CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}</span>)}
                </div>
              ) : null}
            </div>
            <div className={styles.actions}>
              {ownedId ? (
                <Link className={styles.primaryAction} href={`/recipe/${encodeURIComponent(ownedId)}`}>{t("library.publicRecipe.viewCopy")}</Link>
              ) : (
                <button className={styles.primaryAction} type="button" disabled={adding} onClick={() => void addToLibrary()}>
                  {t(adding ? "library.adding" : "library.addToMyLibrary")}
                </button>
              )}
            </div>
            <SharedPhotoStatus status={recipe.shared_media_status} />
            <ReportRecipeControl recipeId={recipe.id} recipeTitle={recipe.title} />
            <BlockUserButton recipeId={recipe.id} onBlocked={(actor) => { if (scope.active(actor)) setRecipe(null); }} />
            {copyFailed ? <p className={styles.error} role="alert">{t("library.publicRecipe.copyFailed")}</p> : null}
            {isSafeExternalUrl(recipe.source_url) ? (
              <div className={styles.utilityActions}>
                <a href={recipe.source_url} target="_blank" rel="noopener noreferrer">{t("recipe.originalVideo")} ↗</a>
              </div>
            ) : null}
          </header>
        </div>
        <div className={styles.content}>
          <aside className={styles.ingredients}>
            <h2 className="cw-display">{t("common.ingredients")}</h2>
            {ingredientRows.length ? (
              <ul>
                {ingredientRows.map(({ ingredient, display }, index) => (
                  <li key={`${ingredient.name}-${index}`}>
                    <span className={styles.ingredientName}>{ingredient.name.trim()}</span>
                    <strong>{display.amount || "—"}</strong>
                  </li>
                ))}
              </ul>
            ) : <p>{t("recipe.noIngredients")}</p>}
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
            <RecipeTutorial recipe={recipe} canEdit={false} />
            {recipe.tips?.length ? (
              <section className={styles.tips}>
                <h3>{t("recipe.tips")}</h3>
                <ul>{recipe.tips.map((tip, index) => <li key={`${tip}-${index}`}>{tip}</li>)}</ul>
              </section>
            ) : null}
          </div>
        </div>
      </article>
    </PageShell>
  );
}

export default function PublicRecipePage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  return <RequireAuth><PublicRecipeContent key={`${user?.id}:${params.id}`} id={params.id} /></RequireAuth>;
}
