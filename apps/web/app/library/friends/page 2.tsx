"use client";

import Link from "next/link";
import { useState } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { apiFetch } from "../../lib/api";

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; user: { id: string; email: string } }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

function FriendsSearchPageContent() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setResult({ kind: "error", message: "Enter an email." });
      return;
    }
    setResult({ kind: "loading" });
    try {
      const res = await apiFetch(`/users/search?email=${encodeURIComponent(trimmed)}`);
      if (res.status === 404) {
        setResult({ kind: "not-found" });
        return;
      }
      if (!res.ok) {
        setResult({ kind: "error", message: (await res.text()) || `${res.status} ${res.statusText}` });
        return;
      }
      const user = (await res.json()) as { id: string; email: string };
      setResult({ kind: "found", user });
    } catch (err) {
      setResult({
        kind: "error",
        message: err instanceof Error ? err.message : "Search failed",
      });
    }
  }

  return (
    <main style={mainStyle}>
      <h1 style={titleStyle}>Find a friend</h1>
      <p style={subtitleStyle}>
        Enter your friend's exact email. They must have turned on “Share my library” in Settings.
      </p>
      <form onSubmit={onSubmit} style={formStyle}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
          autoComplete="off"
          autoCapitalize="off"
          style={inputStyle}
          required
        />
        <button
          type="submit"
          disabled={result.kind === "loading"}
          className="font-headline"
          style={buttonStyle}
        >
          {result.kind === "loading" ? "Searching…" : "Search"}
        </button>
      </form>

      {result.kind === "found" ? (
        <Link
          href={`/library/friends/${encodeURIComponent(result.user.id)}?email=${encodeURIComponent(result.user.email)}`}
          style={cardStyle}
        >
          <span style={{ flex: 1, fontWeight: 600 }}>{result.user.email}</span>
          <span style={{ color: "var(--primary, #9a442d)", fontWeight: 600 }}>Open library →</span>
        </Link>
      ) : null}

      {result.kind === "not-found" ? (
        <p style={mutedStyle}>
          No public library for that email. Either the email isn't registered, or they haven't
          shared their library.
        </p>
      ) : null}

      {result.kind === "error" ? <p style={errorStyle}>{result.message}</p> : null}
    </main>
  );
}

export default function FriendsSearchPage() {
  return (
    <RequireAuth>
      <FriendsSearchPageContent />
    </RequireAuth>
  );
}

const mainStyle: React.CSSProperties = {
  padding: "32px 24px",
  maxWidth: 640,
  margin: "0 auto",
};

const titleStyle: React.CSSProperties = { fontSize: 28, fontWeight: 700, margin: "0 0 8px" };
const subtitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--on-surface-variant, #55423e)",
  margin: "0 0 20px",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginBottom: 16,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  border: "1px solid var(--border-color, #e9e8e7)",
  borderRadius: 8,
  fontSize: 15,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 20px",
  background: "var(--primary, #9a442d)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700,
};

const cardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: 16,
  border: "1px solid var(--border-color, #e9e8e7)",
  borderRadius: 12,
  textDecoration: "none",
  color: "inherit",
  background: "var(--surface, #ffffff)",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--on-surface-variant, #55423e)",
  fontSize: 14,
};

const errorStyle: React.CSSProperties = {
  color: "var(--error, #ba1a1a)",
  fontSize: 14,
};
