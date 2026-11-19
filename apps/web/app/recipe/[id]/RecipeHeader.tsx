"use client";

import type { ReactNode } from "react";
import { getRecipeTags, isSafeExternalUrl, TAG_LABELS, type Recipe } from "@cooking/shared";
import { RecipeTimingDetails } from "../../components/RecipeTimingDetails";
import { Icon } from "../../components/ui/Icon";
import { useT } from "../../lib/i18n";
import styles from "./RecipeDetail.module.css";

export function RecipeHeader({ recipe, author, management, children, feedback }: {
  recipe: Recipe;
  author: ReactNode;
  management?: ReactNode;
  children: ReactNode;
  feedback?: ReactNode;
}) {
  const t = useT();
  const tags = getRecipeTags(recipe);

  return (
    <header className={styles.recipeHeader}>
      <div className={styles.titleRow}>
        <h1 className="cw-display">{recipe.title}</h1>
        {management}
      </div>
      <div className={styles.attribution}>
        {author}
        {isSafeExternalUrl(recipe.source_url) && (
          <a className={styles.source} href={recipe.source_url} target="_blank" rel="noopener noreferrer">
            {t("recipe.originalVideo")} <Icon name="externalLink" size={14} />
          </a>
        )}
      </div>
      {recipe.description && <p className={styles.description}>{recipe.description}</p>}
      {tags.length > 0 && (
        <ul className={styles.tags} aria-label={t("recipe.tags")}>
          {tags.map(tag => (
            <li key={tag}>{Object.hasOwn(TAG_LABELS, tag) ? t(`recipe.tag.${tag}`) : tag.replace(/_/g, " ")}</li>
          ))}
        </ul>
      )}
      <RecipeTimingDetails recipe={recipe} />
      <div className={styles.actions}>{children}</div>
      {feedback}
    </header>
  );
}
