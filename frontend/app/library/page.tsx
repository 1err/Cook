"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getApiBase } from "../config";
import type { Recipe } from "../types";

function ingredientPreview(recipe: Recipe, maxLines = 2): string {
  const parts = recipe.ingredients.slice(0, 5).map((i) => i.name).filter(Boolean);
  return parts.join(", ") || "No ingredients";
}

export default function LibraryPage() {
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
      const res = await fetch(`${getApiBase()}/recipes`);
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
      const res = await fetch(`${getApiBase()}/recipes/${recipe.id}`, {
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
        <ul style={listStyle}>
          {recipes.map((r) => (
            <li
              key={r.id}
              className="recipe-card-hover"
              style={{
                ...cardStyle,
                ...(highlightId === r.id ? highlightCardStyle : {}),
              }}
            >
              <Link href={`/library/${r.id}`} style={cardLinkStyle}>
                <div style={thumbWrapStyle}>
                  {r.thumbnail_url ? (
                    <img
                      src={r.thumbnail_url}
                      alt=""
                      style={thumbStyle}
                    />
                  ) : (
                    <div style={thumbPlaceholderStyle}>
                      <span style={thumbPlaceholderText}>Recipe</span>
                    </div>
                  )}
                </div>
                <div style={cardBodyStyle}>
                  <h2 style={titleStyle}>{r.title}</h2>
                  <p style={previewStyle} title={ingredientPreview(r)}>
                    {ingredientPreview(r)}
                  </p>
                </div>
              </Link>
              <div style={menuWrapStyle} ref={openMenuId === r.id ? menuRef : null}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenMenuId(openMenuId === r.id ? null : r.id);
                  }}
                  style={menuTriggerStyle}
                  aria-label="Options"
                  aria-expanded={openMenuId === r.id}
                >
                  ⋮
                </button>
                {openMenuId === r.id && (
                  <div style={dropdownStyle}>
                    <Link
                      href={`/library/${r.id}`}
                      style={dropdownItemStyle}
                      onClick={() => setOpenMenuId(null)}
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(r)}
                      disabled={deletingId === r.id}
                      style={dropdownItemStyle}
                    >
                      {deletingId === r.id ? "Deleting…" : "Delete"}
                    </button>
                    {r.source_url && (
                      <a
                        href={r.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={dropdownItemStyle}
                        onClick={() => setOpenMenuId(null)}
                      >
                        Source
                      </a>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
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

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-24)",
};

const cardStyle: React.CSSProperties = {
  position: "relative",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card)",
  overflow: "hidden",
  boxShadow: "var(--shadow-card)",
};

const highlightCardStyle: React.CSSProperties = {
  borderColor: "var(--accent)",
  boxShadow: "0 0 0 2px var(--accent)",
};

const cardLinkStyle: React.CSSProperties = {
  textDecoration: "none",
  color: "inherit",
  display: "block",
};

const thumbWrapStyle: React.CSSProperties = {
  width: "100%",
  aspectRatio: "4 / 3",
  backgroundColor: "var(--border)",
  overflow: "hidden",
};

const thumbStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const thumbPlaceholderStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--border)",
};

const thumbPlaceholderText: React.CSSProperties = {
  fontSize: "0.9rem",
  color: "var(--muted)",
};

const cardBodyStyle: React.CSSProperties = {
  padding: "var(--space-16) var(--space-24)",
  paddingRight: 48,
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.25rem",
  fontWeight: 700,
  margin: "0 0 var(--space-8) 0",
  lineHeight: 1.3,
};

const previewStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.9rem",
  color: "var(--muted)",
  lineHeight: 1.4,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  maskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
  WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
};

const menuWrapStyle: React.CSSProperties = {
  position: "absolute",
  top: "var(--space-12)",
  right: "var(--space-12)",
};

const menuTriggerStyle: React.CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--text)",
  fontSize: "1.25rem",
  lineHeight: 1,
  cursor: "pointer",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  right: 0,
  marginTop: "var(--space-8)",
  minWidth: 140,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  boxShadow: "var(--shadow-card-hover)",
  padding: "var(--space-8) 0",
  zIndex: 10,
  transition: "opacity 0.15s ease, transform 0.15s ease",
};

const dropdownItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  minHeight: 44,
  padding: "0.6rem 1rem",
  background: "none",
  border: "none",
  textAlign: "left",
  fontSize: "0.95rem",
  color: "var(--text)",
  textDecoration: "none",
  cursor: "pointer",
  boxSizing: "border-box",
};

const errorStyle: React.CSSProperties = {
  color: "#e57373",
};
