"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { RecipeCard } from "../components/RecipeCard";
import { LIBRARY_FILTER_CHIPS, type LibraryFilterId } from "../lib/recipeCategories";
import type { Recipe } from "../types";

function LibraryPageContent() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilterId>("all");
  const [search, setSearch] = useState("");

  const fetchRecipes = async () => {
    try {
      const res = await apiFetch("/recipes");
      if (!res.ok) throw new Error("Failed to load recipes");
      const data = await res.json();
      setRecipes(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipes();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((r) => {
      if (filter !== "all" && r.library_category !== filter) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [recipes, filter, search]);

  if (loading) return <p style={mutedStyle}>Loading…</p>;
  if (error) return <p style={errorStyle}>{error}</p>;

  return (
    <>
      <h1 className="library-page-title font-headline">Recipe library</h1>

      <div className="library-search-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3-3" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          className="library-search-input"
          placeholder="Search recipes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search recipes"
        />
      </div>

      <div className="library-chip-row" role="toolbar" aria-label="Filter by category">
        {LIBRARY_FILTER_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`library-chip ${filter === chip.id ? "library-chip--active" : "library-chip--idle"}`}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={emptyStyle}>
          <p style={{ margin: 0, fontWeight: 700, color: "var(--on-surface)", fontSize: "1.05rem" }}>
            {recipes.length === 0 ? "Your shelf is ready" : "No matches"}
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem", lineHeight: 1.5 }}>
            {recipes.length === 0
              ? "Import a recipe from a link or transcript to see it here."
              : "Try another filter or search term."}
          </p>
          {recipes.length === 0 && (
            <Link href="/import" style={linkStyle}>
              Import a recipe →
            </Link>
          )}
        </div>
      ) : (
        <ul className="libraryGrid">
          {filtered.map((r) => (
            <RecipeCard key={r.id} recipe={r} isHighlighted={highlightId === r.id} />
          ))}
        </ul>
      )}

      <Link href="/import" className="library-fab" aria-label="Import recipe">
        <span style={{ fontSize: "1.35rem", lineHeight: 1 }}>+</span>
        <span className="library-fab__text">Import recipe</span>
      </Link>
    </>
  );
}

export default function LibraryPage() {
  return (
    <RequireAuth>
      <div className="app-container app-container--fab" style={{ position: "relative" }}>
        <Suspense fallback={<p style={mutedStyle}>Loading…</p>}>
          <LibraryPageContent />
        </Suspense>
      </div>
    </RequireAuth>
  );
}

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--font-body)",
};

const emptyStyle: React.CSSProperties = {
  padding: "var(--space-40) var(--space-32)",
  background: "var(--surface-container-low)",
  borderRadius: "var(--radius-card)",
  textAlign: "center",
  color: "var(--on-surface-variant)",
  boxShadow: "var(--kitchen-glow)",
};

const linkStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: "1rem",
  color: "var(--primary)",
  fontWeight: 700,
};

const errorStyle: React.CSSProperties = {
  color: "#c62828",
};
