"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { RequireAuth } from "../../components/RequireAuth";
import {
  CATEGORY_LABELS,
} from "../../lib/recipeCategories";
import type { Recipe, IngredientItem } from "../../types";

function ingredientQtyLine(i: IngredientItem): string {
  const parts: string[] = [];
  if (i.quantity?.trim()) parts.push(i.quantity.trim());
  if (i.notes?.trim()) parts.push(i.notes.trim());
  return parts.join(", ");
}

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

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch(`/recipes/${id}`);
        if (!res.ok) throw new Error("Recipe not found");
        const data: Recipe = await res.json();
        if (!cancelled) setRecipe(data);
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

  async function handleDelete() {
    if (!id || !recipe) return;
    if (!confirm(`Delete “${recipe.title}”? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/recipes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      router.push("/library");
    } catch {
      setError("Could not delete recipe.");
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
        Loading…
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
  const tags = recipe.library_tags ?? (recipe.library_category ? [recipe.library_category] : []);
  const { lead, accent } = splitTitleAccent(recipe.title);

  return (
    <article className="recipe-editorial">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1.5rem",
        }}
      >
        <Link href="/library" className="font-headline recipe-detail-back">
          ← Library
        </Link>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Link href={`/library/${id}`} className="btn-primary" style={{ padding: "0.55rem 1.15rem", minHeight: 44, fontSize: "0.9rem" }}>
            Edit
          </Link>
          <button
            type="button"
            className="font-headline"
            style={{
              padding: "0.55rem 1.15rem",
              minHeight: 44,
              fontSize: "0.9rem",
              fontWeight: 700,
              border: "none",
              borderRadius: "var(--radius-lg)",
              background: "var(--surface-container-low)",
              color: "var(--on-surface-variant)",
              cursor: "pointer",
            }}
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
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
          <div
            style={{
              width: "100%",
              height: "100%",
              minHeight: "12rem",
              background: "linear-gradient(145deg, var(--primary-fixed), var(--surface-container-high))",
            }}
          />
        )}
      </div>

      <div className="recipe-editorial__center">
        <div className="recipe-editorial__pills">
          {tags.map((tag) => (
            <span key={tag} className="recipe-editorial__pill recipe-editorial__pill--tertiary font-headline">
              {CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}
            </span>
          ))}
          <span className="recipe-editorial__pill recipe-editorial__pill--primary font-headline">
            {ingredientRows.length} ingredients
          </span>
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
        {blurb && (
          <p
            style={{
              margin: "0 0 2rem",
              fontSize: "1.15rem",
              color: "var(--on-surface-variant)",
              fontWeight: 400,
              lineHeight: 1.55,
            }}
          >
            {blurb}
          </p>
        )}
        <div className="recipe-editorial__stats">
          <div>
            <p className="recipe-editorial__stats-label font-headline">Tags</p>
            <p className="recipe-editorial__stats-value">{tags.length ? tags.slice(0, 2).map((tag) => CATEGORY_LABELS[tag]).join(", ") : "Recipe"}</p>
          </div>
          <div>
            <p className="recipe-editorial__stats-label font-headline">Ingredients</p>
            <p className="recipe-editorial__stats-value">{ingredientRows.length}</p>
          </div>
          <div>
            <p className="recipe-editorial__stats-label font-headline">Source</p>
            <p className="recipe-editorial__stats-value">{recipe.source_url ? "Imported" : "Library"}</p>
          </div>
        </div>
      </div>

      <div className="recipe-editorial-ingredients">
        <h2 className="font-headline">Ingredients</h2>
        {ingredientRows.length === 0 ? (
          <p style={{ color: "var(--muted)", textAlign: "center" }}>No ingredients listed.</p>
        ) : (
          ingredientRows.map((ing, idx) => (
            <div key={idx} className="recipe-editorial-ing-row">
              <p className="recipe-editorial-ing-name font-headline">{ing.name?.trim()}</p>
              <p className="recipe-editorial-ing-qty">{ingredientQtyLine(ing) || "—"}</p>
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}>
        <Link href={`/library/${id}`} className="btn-primary" style={{ textDecoration: "none", display: "inline-flex" }}>
          Edit recipe
        </Link>
        <Link
          href={`/planner`}
          className="font-headline"
          style={{
            padding: "0.55rem 1.15rem",
            minHeight: 44,
            fontSize: "0.9rem",
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
            borderRadius: "var(--radius-lg)",
            background: "var(--surface-container-low)",
            color: "var(--on-surface-variant)",
            border: "1px solid color-mix(in srgb, var(--outline-variant) 35%, transparent)",
          }}
        >
          Meal planner
        </Link>
      </div>

      {recipe.source_url && (
        <p style={{ margin: "2.5rem 0 0", textAlign: "center", fontSize: "0.9rem" }}>
          <a href={recipe.source_url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700 }}>
            Original video →
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
