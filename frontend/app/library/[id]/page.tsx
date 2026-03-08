"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import type { Recipe, IngredientItem } from "../../types";

export default function RecipeEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [title, setTitle] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [ingredients, setIngredients] = useState<IngredientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
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
      const res = await apiFetch(`/recipes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim() || recipe?.title,
          thumbnail_url: thumbnailUrl.trim() || null,
          ingredients: ingredients.filter((i) => i.name.trim() !== ""),
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      router.push("/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={mutedStyle}>Loading…</p>;
  if (error && !recipe) return <p style={errorStyle}>{error}</p>;
  if (!recipe) return null;

  return (
    <div>
      <div style={headerStyle}>
        <Link href="/library" style={backStyle}>
          ← Library
        </Link>
      </div>

      <div style={formStyle}>
        <label style={labelStyle}>
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
            placeholder="Recipe title"
          />
        </label>

        <div style={imageSectionStyle}>
          <span style={labelStyle}>Recipe image</span>
          <p style={imageHintStyle}>
            Upload from your desktop or paste an image URL to show a photo on the library card.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageFile}
            style={{ display: "none" }}
            aria-hidden
          />
          <div style={imageActionsStyle}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage}
              style={uploadButtonStyle}
            >
              {uploadingImage ? "Uploading…" : "Upload from desktop"}
            </button>
          </div>
          <input
            type="url"
            value={thumbnailUrl}
            onChange={(e) => setThumbnailUrl(e.target.value)}
            style={{ ...inputStyle, marginTop: "0.5rem" }}
            placeholder="Or paste image URL (e.g. https://...)"
          />
          {thumbnailUrl.trim() && (
            <div style={previewWrapStyle}>
              <img
                src={thumbnailUrl.trim()}
                alt="Preview"
                style={previewImgStyle}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}
        </div>

        <div style={ingredientsHeaderStyle}>
          <span style={labelStyle}>Ingredients</span>
          <button type="button" onClick={addIngredient} style={addButtonStyle}>
            + Add ingredient
          </button>
        </div>

        <ul style={ingredientListStyle}>
          {ingredients.map((item, idx) => (
            <li key={idx} style={ingredientRowStyle}>
              <input
                type="text"
                value={item.name}
                onChange={(e) => updateIngredient(idx, "name", e.target.value)}
                placeholder="Name"
                style={{ ...inputStyle, flex: "1 1 140px" }}
              />
              <input
                type="text"
                value={item.quantity}
                onChange={(e) => updateIngredient(idx, "quantity", e.target.value)}
                placeholder="Quantity"
                style={{ ...inputStyle, flex: "0 1 100px" }}
              />
              <input
                type="text"
                value={item.notes ?? ""}
                onChange={(e) =>
                  updateIngredient(idx, "notes", e.target.value || null)
                }
                placeholder="Notes"
                style={{ ...inputStyle, flex: "1 1 120px" }}
              />
              <button
                type="button"
                onClick={() => removeIngredient(idx)}
                style={removeButtonStyle}
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        {recipe.source_url && (
          <p style={mutedStyle}>
            Source:{" "}
            <a
              href={recipe.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              {recipe.source_url}
            </a>
          </p>
        )}

        {error && <p style={errorStyle}>{error}</p>}

        <div style={actionsStyle}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={saveButtonStyle}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <Link href="/library" style={cancelLinkStyle}>
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  marginBottom: "1.5rem",
};

const backStyle: React.CSSProperties = {
  color: "var(--accent)",
  fontSize: "0.95rem",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.9rem",
  fontWeight: 500,
  marginBottom: "0.25rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: "0.95rem",
};

const imageSectionStyle: React.CSSProperties = {
  marginTop: "0.5rem",
};

const imageHintStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.85rem",
  margin: "0.25rem 0 0.5rem 0",
};

const imageActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "center",
};

const uploadButtonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--accent)",
  fontSize: "0.9rem",
  cursor: "pointer",
};

const previewWrapStyle: React.CSSProperties = {
  marginTop: "0.5rem",
  width: "100%",
  maxWidth: 200,
  aspectRatio: "1",
  borderRadius: "var(--radius-card)",
  overflow: "hidden",
  background: "var(--surface)",
  border: "1px solid var(--border)",
};

const previewImgStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const ingredientsHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: "0.5rem",
};

const addButtonStyle: React.CSSProperties = {
  padding: "0.35rem 0.75rem",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--accent)",
  fontSize: "0.9rem",
  cursor: "pointer",
};

const ingredientListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const ingredientRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "center",
};

const removeButtonStyle: React.CSSProperties = {
  flex: "0 0 32px",
  width: 32,
  height: 32,
  padding: 0,
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--muted)",
  fontSize: "1.25rem",
  cursor: "pointer",
  lineHeight: 1,
};

const linkStyle: React.CSSProperties = {
  color: "var(--accent)",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1rem",
  marginTop: "0.5rem",
};

const saveButtonStyle: React.CSSProperties = {
  padding: "0.5rem 1.25rem",
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  borderRadius: 8,
  fontSize: "1rem",
  fontWeight: 600,
  cursor: "pointer",
};

const cancelLinkStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.95rem",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.9rem",
};

const errorStyle: React.CSSProperties = {
  color: "#e57373",
  fontSize: "0.9rem",
};
