"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { RequireAuth } from "../../components/RequireAuth";
import type { Recipe, IngredientItem } from "../../types";

function formatIngredientLine(i: IngredientItem): string {
  const parts: string[] = [];
  if (i.quantity?.trim()) parts.push(i.quantity.trim());
  if (i.name?.trim()) parts.push(i.name.trim());
  if (i.notes?.trim()) parts.push(i.notes.trim());
  return parts.join(" ");
}

function RecipeDetailContent() {
  const params = useParams();
  const id = params?.id as string;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <p style={mutedStyle}>Loading…</p>;
  if (error) return <p style={errorStyle}>{error}</p>;
  if (!recipe) return null;

  const ingredientLines = recipe.ingredients
    .map(formatIngredientLine)
    .filter((line) => line.length > 0);

  return (
    <div style={pageStyle}>
      <div style={imageWrapStyle}>
        {recipe.thumbnail_url ? (
          <img
            src={recipe.thumbnail_url}
            alt=""
            style={imageStyle}
          />
        ) : (
          <div style={placeholderStyle} className="recipeCardPlaceholder">
            <span style={placeholderTextStyle}>Recipe</span>
          </div>
        )}
      </div>

      <h1 style={titleStyle}>{recipe.title}</h1>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Ingredients</h2>
        <ul style={listStyle}>
          {ingredientLines.length === 0 ? (
            <li style={mutedStyle}>No ingredients listed.</li>
          ) : (
            ingredientLines.map((line, idx) => (
              <li key={idx} style={listItemStyle}>{line}</li>
            ))
          )}
        </ul>
      </section>

      <div style={actionsStyle}>
        <Link href={`/library/${id}`} style={buttonLinkStyle}>
          Edit Recipe
        </Link>
        <Link href="/planner" style={buttonLinkSecondaryStyle}>
          Add to Planner
        </Link>
      </div>

      {recipe.source_url && (
        <p style={sourceWrapStyle}>
          <a
            href={recipe.source_url}
            target="_blank"
            rel="noopener noreferrer"
            style={sourceLinkStyle}
          >
            Original video
          </a>
        </p>
      )}
    </div>
  );
}

export default function RecipeDetailPage() {
  return (
    <RequireAuth>
      <div className="app-container">
        <RecipeDetailContent />
      </div>
    </RequireAuth>
  );
}

const pageStyle: React.CSSProperties = {
  minWidth: 0,
};

const imageWrapStyle: React.CSSProperties = {
  width: "100%",
  aspectRatio: "16/9",
  borderRadius: "var(--radius-card)",
  overflow: "hidden",
  background: "var(--surface)",
};

const imageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const placeholderStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(145deg, var(--surface-elevated) 0%, var(--surface) 40%, var(--border) 100%)",
};

const placeholderTextStyle: React.CSSProperties = {
  fontSize: "0.9rem",
  color: "var(--muted)",
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.8rem",
  fontWeight: 700,
  marginTop: "1rem",
  marginBottom: "var(--space-16)",
  lineHeight: 1.2,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: "var(--space-24)",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "var(--font-section)",
  fontWeight: 600,
  marginBottom: "var(--space-12)",
};

const listStyle: React.CSSProperties = {
  listStyle: "disc",
  paddingLeft: "1.5rem",
  margin: 0,
};

const listItemStyle: React.CSSProperties = {
  marginBottom: "0.35rem",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-12)",
  marginBottom: "var(--space-24)",
};

const buttonLinkStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "var(--space-12) var(--space-24)",
  background: "var(--accent)",
  color: "var(--bg)",
  borderRadius: "var(--radius-btn)",
  fontWeight: 600,
  textDecoration: "none",
};

const buttonLinkSecondaryStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "var(--space-12) var(--space-24)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: "var(--radius-btn)",
  fontWeight: 500,
  textDecoration: "none",
};

const sourceWrapStyle: React.CSSProperties = {
  margin: 0,
};

const sourceLinkStyle: React.CSSProperties = {
  color: "var(--accent)",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--font-body)",
};

const errorStyle: React.CSSProperties = {
  color: "#e57373",
  fontSize: "var(--font-body)",
};
