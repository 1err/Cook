"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatIngredientQuantity } from "@cooking/shared";
import { RequireAuth } from "../../../../components/RequireAuth";
import { apiFetch } from "../../../../lib/api";
import { CATEGORY_LABELS } from "../../../../lib/recipeCategories";
import { getRecipeTags } from "../../../../lib/recipeTags";
import type { Recipe } from "../../../../types";

function splitTitleAccent(title: string): { lead: string; accent: string } {
  const t = title.trim();
  const idx = t.lastIndexOf(" ");
  if (idx <= 0) return { lead: t, accent: "" };
  return { lead: t.slice(0, idx), accent: t.slice(idx + 1) };
}

function FriendRecipeContent({ userId, recipeId }: { userId: string; recipeId: string }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [mine, setMine] = useState<Recipe[]>([]);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const e = params.get("email");
      if (e) setOwnerEmail(e);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [theirs, myList] = await Promise.all([
          (async () => {
            const r = await apiFetch(`/users/${encodeURIComponent(userId)}/recipes`);
            if (r.status === 404) throw new Error("LIBRARY_GONE");
            if (!r.ok) throw new Error(await r.text());
            return (await r.json()) as Recipe[];
          })(),
          (async () => {
            const r = await apiFetch("/recipes");
            return r.ok ? ((await r.json()) as Recipe[]) : [];
          })(),
        ]);
        if (cancelled) return;
        const found = theirs.find((r) => r.id === recipeId) ?? null;
        setRecipe(found);
        setMine(myList);
        if (!found) setUnavailable(true);
      } catch (e) {
        if (cancelled) return;
        setUnavailable(true);
        if (!(e instanceof Error && e.message === "LIBRARY_GONE")) {
          console.error("Failed to load friend recipe", e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, recipeId]);

  const owned = useMemo(() => {
    if (!recipe) return false;
    return mine.some((r) => r.id === recipe.id || r.catalog_source_recipe_id === recipe.id);
  }, [mine, recipe]);

  async function add() {
    if (!recipe || owned || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await apiFetch(
        `/users/${encodeURIComponent(userId)}/recipes/${encodeURIComponent(recipe.id)}/copy`,
        { method: "POST" },
      );
      if (res.status === 404) {
        setUnavailable(true);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const newCopy = (await res.json()) as Recipe;
      setMine((prev) => (prev.some((r) => r.id === newCopy.id) ? prev : [newCopy, ...prev]));
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Couldn't add — try again.");
    } finally {
      setAdding(false);
    }
  }

  const blurb = useMemo(() => {
    if (!recipe?.raw_extraction_text) return null;
    const line = recipe.raw_extraction_text.split(/\n+/).map((s) => s.trim()).find(Boolean);
    if (!line || line.length < 12) return null;
    return line.length > 220 ? `${line.slice(0, 217)}…` : line;
  }, [recipe]);

  const backHref = `/library/friends/${encodeURIComponent(userId)}${
    ownerEmail ? `?email=${encodeURIComponent(ownerEmail)}` : ""
  }`;

  if (loading) {
    return (
      <p
        style={{ color: "var(--muted)", padding: "var(--space-24)" }}
        className="recipe-editorial"
      >
        Loading…
      </p>
    );
  }

  if (unavailable || !recipe) {
    return (
      <article className="recipe-editorial">
        <Link href={backHref} className="font-headline recipe-detail-back">
          ← {ownerEmail ? `${ownerEmail}'s library` : "Friend's library"}
        </Link>
        <h1
          className="recipe-editorial__title font-headline"
          style={{ marginTop: "1.5rem" }}
        >
          Recipe unavailable
        </h1>
        <p style={{ color: "var(--on-surface-variant)" }}>
          This recipe may have been deleted, or the owner turned off library sharing.
        </p>
      </article>
    );
  }

  const ingredientRows = recipe.ingredients.filter((i) => (i.name || "").trim().length > 0);
  const tags = getRecipeTags(recipe);
  const { lead, accent } = splitTitleAccent(recipe.title);

  return (
    <article className="recipe-editorial">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1.5rem",
        }}
      >
        <Link href={backHref} className="font-headline recipe-detail-back">
          ← {ownerEmail ? `${ownerEmail}'s library` : "Friend's library"}
        </Link>
        <button
          type="button"
          className="btn-primary"
          style={{ padding: "0.55rem 1.15rem", minHeight: 44, fontSize: "0.9rem" }}
          onClick={() => void add()}
          disabled={owned || adding}
        >
          {owned ? "In your library" : adding ? "Adding…" : "Add to library"}
        </button>
      </div>

      {addError ? (
        <p style={{ color: "#c62828", marginTop: "0.5rem", fontSize: "var(--font-body)" }}>
          {addError}
        </p>
      ) : null}

      <div className="recipe-editorial__hero-img">
        {recipe.thumbnail_url ? (
          <img src={recipe.thumbnail_url} alt="" />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              minHeight: "12rem",
              background:
                "linear-gradient(145deg, var(--primary-fixed), var(--surface-container-high))",
            }}
          />
        )}
      </div>

      <div className="recipe-editorial__center">
        <div className="recipe-editorial__pills">
          {tags.map((tag) => (
            <span
              key={tag}
              className="recipe-editorial__pill recipe-editorial__pill--tertiary font-headline"
            >
              {CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}
            </span>
          ))}
          <span className="recipe-editorial__pill recipe-editorial__pill--primary font-headline">
            {ingredientRows.length} {ingredientRows.length === 1 ? "ingredient" : "ingredients"}
          </span>
        </div>
        <h1 className="recipe-editorial__title font-headline">
          {lead}
          {accent ? (
            <>
              {" "}
              <span className="recipe-editorial__accent">{accent}</span>
            </>
          ) : null}
        </h1>
        {blurb ? (
          <p
            style={{
              margin: "0 0 2rem",
              fontSize: "1.15rem",
              color: "var(--on-surface-variant)",
              fontWeight: 400,
              lineHeight: 1.55,
            }}
          >
            {blurb}
          </p>
        ) : null}
        <div className="recipe-editorial__stats">
          <div>
            <p className="recipe-editorial__stats-label font-headline">Shared by</p>
            <p className="recipe-editorial__stats-value">{ownerEmail ?? "Friend"}</p>
          </div>
          <div>
            <p className="recipe-editorial__stats-label font-headline">Ingredients</p>
            <p className="recipe-editorial__stats-value">{ingredientRows.length}</p>
          </div>
          <div>
            <p className="recipe-editorial__stats-label font-headline">Source</p>
            <p className="recipe-editorial__stats-value">
              {recipe.source_url ? "Imported" : "Library"}
            </p>
          </div>
        </div>
      </div>

      <div className="recipe-editorial-ingredients">
        <h2 className="font-headline">Ingredients</h2>
        {ingredientRows.length === 0 ? (
          <p style={{ color: "var(--muted)", textAlign: "center" }}>No ingredients listed.</p>
        ) : (
          ingredientRows.map((ing, idx) => (
            <div key={idx} className="recipe-editorial-ing-row">
              <p className="recipe-editorial-ing-name font-headline">{ing.name?.trim()}</p>
              <p className="recipe-editorial-ing-qty">{formatIngredientQuantity(ing) || "—"}</p>
            </div>
          ))
        )}
      </div>

      <div
        style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}
      >
        <button
          type="button"
          className="btn-primary"
          onClick={() => void add()}
          disabled={owned || adding}
          style={{ minHeight: 44 }}
        >
          {owned ? "In your library" : adding ? "Adding…" : "Add to library"}
        </button>
      </div>

      {recipe.source_url ? (
        <p style={{ margin: "2.5rem 0 0", textAlign: "center", fontSize: "0.9rem" }}>
          <a
            href={recipe.source_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontWeight: 700 }}
          >
            Original source →
          </a>
        </p>
      ) : null}
    </article>
  );
}

export default function FriendRecipeDetailPage({
  params,
}: {
  params: { userId: string; recipeId: string };
}) {
  return (
    <RequireAuth>
      <FriendRecipeContent userId={params.userId} recipeId={params.recipeId} />
    </RequireAuth>
  );
}
