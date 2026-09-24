"use client";

import { useState } from "react";
import { Icon } from "../components/ui/Icon";
import { useT } from "../lib/i18n";
import { RECIPE_TAG_GROUPS, type RecipeTagSlug } from "../lib/recipeCategories";
import styles from "./ImportFlow.module.css";

export type ImportSourceValues = {
  mode: "link" | "transcript" | "media";
  url: string;
  transcript: string;
  notes: string;
  title: string;
  libraryTags: RecipeTagSlug[];
};

type ImportSourceStepProps = {
  mediaEnabled?: boolean;
  maxMediaBytes?: number;
  media?: File | null;
  onMediaChange?: (file: File | null) => void;
  values: ImportSourceValues;
  parsing: boolean;
  error: string | null;
  onChange: (next: ImportSourceValues) => void;
  onSubmit: () => void;
};

export function ImportSourceStep({
  values,
  mediaEnabled = false, maxMediaBytes, media, onMediaChange,
  parsing,
  error,
  onChange,
  onSubmit,
}: ImportSourceStepProps) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mediaError = media?.size === 0
    ? t("import.mediaEmpty")
    : media && maxMediaBytes !== undefined && media.size > maxMediaBytes
      ? t("import.mediaTooLarge")
      : null;
  const canSubmit =
    values.mode === "media" ? Boolean(media && mediaEnabled && !mediaError) : values.mode === "link" ? values.url.trim().length > 0 : values.transcript.trim().length > 0;

  function update<Key extends keyof ImportSourceValues>(key: Key, value: ImportSourceValues[Key]) {
    onChange({ ...values, [key]: value });
  }

  function toggleTag(tag: RecipeTagSlug) {
    update(
      "libraryTags",
      values.libraryTags.includes(tag)
        ? values.libraryTags.filter((item) => item !== tag)
        : [...values.libraryTags, tag],
    );
  }

  return (
    <form
      className={styles.sourcePanel}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className={styles.sourceTabs} role="tablist" aria-label="Recipe source">
        <button
          type="button"
          role="tab"
          aria-selected={values.mode === "link"}
          onClick={() => update("mode", "link")}
          disabled={parsing}
        >
          {t("import.videoLink")}
        </button>
        {mediaEnabled ? (
          <button
            type="button"
            role="tab"
            aria-selected={values.mode === "media"}
            disabled={parsing}
            onClick={() => update("mode", "media")}
          >
            {t("import.uploadVideo")}
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={values.mode === "transcript"}
          onClick={() => update("mode", "transcript")}
          disabled={parsing}
        >
          {t("import.recipeText")}
        </button>
      </div>

      {values.mode === "link" ? (
        <div className={styles.field} role="tabpanel">
          <label htmlFor="import-source-url">{t("import.sourceUrlLabel")}</label>
          <input
            id="import-source-url"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://www.youtube.com/watch?v=..."
            value={values.url}
            onChange={(event) => update("url", event.target.value)}
            disabled={parsing}
          />
          <small>
            {t("import.sourceHelp")}
          </small>
        </div>
      ) : values.mode === "media" ? (
        <div className={styles.field} role="tabpanel">
          <label htmlFor="import-media">{t("import.uploadVideo")}</label>
          <input id="import-media" type="file" accept="video/*,audio/*" disabled={parsing} onChange={(event) => onMediaChange?.(event.target.files?.[0] ?? null)} />
          {media ? <small role="status">{t("import.mediaSelected", { name: media.name })}</small> : null}
          <small>{t("import.mediaHint")}</small>
          {maxMediaBytes ? <small>{t("import.mediaLimit", { size: Math.floor(maxMediaBytes / 1024 / 1024) })}</small> : null}
          {mediaError ? <p className={styles.error} role="alert">{mediaError}</p> : null}
        </div>
      ) : (
        <div className={styles.field} role="tabpanel">
          <label htmlFor="import-source-text">{t("import.recipeText")}</label>
          {values.url ? <small>{t("import.sourcePreserved")}</small> : null}
          <textarea
            id="import-source-text"
            rows={10}
            placeholder="Paste a recipe, transcript, or ingredient list…"
            value={values.transcript}
            onChange={(event) => update("transcript", event.target.value)}
            disabled={parsing}
          />
        </div>
      )}

      <button
        type="button"
        className={styles.optionalToggle}
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
        disabled={parsing}
      >
        Optional details <Icon name={detailsOpen ? "chevronDown" : "add"} size={18} />
      </button>

      {detailsOpen ? (
        <div className={styles.optionalDetails}>
          <div className={styles.field}>
            <label htmlFor="import-source-title">Title (optional)</label>
            <input
              id="import-source-title"
              type="text"
              value={values.title}
              onChange={(event) => update("title", event.target.value)}
              disabled={parsing}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="import-source-notes">Notes (optional)</label>
            <textarea
              id="import-source-notes"
              rows={3}
              value={values.notes}
              onChange={(event) => update("notes", event.target.value)}
              disabled={parsing}
            />
          </div>
          <fieldset className={styles.tagPicker} disabled={parsing}>
            <legend>Tags (optional)</legend>
            {RECIPE_TAG_GROUPS.map((group) => (
              <div key={group.id}>
                <p>{group.label}</p>
                <div>
                  {group.tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={values.libraryTags.includes(tag.id)}
                      onClick={() => toggleTag(tag.id)}
                      disabled={parsing}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        </div>
      ) : null}

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.sourceActions}>
        <button type="submit" disabled={!canSubmit || parsing}>
          {parsing ? t("import.processing") : t("import.createDraft")}
        </button>
      </div>
      <p className={styles.sourceHint}>{t("import.sourceReviewHint")}</p>
    </form>
  );
}
