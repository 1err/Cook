"use client";

import { useRef, useState } from "react";
import type { RecipeAuthor } from "@cooking/shared";
import { apiFetch } from "../lib/api";
import { useAccountScope } from "../lib/useAccountScope";
import { useT } from "../lib/i18n";
import { AuthorPicker } from "./AuthorPicker";
import { RecipeAuthorCredit } from "./RecipeAuthorCredit";
import { Button } from "./ui/Button";
import styles from "./RecipeAuthor.module.css";

function AuthorEditForm({ recipeId, author, disabled, onSaved, onCancel }: {
  recipeId: string; author?: RecipeAuthor | null; disabled?: boolean;
  onSaved: (author: RecipeAuthor | null) => void; onCancel: () => void;
}) {
  const t = useT();
  const scope = useAccountScope();
  const actor = useRef(scope.capture());
  const [selected, setSelected] = useState(author ?? null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(false);
  async function save() {
    if (!actor.current || !scope.active(actor.current) || busy || creating || disabled) return;
    const captured = actor.current;
    setBusy(true); setError(false);
    try {
      const response = await apiFetch(`/recipes/${encodeURIComponent(recipeId)}`, { method: "PATCH",
        headers: { "X-Chef-World-Account-ID": captured.id }, body: JSON.stringify({ author_id: selected?.id ?? null }),
      });
      if (!response.ok) throw new Error("Author save failed");
      const result = await response.json();
      if (scope.active(captured)) onSaved(result.author === undefined ? selected : result.author);
    } catch {
      if (scope.active(captured)) setError(true);
    } finally { if (scope.active(captured)) setBusy(false); }
  }
  return <div className={styles.pickerPanel}>
    <AuthorPicker initialOpen value={selected} onChange={setSelected} disabled={busy || disabled} onBusyChange={setCreating} />
    {error ? <p role="alert">{t("recipe.author.saveError")}</p> : null}
    <div className={styles.actions}>
      <Button size="sm" loading={busy} disabled={creating || disabled} onClick={() => void save()}>{t("common.save")}</Button>
      <Button size="sm" variant="ghost" disabled={busy || creating} onClick={onCancel}>{t("common.cancel")}</Button>
    </div>
  </div>;
}

export function RecipeAuthorEditor({ recipeId, author, onSaved, disabled }: {
  recipeId: string; author?: RecipeAuthor | null; onSaved: (author: RecipeAuthor | null) => void; disabled?: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() { setEditing(false); requestAnimationFrame(() => trigger.current?.focus()); }
  return <div className={styles.inline}>
    <RecipeAuthorCredit author={author} />
    {editing ? <AuthorEditForm recipeId={recipeId} author={author} disabled={disabled} onSaved={value => { onSaved(value); close(); }} onCancel={close} />
      : <button ref={trigger} type="button" className={styles.inlineTrigger} disabled={disabled} onClick={() => setEditing(true)}>{t(author ? "recipe.author.edit" : "recipe.author.add")}</button>}
  </div>;
}
