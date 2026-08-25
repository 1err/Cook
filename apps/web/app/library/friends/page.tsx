"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader, PageShell } from "../../components/PageShell";
import { RequireAuth } from "../../components/RequireAuth";
import { apiFetch } from "../../lib/api";
import styles from "./Friends.module.css";

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; user: { id: string; email: string } }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

function FriendsSearchPageContent() {
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
      <PageHeader title="Find a friend" />

      <nav className={styles.tabs} aria-label="Library views">
        <Link href="/library">My recipes</Link>
        <Link href="/library?view=public">Public</Link>
        <span aria-current="page">Friends</span>
      </nav>

      <section className={styles.searchPanel} aria-label="Friend library search">
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
