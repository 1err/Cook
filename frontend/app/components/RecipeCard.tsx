"use client";

import Link from "next/link";
import type { Recipe } from "../types";
import {
  CATEGORY_LABELS,
  categoryBadgeStyle,
  type LibraryCategorySlug,
} from "../lib/recipeCategories";

function ingredientPreview(recipe: Recipe, maxLength = 72): string {
  const parts = recipe.ingredients.slice(0, 4).map((i) => i.name).filter(Boolean);
  const text = parts.join(", ") || "Tap to open";
  return text.length > maxLength ? text.slice(0, maxLength).trim() + "…" : text;
}

export function RecipeCard({ recipe, isHighlighted }: { recipe: Recipe; isHighlighted: boolean }) {
  const preview = ingredientPreview(recipe);
  const cat = recipe.library_category as LibraryCategorySlug | null | undefined;

  return (
    <li
      className="recipe-card-stitch recipe-card-hover"
      style={{
        ...(isHighlighted ? { boxShadow: "0 0 0 2px var(--primary), var(--kitchen-glow-lg)" } : {}),
      }}
    >
      <Link href={`/recipe/${recipe.id}`} className="recipe-card-stitch__link">
        <div className="recipe-card-stitch__media">
          {recipe.thumbnail_url ? (
            <img src={recipe.thumbnail_url} alt="" className="recipe-card-stitch__img" />
          ) : (
            <div className="recipe-card-stitch__placeholder recipeCardPlaceholder">
              <span className="font-headline recipe-card-stitch__placeholder-text">Recipe</span>
            </div>
          )}
          <span className="recipe-card-stitch__fav" aria-hidden title="In your library">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 21s-6.716-4.196-9.5-8.5C.5 9.5 2 6 5.5 6 8 6 12 9 12 9s4-3 6.5-3C22 6 23.5 9.5 21 12.5 18.716 16.804 12 21 12 21Z"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          {cat && CATEGORY_LABELS[cat] && (
            <span className="recipe-card-stitch__badge font-headline" style={categoryBadgeStyle(cat)}>
              {CATEGORY_LABELS[cat]}
            </span>
          )}
        </div>
        <div className="recipe-card-stitch__meta">
          <div className="recipe-card-stitch__meta-left">
            <h2 className="font-headline recipe-card-stitch__title">{recipe.title}</h2>
            <p className="recipe-card-stitch__sub" title={preview}>
              {preview}
            </p>
          </div>
        </div>
      </Link>
    </li>
  );
}
