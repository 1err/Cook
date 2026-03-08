"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { RecipeCard } from "../components/RecipeCard";
import type { Recipe } from "../types";

function LibraryPageContent() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    if (openMenuId) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [openMenuId]);

  async function handleDelete(recipe: Recipe) {
    if (!confirm(`Delete "${recipe.title}"?`)) return;
    setDeletingId(recipe.id);
    setOpenMenuId(null);
    try {
      const res = await apiFetch(`/recipes/${recipe.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchRecipes();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <p style={mutedStyle}>Loading recipes…</p>;
  if (error) return <p style={errorStyle}>{error}</p>;

  return (
    <div style={pageStyle}>
      <h1 style={h1Style}>Recipe Library</h1>
      <p style={mutedStyle}>
        Saved recipes from imported videos. Tap a card to open, or use the menu to edit or delete.
      </p>

      {recipes.length === 0 ? (
        <div style={emptyStyle}>
          <p>No recipes yet.</p>
          <Link href="/import" style={linkStyle}>
            Import your first recipe from a video →
          </Link>
        </div>
      ) : (
        <ul className="libraryGrid" style={gridStyle}>
          {recipes.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              isHighlighted={highlightId === r.id}
              isMenuOpen={openMenuId === r.id}
              menuRef={menuRef}
              onMenuToggle={(e) => {
                e.preventDefault();
                setOpenMenuId(openMenuId === r.id ? null : r.id);
              }}
              onMenuClose={() => setOpenMenuId(null)}
              onDelete={() => handleDelete(r)}
              isDeleting={deletingId === r.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <RequireAuth>
      <div className="app-container">
        <Suspense fallback={<p style={mutedStyle}>Loading recipes…</p>}>
          <LibraryPageContent />
        </Suspense>
      </div>
    </RequireAuth>
  );
}

const pageStyle: React.CSSProperties = {
  minWidth: 0,
};

const h1Style: React.CSSProperties = {
  fontSize: "var(--font-title)",
  fontWeight: 600,
  marginBottom: "var(--space-12)",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--font-body)",
  marginBottom: "var(--space-24)",
};

const emptyStyle: React.CSSProperties = {
  padding: "var(--space-32)",
  background: "var(--surface)",
  borderRadius: "var(--radius-card)",
  border: "1px dashed var(--border)",
  textAlign: "center",
  color: "var(--muted)",
};

const linkStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: "0.75rem",
  color: "var(--accent)",
  fontWeight: 500,
};

const gridStyle: React.CSSProperties = {
  minWidth: 0,
};

const errorStyle: React.CSSProperties = {
  color: "#e57373",
};
