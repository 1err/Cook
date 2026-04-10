"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { CATEGORY_LABELS, RECIPE_TAG_GROUPS, categoryBadgeStyle, type RecipeTagSlug } from "../lib/recipeCategories";
import type { IngredientItem, Recipe } from "../types";

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [libraryTags, setLibraryTags] = useState<RecipeTagSlug[]>([]);
  const [mode, setMode] = useState<"link" | "transcript">("link");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRecipe, setDraftRecipe] = useState<Recipe | null>(null);

  function togglePresetTag(tag: RecipeTagSlug) {
    setLibraryTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  }

  function toggleDraftTag(tag: RecipeTagSlug) {
    setDraftRecipe((prev) => {
      if (!prev) return prev;
      const nextTags = prev.library_tags ?? [];
      return {
        ...prev,
        library_tags: nextTags.includes(tag)
          ? nextTags.filter((item) => item !== tag)
          : [...nextTags, tag],
      };
    });
  }

  function updateDraftIngredient(index: number, field: keyof IngredientItem, value: string | null) {
    setDraftRecipe((prev) => {
      if (!prev) return prev;
      const nextIngredients = [...prev.ingredients];
      if (!nextIngredients[index]) return prev;
      nextIngredients[index] = { ...nextIngredients[index], [field]: value ?? "" };
      return { ...prev, ingredients: nextIngredients };
    });
  }

  function removeDraftIngredient(index: number) {
    setDraftRecipe((prev) => {
      if (!prev) return prev;
      return { ...prev, ingredients: prev.ingredients.filter((_, itemIndex) => itemIndex !== index) };
    });
  }

  function addDraftIngredient() {
    setDraftRecipe((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        ingredients: [...prev.ingredients, { name: "", quantity: "", notes: "" }],
      };
    });
  }

  async function handleDraftImageFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch("/recipes/upload-image", { method: "POST", body: form });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Upload failed"));
      }
      const { upload_url, file_url } = (await res.json()) as { upload_url: string; file_url: string };
      if (upload_url) {
        await fetch(upload_url, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
      }
      setDraftRecipe((prev) => (prev ? { ...prev, thumbnail_url: file_url } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingImage(false);
      event.target.value = "";
    }
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
        throw new Error(await readErrorMessage(res, "Import failed"));
      }
      const recipe: Recipe = await res.json();
      setDraftRecipe(recipe);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveRecipe() {
    if (!draftRecipe) return;
    setError(null);
    setSaving(true);
    try {
      const res = await apiFetch("/recipes", {
        method: "POST",
        body: JSON.stringify({
          ...draftRecipe,
          ingredients: draftRecipe.ingredients.filter((item) => item.name.trim()),
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Save failed"));
      }
      const saved: Recipe = await res.json();
      router.push(`/library?highlight=${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = mode === "link" ? url.trim().length > 0 : transcript.trim().length > 0;
  const draftTags = draftRecipe?.library_tags ?? [];
  const previewText = useMemo(() => {
    if (!draftRecipe) return "";
    const names = draftRecipe.ingredients.map((item) => item.name).filter(Boolean);
    return names.join(", ");
  }, [draftRecipe]);

  return (
    <RequireAuth>
      <div className="import-editorial">
        <div className="import-editorial__header">
          <span className="import-editorial__kicker font-headline">{draftRecipe ? "Review recipe" : "Import recipe"}</span>
          <h1 className="import-editorial__title font-headline">
            {draftRecipe ? (
              <>
                Review and <br />
                <span>save your recipe</span>
              </>
            ) : (
              <>
                Add a recipe <br />
                <span>to your library</span>
              </>
            )}
          </h1>
          <p className="import-editorial__sub">
            {draftRecipe
              ? "Check the title, ingredients, units, and tags before saving."
              : "Import from a YouTube link or paste a transcript, then review the result before saving."}
          </p>
        </div>

        <div className={`import-engine${draftRecipe ? " import-engine--review" : ""}`}>
          {!draftRecipe ? (
            <>
              <div className="import-engine__meta-grid">
                <div>
                  <label className="import-engine__label" htmlFor="import-title">
                    Title (optional)
                  </label>
                  <input
                    id="import-title"
                    className="import-engine__input import-engine__input--plain"
                    type="text"
                    placeholder="Optional recipe title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label className="import-engine__label">
                    Recipe tags (optional)
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
                      Tags: {libraryTags.map((tag) => CATEGORY_LABELS[tag]).join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="import-engine__tabs">
                <button
                  type="button"
                  className={`import-engine__tab font-headline${mode === "link" ? " is-active" : ""}`}
                  onClick={() => setMode("link")}
                >
                  Video link
                </button>
                <button
                  type="button"
                  className={`import-engine__tab font-headline${mode === "transcript" ? " is-active" : ""}`}
                  onClick={() => setMode("transcript")}
                >
                  Paste transcript
                </button>
              </div>

              {mode === "link" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  <div>
                    <label className="import-engine__label" htmlFor="import-url">
                      Video URL
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
                      Link import currently supports YouTube. For other sources, paste the transcript instead.
                    </p>
                  </div>
                  <div>
                    <label className="import-engine__label" htmlFor="import-notes-link">
                      Extra details (optional)
                    </label>
                    <textarea
                      id="import-notes-link"
                      className="import-engine__textarea"
                      placeholder="Add servings, dietary goals, or anything important to keep in mind."
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
                      Transcript or ingredient list
                    </label>
                    <textarea
                      id="import-transcript"
                      className="import-engine__textarea"
                      placeholder="Paste the transcript or ingredient list here."
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      disabled={loading}
                      rows={8}
                    />
                  </div>
                  <div>
                    <label className="import-engine__label" htmlFor="import-notes-tx">
                      Extra details (optional)
                    </label>
                    <textarea
                      id="import-notes-tx"
                      className="import-engine__textarea"
                      placeholder="Add servings, dietary goals, or anything important to keep in mind."
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
                      Parsing…
                      <span className="material-symbols-outlined ms-fill import-spin" style={{ fontSize: "1.25rem" }}>
                        progress_activity
                      </span>
                    </>
                  ) : (
                    <>
                      Preview recipe
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
                  You can review and edit everything before saving.
                </p>
              </div>
            </>
          ) : (
            <div className="import-review-grid">
              <div>
                <div className="import-review-card recipe-card-stitch">
                  <div className="recipe-card-stitch__media">
                    {draftRecipe.thumbnail_url ? (
                      <>
                        <img src={draftRecipe.thumbnail_url} alt="" className="recipe-card-stitch__img recipe-card-stitch__img--bg" />
                        <div className="recipe-card-stitch__img-frame">
                          <img src={draftRecipe.thumbnail_url} alt="" className="recipe-card-stitch__img recipe-card-stitch__img--full" />
                        </div>
                      </>
                    ) : (
                      <div className="recipe-card-stitch__placeholder recipeCardPlaceholder">
                        <span className="font-headline recipe-card-stitch__placeholder-text">Recipe</span>
                      </div>
                    )}
                    {draftTags[0] ? (
                      <span className="recipe-card-stitch__badge font-headline" style={categoryBadgeStyle(draftTags[0])}>
                        {CATEGORY_LABELS[draftTags[0]]}
                      </span>
                    ) : null}
                  </div>
                  <div className="recipe-card-stitch__meta">
                    <div className="recipe-card-stitch__meta-left">
                      <h2 className="font-headline recipe-card-stitch__title">{draftRecipe.title || "Untitled recipe"}</h2>
                      <p className="recipe-card-stitch__sub" title={previewText}>
                        {previewText || "Review the imported ingredients and save when ready."}
                      </p>
                      {draftTags.length > 0 ? (
                        <div className="recipe-card-stitch__tag-row">
                          {draftTags.slice(0, 3).map((tag) => (
                            <span key={tag} className="recipe-card-stitch__tag-mini font-headline">
                              {CATEGORY_LABELS[tag]}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="import-review-panel">
                <section className="import-review-section">
                  <div className="import-review-section__head">
                    <label className="import-engine__label" style={{ marginBottom: 0 }}>
                      Cover image
                    </label>
                    <button
                      type="button"
                      className="import-review-add font-headline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImage}
                    >
                      {uploadingImage ? "Uploading…" : "Upload image"}
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleDraftImageFile}
                    style={{ display: "none" }}
                  />
                  <input
                    className="import-engine__input import-engine__input--plain"
                    type="url"
                    placeholder="Or paste an image URL"
                    value={draftRecipe.thumbnail_url ?? ""}
                    onChange={(e) => setDraftRecipe((prev) => (prev ? { ...prev, thumbnail_url: e.target.value } : prev))}
                    disabled={uploadingImage || saving}
                  />
                </section>

                <section className="import-review-section">
                  <label className="import-engine__label" htmlFor="draft-title">
                    Recipe title
                  </label>
                  <input
                    id="draft-title"
                    className="import-engine__input import-engine__input--plain"
                    type="text"
                    value={draftRecipe.title}
                    onChange={(e) => setDraftRecipe((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                    disabled={saving}
                  />
                </section>

                <section className="import-review-section">
                  <div className="import-review-section__head">
                    <label className="import-engine__label" style={{ marginBottom: 0 }}>
                      Ingredients
                    </label>
                    <button type="button" className="import-review-add font-headline" onClick={addDraftIngredient}>
                      + Add
                    </button>
                  </div>
                  <div className="import-review-ingredients">
                    {draftRecipe.ingredients.map((ingredient, index) => (
                      <div key={`${draftRecipe.id}-${index}`} className="import-review-ingredient-row">
                        <input
                          className="import-engine__input import-engine__input--plain"
                          type="text"
                          placeholder="Qty"
                          value={ingredient.quantity}
                          onChange={(e) => updateDraftIngredient(index, "quantity", e.target.value)}
                        />
                        <input
                          className="import-engine__input import-engine__input--plain"
                          type="text"
                          placeholder="Ingredient"
                          value={ingredient.name}
                          onChange={(e) => updateDraftIngredient(index, "name", e.target.value)}
                        />
                        <button
                          type="button"
                          className="import-review-remove"
                          onClick={() => removeDraftIngredient(index)}
                          aria-label="Remove ingredient"
                        >
                          <span className="material-symbols-outlined">close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="import-review-section">
                  <label className="import-engine__label">
                    Tags
                  </label>
                  <div className="recipe-tag-picker recipe-tag-picker--compact">
                    {RECIPE_TAG_GROUPS.map((group) => (
                      <div key={group.id} className="recipe-tag-group">
                        <p className="recipe-tag-group__title font-headline">{group.label}</p>
                        <div className="recipe-tag-group__chips">
                          {group.tags.map((tag) => {
                            const active = draftTags.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                className={`library-chip ${active ? "library-chip--active" : "library-chip--idle"}`}
                                onClick={() => toggleDraftTag(tag.id)}
                              >
                                {tag.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {error ? (
                  <p style={{ color: "var(--error)", fontSize: "0.9rem", marginTop: "0.5rem" }} role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="import-engine__actions">
                  <button
                    type="button"
                    className="import-engine__cta"
                    onClick={handleSaveRecipe}
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        Saving…
                        <span className="material-symbols-outlined ms-fill import-spin" style={{ fontSize: "1.25rem" }}>
                          progress_activity
                        </span>
                      </>
                    ) : (
                      <>
                        Save recipe
                        <span className="material-symbols-outlined" style={{ fontSize: "1.25rem" }}>
                          check
                        </span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="import-review-secondary font-headline"
                    onClick={() => setDraftRecipe(null)}
                    disabled={saving}
                  >
                    Back to import
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </RequireAuth>
  );
}
