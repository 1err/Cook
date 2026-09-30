"use client";

import { useId, useState } from "react";
import { isSafeExternalUrl } from "@cooking/shared";
import { apiFetch } from "../../lib/api";
import { useT } from "../../lib/i18n";
import type { Recipe } from "../../types";
import styles from "./RecipeEdit.module.css";

export function SourceLinkEditor({ recipeId, value, disabled, onSaved, onBusyChange }: {
  recipeId: string;
  value?: string | null;
  disabled: boolean;
  onSaved: (value: string | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useT();
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || disabled) return;
    const next = draft.trim();
    if (!isSafeExternalUrl(next) || next.length > 4096) {
      setError(t("recipe.sourceLinkInvalid"));
      return;
    }
    setSaving(true);
    onBusyChange(true);
    setError(null);
    try {
      const response = await apiFetch(`/recipes/${recipeId}`, {
        method: "PATCH",
        body: JSON.stringify({ source_url: next }),
      });
      if (!response.ok) throw new Error("Source link save failed");
      const updated: Recipe = await response.json();
      onSaved(updated.source_url ?? null);
      setEditing(false);
      setSaved(true);
    } catch {
      setError(t("recipe.sourceLinkSaveError"));
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  }

  return (
    <div className={styles.sourceEditor}>
      {editing ? (
        <form onSubmit={save} noValidate>
          <label htmlFor={inputId}>{t("recipe.sourceLinkLabel")}</label>
          <input id={inputId} type="url" inputMode="url" autoFocus autoComplete="off"
            placeholder="https://" value={draft} maxLength={4096}
            disabled={disabled || saving} aria-invalid={Boolean(error)}
            aria-describedby={error ? `${inputId}-error` : undefined}
            onChange={(event) => { setDraft(event.target.value); setError(null); }} />
          <div className={styles.sourceActions}>
            <button type="submit" className={styles.secondaryButton} disabled={disabled || saving}>
              {saving ? t("common.saving") : t("recipe.saveSourceLink")}
            </button>
            <button type="button" className={styles.textButton} disabled={saving}
              onClick={() => { setEditing(false); setError(null); }}>{t("common.cancel")}</button>
          </div>
          {error ? <p id={`${inputId}-error`} className={styles.error} role="alert">{error}</p> : null}
        </form>
      ) : (
        <div className={styles.sourceActions}>
          {isSafeExternalUrl(value) ? (
            <a href={value} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
              {t("recipe.openSourceLink")} ↗
            </a>
          ) : null}
          <button type="button" className={styles.secondaryButton} disabled={disabled}
            onClick={() => { setDraft(value ?? ""); setError(null); setSaved(false); setEditing(true); }}>
            {value ? t("recipe.editSourceLink") : t("recipe.addSourceLink")}
          </button>
        </div>
      )}
      <span role="status" className={styles.sourceStatus}>{saved ? t("recipe.sourceLinkSaved") : ""}</span>
    </div>
  );
}
