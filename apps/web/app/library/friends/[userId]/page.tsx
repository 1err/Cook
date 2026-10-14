"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader, PageShell } from "../../../components/PageShell";
import { RequireAuth } from "../../../components/RequireAuth";
import { apiFetch } from "../../../lib/api";
import { FriendLibraryCard } from "../FriendLibraryCard";
import { useT } from "../../../lib/i18n";
import { useRecipePage } from "../../../lib/useRecipePage";
import { useAuth } from "../../../lib/auth";
import { BlockUserButton } from "../../../components/safety/SharingSafety";
import { useAccountScope } from "../../../components/safety/useAccountScope";
import styles from "../Friends.module.css";

function FriendLibraryPageContent({ userId }: { userId: string }) {
  const t = useT();
  const scope = useAccountScope();
  const [search, setSearch] = useState("");
  const page = useRecipePage(userId, {q: search});
  const theirs = page.items;
  const [savedSourceIds, setSavedSourceIds] = useState(new Set<string>());
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const loading = page.loading && !theirs.length;
  const [unavailable, setUnavailable] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    const email = new URLSearchParams(window.location.search).get("email");
    if (email) setOwnerEmail(email);
  }, []);

  async function copy(recipeId: string) {
    const actor = scope.capture();
    if (!actor || copyingId) return;
    setCopyingId(recipeId);
    setCopyError(null);
    try {
      const response = await apiFetch(
        `/users/${encodeURIComponent(userId)}/recipes/${encodeURIComponent(recipeId)}/copy`,
        { method: "POST", headers: { "X-Chef-World-Account-ID": actor.id } },
      );
      if (!scope.active(actor)) return;
      if (response.status === 404) {
        setUnavailable(true);
        return;
      }
      if (!response.ok) throw new Error(await response.text());
      setSavedSourceIds(current => new Set(current).add(recipeId));
    } catch (caught) {
      if (!scope.active(actor)) return;
      setCopyError(caught instanceof Error ? caught.message : "Couldn't add — try again.");
    } finally {
      if (scope.active(actor)) setCopyingId(null);
    }
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

      <BlockUserButton userId={userId} onBlocked={(actor) => { if (scope.active(actor)) setUnavailable(true); }} />
      <input aria-label="Search recipes" type="search" value={search} onChange={event => setSearch(event.target.value)} />
      {page.error ? <p role="alert">{page.error}</p> : null}
      {copyError ? <p className={styles.error} role="alert">{copyError}</p> : null}
      {loading ? <p role="status">Loading…</p> : theirs.length === 0 ? <p className={styles.libraryStatus}>{search.trim() ? "No matching recipes." : "This library is empty."}</p> : null}

      <ul className={styles.recipeGrid}>
        {theirs.map((recipe) => {
          const owned = recipe.already_saved || savedSourceIds.has(recipe.id);
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
      {page.next ? <button disabled={page.loading} onClick={() => void page.more()}>{t("common.loadMoreRecipes")}</button> : null}
    </PageShell>
  );
}

export default function FriendLibraryPage() {
  const params = useParams<{ userId: string }>();
  const { user } = useAuth();
  return (
    <RequireAuth>
      <FriendLibraryPageContent key={`${user?.id}:${params.userId}`} userId={params.userId} />
    </RequireAuth>
  );
}
