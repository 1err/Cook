"use client";

import { useEffect, useState } from "react";
import type { RecipeAuthor } from "@cooking/shared";
import { apiFetch } from "../lib/api";
import { useAccountScope } from "../lib/useAccountScope";
import { useT } from "../lib/i18n";
import { AuthorPicker } from "./AuthorPicker";
import { RecipeAuthorCredit } from "./RecipeAuthorCredit";
import { Icon } from "./ui/Icon";
import styles from "./RecipeAuthor.module.css";

export function RecipeAuthorEditor({ recipeId, author, onSaved, disabled }: {
  recipeId: string; author?: RecipeAuthor | null; onSaved: (author: RecipeAuthor | null) => void; disabled?: boolean;
}) {
  const t = useT();
  const scope = useAccountScope();
  const [confirmation, setConfirmation] = useState(0);
  useEffect(() => {
    if (!confirmation) return;
    const timer = setTimeout(() => setConfirmation(0), 3000);
    return () => clearTimeout(timer);
  }, [confirmation]);

  async function save(selected: RecipeAuthor | null) {
    const actor = scope.capture();
    if (!actor || disabled) throw new Error("Author edit unavailable");
    const response = await apiFetch("/recipes/" + encodeURIComponent(recipeId), {
      method: "PATCH", headers: { "X-Chef-World-Account-ID": actor.id },
      body: JSON.stringify({ author_id: selected?.id ?? null }),
    });
    if (!response.ok) throw new Error("Author save failed");
    const result = await response.json();
    if (scope.active(actor)) {
      onSaved(result.author === undefined ? selected : result.author);
      setConfirmation(current => current + 1);
    }
  }
  return <div className={styles.byline}>
    <RecipeAuthorCredit detail author={author} />
    <AuthorPicker inline value={author} onChange={save} disabled={disabled} />
    <span className={styles.confirmation} role="status">{confirmation > 0 && <>
      <Icon name="check" size={14} />{t("recipe.author.saved")}
    </>}</span>
  </div>;
}
