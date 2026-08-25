"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, PageShell } from "../../../components/PageShell";
import { RequireAuth } from "../../../components/RequireAuth";
import { apiFetch } from "../../../lib/api";
import type { Recipe } from "../../../types";
import { FriendLibraryCard } from "../FriendLibraryCard";
import styles from "../Friends.module.css";

function FriendLibraryPageContent({ userId }: { userId: string }) {
  const [theirs, setTheirs] = useState<Recipe[]>([]);
  const [mine, setMine] = useState<Recipe[]>([]);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    const email = new URLSearchParams(window.location.search).get("email");
    if (email) setOwnerEmail(email);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [friendRecipes, myRecipes] = await Promise.all([
          (async () => {
            const response = await apiFetch(`/users/${encodeURIComponent(userId)}/recipes`);
            if (response.status === 404) throw new Error("LIBRARY_GONE");
            if (!response.ok) throw new Error(await response.text());
            return (await response.json()) as Recipe[];
          })(),
          (async () => {
            const response = await apiFetch("/recipes");
            return response.ok ? ((await response.json()) as Recipe[]) : [];
          })(),
        ]);
        if (!cancelled) {
          setTheirs(friendRecipes);
          setMine(myRecipes);
        }
      } catch (caught) {
        if (cancelled) return;
        setUnavailable(true);
        if (!(caught instanceof Error && caught.message === "LIBRARY_GONE")) {
          console.error("Failed to load friend library", caught);
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
    mine.forEach((recipe) => {
      ids.add(recipe.id);
      if (recipe.catalog_source_recipe_id) ids.add(recipe.catalog_source_recipe_id);
    });
    return ids;
  }, [mine]);

  async function copy(recipeId: string) {
    setCopyingId(recipeId);
    setCopyError(null);
    try {
      const response = await apiFetch(
        `/users/${encodeURIComponent(userId)}/recipes/${encodeURIComponent(recipeId)}/copy`,
        { method: "POST" },
      );
      if (response.status === 404) {
        setUnavailable(true);
        return;
      }
      if (!response.ok) throw new Error(await response.text());
      const newCopy = (await response.json()) as Recipe;
      setMine((current) =>
        current.some((recipe) => recipe.id === newCopy.id) ? current : [newCopy, ...current],
      );
    } catch (caught) {
      setCopyError(caught instanceof Error ? caught.message : "Couldn't add — try again.");
    } finally {
      setCopyingId(null);
    }
  }

  if (loading) {
    return <PageShell><p className={styles.libraryStatus}>Loading…</p></PageShell>;
  }

  if (unavailable) {
    return (
      <PageShell>
        <div className={styles.friendHeader}>
          <Link href="/library/friends" className={styles.backLink}>← Find another friend</Link>
          <PageHeader title="Library is no longer public" />
        </div>
        <p className={styles.libraryStatus}>The owner may have turned off sharing.</p>
      </PageShell>
    );
  }

  const heading = ownerEmail ? `${ownerEmail}'s library` : "Friend's library";

  return (
    <PageShell>
      <div className={styles.friendHeader}>
        <Link href="/library/friends" className={styles.backLink}>← Find a friend</Link>
        <PageHeader title={heading} />
      </div>

      {copyError ? <p className={styles.error} role="alert">{copyError}</p> : null}
      {theirs.length === 0 ? <p className={styles.libraryStatus}>This library is empty.</p> : null}

      <ul className={styles.recipeGrid}>
        {theirs.map((recipe) => {
          const owned = savedSourceIds.has(recipe.id);
          const adding = copyingId === recipe.id;
          const detailHref = `/library/friends/${encodeURIComponent(userId)}/${encodeURIComponent(recipe.id)}${
            ownerEmail ? `?email=${encodeURIComponent(ownerEmail)}` : ""
          }`;
          return (
            <FriendLibraryCard
              key={recipe.id}
              recipe={recipe}
              href={detailHref}
              state={owned ? "added" : adding ? "copying" : "idle"}
              onCopy={() => void copy(recipe.id)}
            />
          );
        })}
      </ul>
    </PageShell>
  );
}

export default function FriendLibraryPage({ params }: { params: { userId: string } }) {
  return (
    <RequireAuth>
      <FriendLibraryPageContent userId={params.userId} />
    </RequireAuth>
  );
}
