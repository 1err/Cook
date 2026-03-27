"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { RequireAuth } from "../../components/RequireAuth";
import {
  LIBRARY_FILTER_CHIPS,
  type LibraryCategorySlug,
} from "../../lib/recipeCategories";
import type { Recipe, IngredientItem } from "../../types";

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No tag" },
  ...LIBRARY_FILTER_CHIPS.filter((c) => c.id !== "all").map((c) => ({
    value: c.id,
    label: c.label,
  })),
];

function RecipeEditContent() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [title, setTitle] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [libraryCategory, setLibraryCategory] = useState<string>("");
  const [ingredients, setIngredients] = useState<IngredientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch(`/recipes/${id}`);
        if (!res.ok) throw new Error("Recipe not found");
        const data: Recipe = await res.json();
        if (!cancelled) {
          setRecipe(data);
          setTitle(data.title);
          setThumbnailUrl(data.thumbnail_url ?? "");
          setLibraryCategory(data.library_category ?? "");
          setIngredients(data.ingredients?.length ? [...data.ingredients] : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  function updateIngredient(index: number, field: keyof IngredientItem, value: string | null) {
    setIngredients((prev) => {
      const next = [...prev];
      if (!next[index]) return next;
      next[index] = { ...next[index], [field]: value ?? "" };
      return next;
    });
  }

  function removeIngredient(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  function addIngredient() {
    setIngredients((prev) => [...prev, { name: "", quantity: "", notes: null }]);
  }

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch("/recipes/upload-image", { method: "POST", body: form });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Upload failed");
      }
      const { upload_url, file_url } = (await res.json()) as { upload_url: string; file_url: string };
      if (upload_url) {
        await fetch(upload_url, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
      }
      setThumbnailUrl(file_url ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingImage(false);
      e.target.value = "";
    }
  }

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim() || recipe?.title,
        thumbnail_url: thumbnailUrl.trim() || null,
        ingredients: ingredients.filter((i) => i.name.trim() !== ""),
      };
      if (libraryCategory) {
        payload.library_category = libraryCategory as LibraryCategorySlug;
      } else {
        payload.library_category = null;
      }
      const res = await apiFetch(`/recipes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save");
      router.push("/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !recipe) return;
    if (!confirm(`Delete “${recipe.title}”?`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await apiFetch(`/recipes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      router.push("/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <p style={mutedStyle}>Loading…</p>;
  if (error && !recipe) return <p style={errorStyle}>{error}</p>;
  if (!recipe) return null;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <header style={pageHeader}>
        <div>
          <span className="font-headline" style={kicker}>
            Edit recipe
          </span>
          <h1 className="font-headline" style={pageTitle}>
            {title.trim() || "Untitled"}
          </h1>
          <p style={pageSub}>Update the cover, tag, and ingredients—changes save to your library.</p>
        </div>
        <div style={headerActions}>
          <button type="button" className="font-headline" style={discardStyle} onClick={() => router.push("/library")}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving} style={{ minHeight: 48 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {error && <p style={{ ...errorStyle, marginBottom: "1rem" }}>{error}</p>}

      <div className="editor-grid">
        <div className="editor-grid__main">
          <section style={section}>
            <label className="font-headline" style={labelUpper}>
              Recipe title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="editor-title-input font-headline"
              placeholder="e.g. Lemon garlic salmon"
            />
          </section>

          <section style={section}>
            <div style={sectionHead}>
              <label className="font-headline" style={labelUpper}>
                Ingredients
              </label>
              <button type="button" className="font-headline" style={addIngStyle} onClick={addIngredient}>
                + Add
              </button>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.65rem" }}>
              {ingredients.map((item, idx) => (
                <li key={idx} style={ingRow}>
                  <input
                    type="text"
                    value={item.quantity}
                    onChange={(e) => updateIngredient(idx, "quantity", e.target.value)}
                    placeholder="Qty"
                    className="input-editorial"
                    style={{ flex: "0 0 88px", minHeight: 46, padding: "0 0.85rem", fontSize: "0.875rem" }}
                  />
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateIngredient(idx, "name", e.target.value)}
                    placeholder="Ingredient"
                    className="input-editorial"
                    style={{ flex: "1 1 120px", minHeight: 46, fontSize: "0.875rem" }}
                  />
                  <button type="button" style={removeIngBtn} onClick={() => removeIngredient(idx)} aria-label="Remove">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="editor-grid__side">
          <div style={uploadZone}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageFile}
              style={{ display: "none" }}
              aria-hidden
            />
            <button
              type="button"
              className="upload-zone-inner"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage}
            >
              <div style={uploadIconWrap}>
                <span style={{ fontSize: "1.75rem" }} aria-hidden>
                  📷
                </span>
              </div>
              <p style={{ margin: "0 0 0.35rem", fontWeight: 700, fontSize: "0.95rem" }}>Cover image</p>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--on-surface-variant)" }}>
                {uploadingImage ? "Uploading…" : "Tap to upload or paste a URL below"}
              </p>
            </button>
            <input
              type="url"
              value={thumbnailUrl}
              onChange={(e) => setThumbnailUrl(e.target.value)}
              className="input-editorial"
              style={{ marginTop: "1rem", minHeight: 46, fontSize: "0.85rem" }}
              placeholder="https://…"
            />
            {thumbnailUrl.trim() && (
              <div style={previewBox}>
                <img src={thumbnailUrl.trim()} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            )}
          </div>

          <div style={metaCard}>
            <label className="font-headline" style={labelUpper}>
              Library tag
            </label>
            <p style={hint}>Used for filters on the library grid (optional).</p>
            <select
              value={libraryCategory}
              onChange={(e) => setLibraryCategory(e.target.value)}
              className="input-editorial"
              style={{ minHeight: 48, fontSize: "0.9rem", cursor: "pointer" }}
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value || "none"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {recipe.source_url && (
            <p style={{ fontSize: "0.85rem", color: "var(--on-surface-variant)", margin: 0 }}>
              <a href={recipe.source_url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                Open source link
              </a>
            </p>
          )}

          <button
            type="button"
            className="font-headline"
            style={deleteBtn}
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete recipe"}
          </button>
        </aside>
      </div>
    </div>
  );
}

export default function RecipeEditPage() {
  return (
    <RequireAuth>
      <div className="app-container">
        <Link href="/library" className="font-headline" style={{ ...mutedStyle, display: "inline-block", marginBottom: "1rem", fontWeight: 700 }}>
          ← Library
        </Link>
        <RecipeEditContent />
      </div>
    </RequireAuth>
  );
}

const pageHeader: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1.25rem",
  marginBottom: "2rem",
};

const kicker: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--primary)",
  marginBottom: "0.35rem",
};

const pageTitle: React.CSSProperties = {
  fontSize: "clamp(1.65rem, 4vw, 2.35rem)",
  fontWeight: 800,
  letterSpacing: "-0.03em",
  margin: "0 0 0.35rem",
};

const pageSub: React.CSSProperties = {
  margin: 0,
  color: "var(--on-surface-variant)",
  fontSize: "0.95rem",
  maxWidth: 32 * 16,
  lineHeight: 1.5,
};

const headerActions: React.CSSProperties = {
  display: "flex",
  gap: "0.65rem",
  flexWrap: "wrap",
  alignItems: "center",
};

const discardStyle: React.CSSProperties = {
  padding: "0.65rem 1.1rem",
  borderRadius: "var(--radius-lg)",
  border: "none",
  background: "transparent",
  color: "var(--on-surface-variant)",
  fontWeight: 700,
  fontSize: "0.9rem",
  cursor: "pointer",
};

const section: React.CSSProperties = { marginBottom: "2rem" };

const labelUpper: React.CSSProperties = {
  display: "block",
  fontSize: "0.72rem",
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--on-surface-variant)",
  marginBottom: "0.65rem",
};

const sectionHead: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "0.75rem",
};

const addIngStyle: React.CSSProperties = {
  border: "none",
  background: "var(--surface-container-low)",
  color: "var(--primary)",
  fontWeight: 700,
  fontSize: "0.8rem",
  padding: "0.4rem 0.75rem",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
};

const ingRow: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "center",
};

const removeIngBtn: React.CSSProperties = {
  flex: "0 0 40px",
  width: 40,
  height: 40,
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "var(--surface-container-high)",
  color: "var(--on-surface-variant)",
  fontSize: "1.25rem",
  cursor: "pointer",
  lineHeight: 1,
};

const uploadZone: React.CSSProperties = {
  background: "var(--surface-container-low)",
  borderRadius: "1.75rem",
  padding: "1.5rem",
  marginBottom: "1.25rem",
};

const uploadIconWrap: React.CSSProperties = {
  width: "4rem",
  height: "4rem",
  borderRadius: "1rem",
  background: "var(--surface-container-lowest)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "0 auto 1rem",
  boxShadow: "var(--kitchen-glow)",
};

const previewBox: React.CSSProperties = {
  marginTop: "1rem",
  borderRadius: "var(--radius-lg)",
  overflow: "hidden",
  aspectRatio: "1",
  maxHeight: 200,
  background: "var(--surface-container-high)",
};

const metaCard: React.CSSProperties = {
  background: "var(--surface-container-lowest)",
  borderRadius: "var(--radius-lg)",
  padding: "1.25rem",
  boxShadow: "var(--kitchen-glow)",
  marginBottom: "1.25rem",
};

const hint: React.CSSProperties = {
  fontSize: "0.8rem",
  color: "var(--on-surface-variant)",
  margin: "0 0 0.75rem",
  lineHeight: 1.45,
};

const deleteBtn: React.CSSProperties = {
  width: "100%",
  marginTop: "0.5rem",
  padding: "0.75rem",
  borderRadius: "var(--radius-lg)",
  border: "none",
  background: "transparent",
  color: "var(--error-muted)",
  fontWeight: 700,
  fontSize: "0.9rem",
  cursor: "pointer",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.9rem",
};

const errorStyle: React.CSSProperties = {
  color: "#c62828",
  fontSize: "0.9rem",
};
