"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getApiBase } from "../../config";
import type { Recipe, IngredientItem } from "../../types";

export default function RecipeEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState<IngredientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${getApiBase()}/recipes/${id}`);
        if (!res.ok) throw new Error("Recipe not found");
        const data: Recipe = await res.json();
        if (!cancelled) {
          setRecipe(data);
          setTitle(data.title);
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

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/recipes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || recipe?.title,
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
