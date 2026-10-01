"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { RecipeTiming } from "./RecipeTiming";
import type { Recipe } from "../types";
import { useT } from "../lib/i18n";
import { getRecipeTags } from "../lib/recipeTags";
import styles from "./RecipeCard.module.css";

type RecipeCardProps = {
  recipe: Pick<Recipe, "id" | "title" | "thumbnail_url" | "library_tags" | "library_category" | "total_time_minutes" | "timing_summary">;
  isHighlighted?: boolean;
  children?: ReactNode;
};

export function RecipeCard({ recipe, isHighlighted = false, children }: RecipeCardProps) {
  const t = useT();
  const featuredTags = getRecipeTags(recipe).slice(0, 2);

  return (
    <article role="listitem" className={`${styles.card} ${isHighlighted ? styles.highlighted : ""}`}>
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
        </div>
      </Link>
      <div className={styles.metadata}>
        <RecipeTiming {...recipe} />
        {featuredTags.length ? (
          <div className={styles.tags} aria-label={t("recipe.tags")}>
            {featuredTags.map((tag) => (
              <span key={tag} className={styles.tag} data-testid="recipe-tag">
                {t(`recipe.tag.${tag}`)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {children}
    </article>
  );
}
