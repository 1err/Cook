"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "../../../components/RequireAuth";
import { apiFetch } from "../../../lib/api";
import {
  CATEGORY_LABELS,
  categoryBadgeStyle,
} from "../../../lib/recipeCategories";
import { getRecipeTags } from "../../../lib/recipeTags";
import type { Recipe } from "../../../types";

function ingredientPreview(recipe: Recipe, fallback: string, maxLength = 72): string {
  const parts = recipe.ingredients
    .slice(0, 4)
    .map((i) => i.name)
    .filter(Boolean);
  const text = parts.join(", ") || fallback;
  return text.length > maxLength ? text.slice(0, maxLength).trim() + "…" : text;
}

function FriendLibraryPageContent({ userId }: { userId: string }) {
  const [theirs, setTheirs] = useState<Recipe[]>([]);
  const [mine, setMine] = useState<Recipe[]>([]);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  // Read the owner's email from the URL ?email= param if the search page passed it.
  // Falls back to the userId for the page heading.
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
        const [a, b] = await Promise.all([
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
        setTheirs(a);
        setMine(b);
      } catch (e) {
        if (cancelled) return;
        setUnavailable(true);
        if (!(e instanceof Error && e.message === "LIBRARY_GONE")) {
          console.error("Failed to load friend library", e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const savedSourceIds = useMemo(() => {
    const ids = new Set<string>();
    mine.forEach((r) => {
      ids.add(r.id);
      if (r.catalog_source_recipe_id) ids.add(r.catalog_source_recipe_id);
    });
    return ids;
  }, [mine]);

  async function copy(recipeId: string) {
    setCopyingId(recipeId);
    setCopyError(null);
    try {
      const res = await apiFetch(
        `/users/${encodeURIComponent(userId)}/recipes/${encodeURIComponent(recipeId)}/copy`,
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
      setCopyError(e instanceof Error ? e.message : "Couldn't add — try again.");
    } finally {
      setCopyingId(null);
    }
  }

  const heading = ownerEmail ? `${ownerEmail}'s library` : "Friend's library";

  if (loading) return <main style={mainStyle}>Loading…</main>;

  if (unavailable) {
    return (
      <main style={mainStyle}>
        <h1 style={titleStyle}>Library is no longer public</h1>
        <p style={mutedStyle}>The owner may have turned off sharing.</p>
        <Link href="/library/friends" style={linkBackStyle}>
          ← Search for a different friend
        </Link>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <Link href="/library/friends" style={linkBackStyle}>
        ← Search
      </Link>
      <h1 style={titleStyle}>{heading}</h1>
      <p style={mutedStyle}>
        Browsing {theirs.length} {theirs.length === 1 ? "recipe" : "recipes"}. View only — tap a card
        to see details, or use Add to library to save a copy.
      </p>

      {copyError ? <p style={errorStyle}>{copyError}</p> : null}

      {theirs.length === 0 ? <p style={mutedStyle}>This library is empty.</p> : null}

      <ul className="libraryGrid" style={{ marginTop: "1.5rem" }}>
        {theirs.map((recipe) => {
          const owned = savedSourceIds.has(recipe.id);
          const adding = copyingId === recipe.id;
          const preview = ingredientPreview(recipe, "View details");
          const tags = getRecipeTags(recipe);
          const featuredTags = tags.slice(0, 2);
          const badgeTag = featuredTags[0];
          const detailHref = `/library/friends/${encodeURIComponent(userId)}/${encodeURIComponent(recipe.id)}${
            ownerEmail ? `?email=${encodeURIComponent(ownerEmail)}` : ""
          }`;
          return (
            <li key={recipe.id} className="recipe-card-stitch recipe-card-hover">
              <Link href={detailHref} className="recipe-card-stitch__link" style={{ display: "block" }}>
                <div className="recipe-card-stitch__media">
                  {recipe.thumbnail_url ? (
                    <>
                      <img
                        src={recipe.thumbnail_url}
                        alt=""
                        className="recipe-card-stitch__img recipe-card-stitch__img--bg"
                      />
                      <div className="recipe-card-stitch__img-frame">
                        <img
                          src={recipe.thumbnail_url}
                          alt=""
                          className="recipe-card-stitch__img recipe-card-stitch__img--full"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="recipe-card-stitch__placeholder recipeCardPlaceholder">
                      <span className="font-headline recipe-card-stitch__placeholder-text">
                        Recipe
                      </span>
                    </div>
                  )}
                  {badgeTag && CATEGORY_LABELS[badgeTag] ? (
                    <span
                      className="recipe-card-stitch__badge font-headline"
                      style={categoryBadgeStyle(badgeTag)}
                    >
                      {CATEGORY_LABELS[badgeTag]}
                    </span>
                  ) : null}
                </div>
                <div className="recipe-card-stitch__meta" style={{ paddingTop: 0 }}>
                  <div className="recipe-card-stitch__meta-left" style={{ width: "100%" }}>
                    <h2 className="font-headline recipe-card-stitch__title">{recipe.title}</h2>
                    <p className="recipe-card-stitch__sub" title={preview}>
                      {preview}
                    </p>
                    {featuredTags.length > 0 ? (
                      <div className="recipe-card-stitch__tag-row">
                        {featuredTags.map((tag) => (
                          <span
                            key={tag}
                            className="recipe-card-stitch__tag-mini font-headline"
                          >
                            {CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Link>
              <div style={{ padding: "0 1rem 1rem" }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => void copy(recipe.id)}
                  disabled={owned || adding}
                >
                  {owned ? "In your library" : adding ? "Adding…" : "Add to library"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

export default function FriendLibraryPage({ params }: { params: { userId: string } }) {
  return (
    <RequireAuth>
      <FriendLibraryPageContent userId={params.userId} />
    </RequireAuth>
  );
}

const mainStyle: React.CSSProperties = {
  padding: "32px 24px",
  maxWidth: 1100,
  margin: "0 auto",
};
const titleStyle: React.CSSProperties = { fontSize: 28, fontWeight: 700, margin: "12px 0 8px" };
const mutedStyle: React.CSSProperties = {
  color: "var(--on-surface-variant, #55423e)",
  fontSize: 14,
  margin: "0 0 8px",
};
const errorStyle: React.CSSProperties = {
  color: "var(--error, #ba1a1a)",
  fontSize: 14,
};
const linkBackStyle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--primary, #9a442d)",
  textDecoration: "none",
  fontWeight: 600,
};
