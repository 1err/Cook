"use client";

import { useState } from "react";
import { RECIPE_TAG_GROUPS, type RecipeTagSlug } from "../lib/recipeCategories";
import styles from "./ImportFlow.module.css";

export type ImportSourceValues = {
  mode: "link" | "transcript";
  url: string;
  transcript: string;
  notes: string;
  title: string;
  libraryTags: RecipeTagSlug[];
};

type ImportSourceStepProps = {
  values: ImportSourceValues;
  parsing: boolean;
  error: string | null;
  onChange: (next: ImportSourceValues) => void;
  onSubmit: () => void;
};

export function ImportSourceStep({
  values,
  parsing,
  error,
  onChange,
  onSubmit,
}: ImportSourceStepProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canSubmit =
    values.mode === "link" ? values.url.trim().length > 0 : values.transcript.trim().length > 0;

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
        >
          YouTube link
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={values.mode === "transcript"}
          onClick={() => update("mode", "transcript")}
        >
          Paste recipe text
        </button>
      </div>

      {values.mode === "link" ? (
        <div className={styles.field} role="tabpanel">
          <label htmlFor="import-source-url">YouTube URL</label>
          <input
            id="import-source-url"
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={values.url}
            onChange={(event) => update("url", event.target.value)}
            disabled={parsing}
          />
          <small>The video needs captions so the recipe can be read accurately.</small>
        </div>
      ) : (
        <div className={styles.field} role="tabpanel">
          <label htmlFor="import-source-text">Recipe text</label>
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
      >
        Optional details <span aria-hidden>{detailsOpen ? "−" : "+"}</span>
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
          <fieldset className={styles.tagPicker}>
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
          {parsing ? "Creating draft…" : "Create draft"}
        </button>
      </div>
    </form>
  );
}
