"use client";

import Link from "next/link";
import type { Recipe } from "../types";

function ingredientPreview(recipe: Recipe, maxLength = 60): string {
  const parts = recipe.ingredients.slice(0, 5).map((i) => i.name).filter(Boolean);
  const text = parts.join(", ") || "No ingredients";
  return text.length > maxLength ? text.slice(0, maxLength).trim() + "…" : text;
}

export function RecipeCard({
  recipe,
  isHighlighted,
  isMenuOpen,
  menuRef,
  onMenuToggle,
  onMenuClose,
  onDelete,
  isDeleting,
}: {
  recipe: Recipe;
  isHighlighted: boolean;
  isMenuOpen: boolean;
  menuRef: React.RefObject<HTMLDivElement>;
  onMenuToggle: (e: React.MouseEvent) => void;
  onMenuClose: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const preview = ingredientPreview(recipe);

  return (
    <li
      className="recipe-card-hover"
      style={{
        ...cardStyle,
        ...(isHighlighted ? highlightCardStyle : {}),
      }}
    >
      <Link href={`/recipe/${recipe.id}`} style={cardLinkStyle}>
        <div style={thumbWrapStyle}>
          {recipe.thumbnail_url ? (
            <img
              src={recipe.thumbnail_url}
              alt=""
              style={thumbStyle}
            />
          ) : (
            <div style={thumbPlaceholderStyle} className="recipeCardPlaceholder">
              <span style={thumbPlaceholderText}>Recipe</span>
            </div>
          )}
          <div style={titleOverlayStyle}>
            <h2 style={titleStyle}>{recipe.title}</h2>
            <p style={previewLineStyle} title={preview}>
              {preview}
            </p>
          </div>
        </div>
      </Link>
      <div style={menuWrapStyle} ref={isMenuOpen ? menuRef : undefined}>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onMenuToggle(e);
          }}
          style={menuTriggerStyle}
          aria-label="Options"
          aria-expanded={isMenuOpen}
        >
          ⋮
        </button>
        {isMenuOpen && (
          <div style={dropdownStyle}>
            <Link href={`/library/${recipe.id}`} style={dropdownItemStyle} onClick={onMenuClose}>
              Edit
            </Link>
            <button
              type="button"
              onClick={() => {
                onDelete();
                onMenuClose();
              }}
              disabled={isDeleting}
              style={dropdownItemStyle}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </button>
            {recipe.source_url && (
              <a
                href={recipe.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={dropdownItemStyle}
                onClick={onMenuClose}
              >
                Source
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

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
  position: "relative",
  width: "100%",
  aspectRatio: "1",
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
  background: "linear-gradient(145deg, var(--surface-elevated) 0%, var(--surface) 40%, var(--border) 100%)",
  position: "relative",
};

const thumbPlaceholderText: React.CSSProperties = {
  fontSize: "0.9rem",
  color: "var(--muted)",
  position: "relative",
  zIndex: 1,
};

const titleOverlayStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  padding: "var(--space-24) var(--space-16) var(--space-12)",
  background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
  color: "var(--text)",
};

const titleStyle: React.CSSProperties = {
  fontSize: "1rem",
  fontWeight: 600,
  margin: "0 0 var(--space-4) 0",
  lineHeight: 1.3,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const previewLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8rem",
  color: "var(--muted)",
  lineHeight: 1.3,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const menuWrapStyle: React.CSSProperties = {
  position: "absolute",
  top: "var(--space-8)",
  right: "var(--space-8)",
  zIndex: 2,
};

const menuTriggerStyle: React.CSSProperties = {
  minWidth: 36,
  minHeight: 36,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(26, 26, 24, 0.9)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--text)",
  fontSize: "1.1rem",
  lineHeight: 1,
  cursor: "pointer",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  right: 0,
  marginTop: "var(--space-4)",
  minWidth: 120,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  boxShadow: "var(--shadow-card-hover)",
  padding: "var(--space-8) 0",
  zIndex: 10,
};

const dropdownItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  minHeight: 40,
  padding: "0.5rem 0.75rem",
  background: "none",
  border: "none",
  textAlign: "left",
  fontSize: "0.9rem",
  color: "var(--text)",
  textDecoration: "none",
  cursor: "pointer",
  boxSizing: "border-box",
};
