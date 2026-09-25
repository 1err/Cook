"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { uploadRecipeImage } from "../lib/uploadRecipeImage";
import { useT } from "../lib/i18n";
import styles from "./RecipeCoverEditor.module.css";

export interface RecipeCoverEditorProps {
  value?: string | null;
  onChange: (url: string) => void | Promise<void>;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  variant?: "editor" | "hero";
}

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function RecipeCoverEditor({ value, onChange, disabled = false, onBusyChange, variant = "editor" }: RecipeCoverEditorProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const callbacks = useRef({ onChange, onBusyChange });
  callbacks.current = { onChange, onBusyChange };
  const helpId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const cover = value?.trim();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || disabled || pending.current) return;
    setUpdated(false);
    setError(null);
    if (!imageTypes.has(file.type.toLowerCase())) {
      setError(t("recipe.cover.invalidFile"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t("recipe.cover.tooLarge"));
      return;
    }
    pending.current = true;
    setBusy(true);
    callbacks.current.onBusyChange?.(true);
    try {
      const url = await uploadRecipeImage(file, t("recipe.cover.uploadFailed"));
      if (!mounted.current) return;
      // The parent may have newer draft edits by the time the upload finishes.
      await callbacks.current.onChange(url);
      if (mounted.current) setUpdated(true);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : t("recipe.cover.uploadFailed"));
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        callbacks.current.onBusyChange?.(false);
      }
    }
  }

  return (
    <div className={`${styles.editor} ${variant === "hero" ? styles.hero : ""}`} aria-busy={busy || undefined}>
      {variant === "editor" ? <span className={styles.label}>{t("recipe.coverImage")}</span> : null}
      <div className={styles.preview}>
        {cover ? <img src={cover} alt={t("recipe.coverImage")} /> : <span className="cw-display" aria-hidden>CW</span>}
        {variant === "hero" ? <button type="button" className={styles.changeButton} disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy ? t("recipe.uploading") : t(cover ? "recipe.cover.change" : "recipe.cover.add")}
        </button> : null}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label={t("recipe.coverImage")}
        aria-describedby={helpId} disabled={disabled || busy} onChange={(event) => void chooseImage(event)} className={styles.hiddenInput} tabIndex={-1} />
      {variant === "editor" ? <>
        <button type="button" className={styles.changeButton} disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy ? t("recipe.uploading") : t(cover ? "recipe.cover.change" : "recipe.cover.add")}
        </button>
        <small id={helpId} className={styles.help}>{t("recipe.cover.help")}</small>
      </> : <span id={helpId} className={styles.hiddenInput}>{t("recipe.cover.help")}</span>}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <span className={updated ? styles.success : styles.hiddenInput} role="status">{busy ? t("recipe.uploading") : updated ? t("recipe.cover.updated") : ""}</span>
    </div>
  );
}
