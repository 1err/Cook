"use client";

import Link from "next/link";
import type { Recipe } from "../types";
import { CATEGORY_LABELS } from "../lib/recipeCategories";
import { getRecipeTags } from "../lib/recipeTags";
import styles from "./RecipeCard.module.css";

type RecipeCardProps = {
  recipe: Recipe;
  isHighlighted?: boolean;
};

export function RecipeCard({ recipe, isHighlighted = false }: RecipeCardProps) {
  const featuredTags = getRecipeTags(recipe).slice(0, 2);

  return (
    <li className={`${styles.card} ${isHighlighted ? styles.highlighted : ""}`}>
      <Link href={`/recipe/${recipe.id}`} className={styles.link}>
        <div className={styles.media}>
          {recipe.thumbnail_url ? (
            <img src={recipe.thumbnail_url} alt="" className={styles.image} />
          ) : (
            <div className={styles.placeholder} aria-hidden>
              <span className="cw-display">CW</span>
            </div>
          )}
        </div>

        <div className={styles.body}>
          <h2 className={`cw-display ${styles.title}`}>{recipe.title}</h2>

          {featuredTags.length ? (
            <div className={styles.tags} aria-label="Recipe tags">
              {featuredTags.map((tag) => (
                <span key={tag} className={styles.tag} data-testid="recipe-tag">
                  {CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
