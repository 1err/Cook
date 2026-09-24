"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader, PageShell } from "../../components/PageShell";
import { RequireAuth } from "../../components/RequireAuth";
import { apiFetch } from "../../lib/api";
import { useEditorialCopy } from "../../lib/editorialCopy";
import { useT } from "../../lib/i18n";
import styles from "./Friends.module.css";
import libraryStyles from "../LibraryPage.module.css";

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; user: { id: string; email: string } }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

function FriendsSearchPageContent() {
  const editorialCopy = useEditorialCopy();
  const t = useT();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setResult({ kind: "error", message: "Enter an email." });
      return;
    }
    setResult({ kind: "loading" });
    try {
      const response = await apiFetch(`/users/search?email=${encodeURIComponent(trimmed)}`);
      if (response.status === 404) {
        setResult({ kind: "not-found" });
        return;
      }
      if (!response.ok) {
        setResult({
          kind: "error",
          message: (await response.text()) || `${response.status} ${response.statusText}`,
        });
        return;
      }
      setResult({ kind: "found", user: await response.json() });
    } catch (caught) {
      setResult({
        kind: "error",
        message: caught instanceof Error ? caught.message : "Search failed",
      });
    }
  }

  return (
    <PageShell>
      <PageHeader title={t("library.title")} description={editorialCopy["library.tagline"]} />
      <div className={libraryStyles.tabs} role="tablist" aria-label={t("library.views")}>
        <Link href="/library" role="tab" aria-selected={false} className={libraryStyles.tab}>{t("library.myLibrary")}</Link>
        <Link href="/library?view=public" role="tab" aria-selected={false} className={libraryStyles.tab}>{t("library.publicLibrary")}</Link>
        <Link href="/library/friends" role="tab" aria-selected={true} className={libraryStyles.tab}>{editorialCopy["library.friends"]}</Link>
      </div>

      <section className={styles.searchPanel} aria-label="Friend library search">
        <div className={styles.searchHeading}>
          <h2>Find a friend</h2>
          <p>{editorialCopy["friends.tagline"]}</p>
        </div>
        <form onSubmit={onSubmit} className={styles.searchForm}>
          <label htmlFor="friend-email">Email address</label>
          <div className={styles.fieldRow}>
            <input
              id="friend-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="friend@example.com"
              autoComplete="off"
              autoCapitalize="off"
              required
            />
            <button type="submit" disabled={result.kind === "loading"}>
              {result.kind === "loading" ? "Searching…" : "Search"}
            </button>
          </div>
          <p className={styles.searchHint}>{t("friends.searchHint")}</p>
        </form>

        {result.kind === "found" ? (
          <Link
            href={`/library/friends/${encodeURIComponent(result.user.id)}?email=${encodeURIComponent(result.user.email)}`}
            className={styles.resultCard}
          >
            <span className={styles.avatar} aria-hidden>
              {result.user.email.slice(0, 1).toUpperCase()}
            </span>
            <span className={styles.resultCopy}>
              <strong>{result.user.email}</strong>
              <small>Shared recipe library</small>
            </span>
            <span className={styles.open}>Open library →</span>
          </Link>
        ) : null}

        {result.kind === "not-found" ? (
          <div className={styles.notice} role="status">
            <strong>No public library found</strong>
            <p>
              That email may not be registered, or they haven&apos;t shared their library.
            </p>
          </div>
        ) : null}

        {result.kind === "error" ? (
          <p className={styles.error} role="alert">{result.message}</p>
        ) : null}
        <div className={styles.sharingHint}>
          <h2>{t("friends.sharingTitle")}</h2>
          <Link href="/settings">{t("friends.sharingSettings")} →</Link>
        </div>
      </section>
    </PageShell>
  );
}

export default function FriendsSearchPage() {
  return (
    <RequireAuth>
      <FriendsSearchPageContent />
    </RequireAuth>
  );
}
