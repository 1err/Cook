"use client";

import Link from "next/link";
import { CATEGORY_LABELS } from "../../lib/recipeCategories";
import { getRecipeTags } from "../../lib/recipeTags";
import type { Recipe } from "../../types";
import styles from "./Friends.module.css";

type FriendLibraryCardProps = {
  recipe: Recipe;
  href: string;
  state: "idle" | "copying" | "added";
  onCopy: () => void;
};

export function FriendLibraryCard({ recipe, href, state, onCopy }: FriendLibraryCardProps) {
  const tags = getRecipeTags(recipe).slice(0, 2);
  const buttonLabel =
    state === "added" ? "In your library" : state === "copying" ? "Adding…" : "Add to library";

  return (
    <li className={styles.recipeCard}>
      <Link href={href} className={styles.recipeLink} aria-label={`Open ${recipe.title}`}>
        <div className={styles.recipeMedia}>
          {recipe.thumbnail_url ? (
            <img src={recipe.thumbnail_url} alt="" />
          ) : (
            <span className="cw-display" aria-hidden>CW</span>
          )}
        </div>
        <div className={styles.recipeBody}>
          <h2 className="cw-display">{recipe.title}</h2>
          {recipe.total_time_minutes ? <p>{recipe.total_time_minutes} min</p> : null}
          {tags.length ? (
            <div className={styles.recipeTags} aria-label="Recipe tags">
              {tags.map((tag) => (
                <span key={tag} data-testid="friend-recipe-tag">
                  {CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </Link>
      <div className={styles.recipeAction}>
        <button type="button" onClick={onCopy} disabled={state !== "idle"}>
          {buttonLabel}
        </button>
      </div>
    </li>
  );
}
