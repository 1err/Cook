"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { useT } from "../lib/i18n";
import { CATEGORY_LABELS, RECIPE_TAG_GROUPS, type RecipeTagSlug } from "../lib/recipeCategories";
import type { Recipe } from "../types";
import { DraftRecipeEditor } from "./DraftRecipeEditor";

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const text = await res.text();
    if (!text.trim()) return fallback;
    try {
      const data = JSON.parse(text);
      if (data && typeof data === "object" && typeof data.detail === "string" && data.detail.trim()) {
        return data.detail;
      }
    } catch {
      return text;
    }
    return text;
  } catch {
    return fallback;
  }
}

export default function ImportPage() {
  const router = useRouter();
  const t = useT();
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [libraryTags, setLibraryTags] = useState<RecipeTagSlug[]>([]);
  const [mode, setMode] = useState<"link" | "transcript">("transcript");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRecipe, setDraftRecipe] = useState<Recipe | null>(null);

  function togglePresetTag(tag: RecipeTagSlug) {
    setLibraryTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  }

  async function handleImportPreview() {
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === "link" ? "/recipes/parse/link" : "/recipes/parse/transcript";
      const body =
        mode === "link"
          ? {
              url: url.trim(),
              notes,
              title: title.trim(),
              library_tags: libraryTags,
            }
          : {
              transcript,
              notes,
              title: title.trim(),
              library_tags: libraryTags,
            };
      const res = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, t("import.importRecipe")));
      }
      const recipe: Recipe = await res.json();
      setDraftRecipe(recipe);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("import.importRecipe"));
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = mode === "link" ? url.trim().length > 0 : transcript.trim().length > 0;

  return (
    <RequireAuth>
      <div className="import-editorial">
        <div className="import-editorial__header">
          <span className="import-editorial__kicker font-headline">{draftRecipe ? t("import.reviewRecipe") : t("import.importRecipe")}</span>
          <h1 className="import-editorial__title font-headline">
            {draftRecipe ? (
              <>
                {t("import.reviewAndSave")}
              </>
            ) : (
              <>
                {t("import.addToLibrary")}
              </>
            )}
          </h1>
          <p className="import-editorial__sub">
            {draftRecipe
              ? t("import.reviewSub")
              : t("import.importSub")}
          </p>
        </div>

        <div className={`import-engine${draftRecipe ? " import-engine--review" : ""}`}>
          {!draftRecipe ? (
            <>
              <div className="import-engine__meta-grid">
                <div>
                  <label className="import-engine__label" htmlFor="import-title">
                    {t("import.titleOptional")}
                  </label>
                  <input
                    id="import-title"
                    className="import-engine__input import-engine__input--plain"
                    type="text"
                    placeholder={t("import.optionalRecipeTitle")}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label className="import-engine__label">
                    {t("import.recipeTagsOptional")}
                  </label>
                  <div className="recipe-tag-picker recipe-tag-picker--compact">
                    {RECIPE_TAG_GROUPS.map((group) => (
                      <div key={group.id} className="recipe-tag-group">
                        <p className="recipe-tag-group__title font-headline">{group.label}</p>
                        <div className="recipe-tag-group__chips">
                          {group.tags.map((tag) => {
                            const active = libraryTags.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                className={`library-chip ${active ? "library-chip--active" : "library-chip--idle"}`}
                                onClick={() => togglePresetTag(tag.id)}
                                disabled={loading}
                              >
                                {tag.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  {libraryTags.length > 0 ? (
                    <p className="import-engine__hint" style={{ marginTop: "0.65rem" }}>
                      {t("import.tagsList", { tags: libraryTags.map((tag) => CATEGORY_LABELS[tag]).join(", ") })}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="import-engine__tabs">
                <button
                  type="button"
                  className={`import-engine__tab font-headline${mode === "transcript" ? " is-active" : ""}`}
                  onClick={() => setMode("transcript")}
                >
                  {t("import.pasteTranscript")}
                </button>
                <button
                  type="button"
                  className={`import-engine__tab font-headline${mode === "link" ? " is-active" : ""}`}
                  onClick={() => setMode("link")}
                >
                  {t("import.videoLink")}
                </button>
              </div>

              {mode === "link" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  <div>
                    <label className="import-engine__label" htmlFor="import-url">
                      {t("import.videoUrl")}
                    </label>
                    <div className="import-engine__field-wrap">
                      <span className="material-symbols-outlined">link</span>
                      <input
                        id="import-url"
                        className="import-engine__input"
                        type="url"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        disabled={loading}
                      />
                    </div>
                    <p className="import-engine__hint" style={{ marginTop: "0.5rem" }}>
                      {t("import.linkHint")}
                    </p>
                  </div>
                  <div>
                    <label className="import-engine__label" htmlFor="import-notes-link">
                      {t("import.extraDetails")}
                    </label>
                    <textarea
                      id="import-notes-link"
                      className="import-engine__textarea"
                      placeholder={t("import.extraDetailsPlaceholder")}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      disabled={loading}
                      rows={4}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  <div>
                    <label className="import-engine__label" htmlFor="import-transcript">
                      {t("import.transcriptOrIngredients")}
                    </label>
                    <textarea
                      id="import-transcript"
                      className="import-engine__textarea"
                      placeholder={t("import.transcriptPlaceholder")}
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      disabled={loading}
                      rows={8}
                    />
                  </div>
                  <div>
                    <label className="import-engine__label" htmlFor="import-notes-tx">
                      {t("import.extraDetails")}
                    </label>
                    <textarea
                      id="import-notes-tx"
                      className="import-engine__textarea"
                      placeholder={t("import.extraDetailsPlaceholder")}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      disabled={loading}
                      rows={3}
                    />
                  </div>
                </div>
              )}

              {error ? (
                <p style={{ color: "var(--error)", fontSize: "0.9rem", marginTop: "1rem" }} role="alert">
                  {error}
                </p>
              ) : null}

              <div className="import-engine__actions">
                <button
                  type="button"
                  className="import-engine__cta"
                  onClick={handleImportPreview}
                  disabled={loading || !canSubmit}
                >
                  {loading ? (
                    <>
                      {t("import.parsing")}
                      <span className="material-symbols-outlined ms-fill import-spin" style={{ fontSize: "1.25rem" }}>
                        progress_activity
                      </span>
                    </>
                  ) : (
                    <>
                      {t("import.previewRecipe")}
                      <span className="material-symbols-outlined" style={{ fontSize: "1.25rem" }}>
                        visibility
                      </span>
                    </>
                  )}
                </button>
                <p className="import-engine__hint">
                  <span className="material-symbols-outlined" style={{ fontSize: "1rem", color: "var(--tertiary)" }}>
                    check_circle
                  </span>
                  {t("import.reviewBeforeSaving")}
                </p>
              </div>
            </>
          ) : (
            <DraftRecipeEditor
              draft={draftRecipe}
              onChange={setDraftRecipe}
              onBack={() => setDraftRecipe(null)}
              onSaveSuccess={(savedId) => router.push(`/library?highlight=${savedId}`)}
            />
          )}
        </div>
      </div>
    </RequireAuth>
  );
}
