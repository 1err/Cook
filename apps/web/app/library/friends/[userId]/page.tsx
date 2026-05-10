"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "../../../components/RequireAuth";
import { apiFetch } from "../../../lib/api";
import type { Recipe } from "../../../types";

function FriendLibraryPageContent({ userId }: { userId: string }) {
  const [theirs, setTheirs] = useState<Recipe[]>([]);
  const [mine, setMine] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

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
          // non-404 error — keep the same empty state but log for diagnosis
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

  if (loading) return <main style={mainStyle}>Loading…</main>;

  if (unavailable) {
    return (
      <main style={mainStyle}>
        <h1 style={titleStyle}>Library is no longer public</h1>
        <p style={mutedStyle}>The owner may have turned off sharing.</p>
        <Link href="/library/friends" style={linkBackStyle}>← Search for a different friend</Link>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <Link href="/library/friends" style={linkBackStyle}>← Search</Link>
      <h1 style={titleStyle}>Friend's library</h1>

      {copyError ? <p style={errorStyle}>{copyError}</p> : null}

      {theirs.length === 0 ? <p style={mutedStyle}>This library is empty.</p> : null}

      <ul style={listStyle}>
        {theirs.map((r) => {
          const owned = savedSourceIds.has(r.id);
          const adding = copyingId === r.id;
          return (
            <li key={r.id} style={rowStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 16 }}>{r.title}</strong>
                <div style={{ fontSize: 13, color: "var(--on-surface-variant, #55423e)", marginTop: 2 }}>
                  {r.ingredients.length} {r.ingredients.length === 1 ? "ingredient" : "ingredients"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void copy(r.id)}
                disabled={owned || adding}
                style={addButtonStyle(owned, adding)}
              >
                {owned ? "In your library" : adding ? "Adding…" : "Add to library"}
              </button>
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
  maxWidth: 720,
  margin: "0 auto",
};
const titleStyle: React.CSSProperties = { fontSize: 28, fontWeight: 700, margin: "12px 0 16px" };
const mutedStyle: React.CSSProperties = { color: "var(--on-surface-variant, #55423e)", fontSize: 14 };
const errorStyle: React.CSSProperties = { color: "var(--error, #ba1a1a)", fontSize: 14 };
const linkBackStyle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--primary, #9a442d)",
  textDecoration: "none",
  fontWeight: 600,
};
const listStyle: React.CSSProperties = { listStyle: "none", padding: 0, margin: 0 };
const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: 12,
  border: "1px solid var(--border-color, #e9e8e7)",
  borderRadius: 12,
  marginBottom: 8,
  background: "var(--surface, #fff)",
};

function addButtonStyle(owned: boolean, adding: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    fontSize: 13,
    fontWeight: 700,
    cursor: owned || adding ? "default" : "pointer",
    background: owned ? "var(--surface-container-high, #e9e8e7)" : "var(--primary, #9a442d)",
    color: owned ? "var(--on-surface, #1a1c1c)" : "#fff",
    opacity: adding ? 0.7 : 1,
    minWidth: 130,
  };
}
