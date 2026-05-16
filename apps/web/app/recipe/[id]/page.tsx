"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { formatIngredientQuantity, formatStepDuration } from "@cooking/shared";
import { apiFetch } from "../../lib/api";
import { RequireAuth } from "../../components/RequireAuth";
import { useT } from "../../lib/i18n";
import { CATEGORY_LABELS } from "../../lib/recipeCategories";
import { getRecipeTags } from "../../lib/recipeTags";
import type { Recipe } from "../../types";

function splitTitleAccent(title: string): { lead: string; accent: string } {
  const t = title.trim();
  const idx = t.lastIndexOf(" ");
  if (idx <= 0) return { lead: t, accent: "" };
  return { lead: t.slice(0, idx), accent: t.slice(idx + 1) };
}

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
        const res = await apiFetch(`/recipes/${id}`);
        if (!res.ok) throw new Error(t("recipe.recipe"));
        const data: Recipe = await res.json();
        if (!cancelled) setRecipe(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("common.loading"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleDelete() {
    if (!id || !recipe) return;
    if (!confirm(t("recipe.deleteConfirm", { title: recipe.title }))) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/recipes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(t("recipe.deleteRecipe"));
      router.push("/library");
    } catch {
      setError(t("recipe.deleteRecipe"));
    } finally {
      setDeleting(false);
    }
  }

  const blurb = useMemo(() => {
    if (!recipe?.raw_extraction_text) return null;
    const line = recipe.raw_extraction_text.split(/\n+/).map((s) => s.trim()).find(Boolean);
    if (!line || line.length < 12) return null;
    return line.length > 220 ? `${line.slice(0, 217)}…` : line;
  }, [recipe]);

  if (loading) {
    return (
      <p style={{ color: "var(--muted)", padding: "var(--space-24)" }} className="recipe-editorial">
        {t("common.loading")}
      </p>
    );
  }
  if (error && !recipe) {
    return (
      <p style={{ color: "#c62828", padding: "var(--space-24)" }} className="recipe-editorial">
        {error}
      </p>
    );
  }
  if (!recipe) return null;

  const ingredientRows = recipe.ingredients.filter((i) => (i.name || "").trim().length > 0);
  const tags = getRecipeTags(recipe);
  const { lead, accent } = splitTitleAccent(recipe.title);

  return (
    <article className="recipe-editorial">
      <div className="recipe-editorial__topbar">
        <Link href="/library" className="font-headline recipe-detail-back">
          ← {t("nav.library")}
        </Link>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Link href={`/library/${id}`} className="btn-primary" style={{ padding: "0.55rem 1.15rem", minHeight: 44, fontSize: "0.9rem" }}>
            {t("common.edit")}
          </Link>
          <button
            type="button"
            className="font-headline recipe-editorial__ghostbtn"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? t("recipe.deleting") : t("common.delete")}
          </button>
        </div>
      </div>

      {error && (
        <p style={{ color: "#c62828", marginTop: "0.5rem", fontSize: "var(--font-body)" }}>{error}</p>
      )}

      <div className="recipe-editorial__hero-img">
        {recipe.thumbnail_url ? (
          <img src={recipe.thumbnail_url} alt="" />
        ) : (
          <div className="recipe-editorial__hero-fallback" />
        )}
      </div>

      <header className="recipe-editorial__header">
        <div className="recipe-editorial__pills">
          {tags.map((tag) => (
            <span key={tag} className="recipe-editorial__pill recipe-editorial__pill--tertiary font-headline">
              {CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}
            </span>
          ))}
        </div>
        <h1 className="recipe-editorial__title font-headline">
          {lead}
          {accent ? (
            <>
              {" "}
              <span className="recipe-editorial__accent">{accent}</span>
            </>
          ) : null}
        </h1>
        {blurb && <p className="recipe-editorial__blurb">{blurb}</p>}
        {recipe.description && <p className="recipe-description">{recipe.description}</p>}
      </header>

      <div className="recipe-editorial__body">
        <aside className="recipe-rail">
          <div className="recipe-rail__meta">
            {typeof recipe.total_time_minutes === "number" && (
              <div className="recipe-total-time-chip">
                <span>⏱</span>
                <span>{recipe.total_time_minutes} {t("recipe.totalTime.minutesSuffix")}</span>
              </div>
            )}
            <div className="recipe-rail__metarow">
              <span className="recipe-rail__metalabel font-headline">{t("recipe.tags")}</span>
              <span className="recipe-rail__metaval">{tags.length ? tags.slice(0, 2).map((tag) => CATEGORY_LABELS[tag]).join(", ") : t("recipe.recipe")}</span>
            </div>
            <div className="recipe-rail__metarow">
              <span className="recipe-rail__metalabel font-headline">{t("common.ingredients")}</span>
              <span className="recipe-rail__metaval">{ingredientRows.length}</span>
            </div>
            <div className="recipe-rail__metarow">
              <span className="recipe-rail__metalabel font-headline">{t("common.source")}</span>
              <span className="recipe-rail__metaval">{recipe.source_url ? t("common.imported") : t("common.library")}</span>
            </div>
          </div>

          <div className="recipe-editorial-ingredients">
            <h2 className="font-headline">{t("common.ingredients")}</h2>
            {ingredientRows.length === 0 ? (
              <p style={{ color: "var(--muted)", textAlign: "center" }}>{t("recipe.noIngredients")}</p>
            ) : (
              ingredientRows.map((ing, idx) => (
                <div key={idx} className="recipe-editorial-ing-row">
                  <p className="recipe-editorial-ing-name font-headline">{ing.name?.trim()}</p>
                  <p className="recipe-editorial-ing-qty">{formatIngredientQuantity(ing) || "—"}</p>
                </div>
              ))
            )}
          </div>

          {(recipe.equipment ?? []).length > 0 && (
            <section className="recipe-equipment">
              <h3>{t("recipe.equipment")}</h3>
              <ul>{recipe.equipment!.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </section>
          )}
        </aside>

        <div className="recipe-main">
          {(recipe.steps ?? []).length > 0 && (
            <section className="recipe-steps">
              <h3>{t("recipe.steps")}</h3>
              <ol>
                {recipe.steps!.map((s, i) => (
                  <li key={i} className="recipe-step">
                    <div className="recipe-step__header">
                      <span className="recipe-step__index">{i + 1}</span>
                      {s.duration_seconds && s.duration_seconds > 0 && (
                        <span className="recipe-step__chip">⏱ {formatStepDuration(s.duration_seconds)}</span>
                      )}
                    </div>
                    <p className="recipe-step__text">{s.text}</p>
                    {s.image_url && <img src={s.image_url} alt="" className="recipe-step__image" />}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {(recipe.tips ?? []).length > 0 && (
            <section className="recipe-tips">
              <h3>{t("recipe.tips")}</h3>
              <ul>{recipe.tips!.map((tp, i) => <li key={i}>{tp}</li>)}</ul>
            </section>
          )}

          {(recipe.steps ?? []).length === 0 && (recipe.tips ?? []).length === 0 && (
            <p className="recipe-main__empty" style={{ color: "var(--muted)" }}>{t("recipe.recipe")}</p>
          )}
        </div>
      </div>

      <div className="recipe-editorial__footer">
        <Link href={`/library/${id}`} className="btn-primary" style={{ textDecoration: "none", display: "inline-flex" }}>
          {t("recipe.editRecipe")}
        </Link>
        <Link href={`/planner`} className="font-headline recipe-editorial__ghostbtn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
          {t("recipe.mealPlanner")}
        </Link>
      </div>

      {recipe.source_url && (
        <p style={{ margin: "2.5rem 0 0", textAlign: "center", fontSize: "0.9rem" }}>
          <a href={recipe.source_url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700 }}>
            {t("recipe.originalVideo")} →
          </a>
        </p>
      )}
    </article>
  );
}

export default function RecipeDetailPage() {
  return (
    <RequireAuth>
      <RecipeDetailContent />
    </RequireAuth>
  );
}
