"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data.detail;
        setError(Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(" ") || "Registration failed" : (detail || "Registration failed"));
        return;
      }
      await refreshUser();
      router.push("/library");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      if (message === "Failed to fetch") {
        setError("Cannot reach the server. Is the backend running on port 8000? (e.g. uvicorn or docker compose)");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={pageStyle}>
      <h1 style={h1Style}>Register</h1>
      <form onSubmit={handleSubmit} style={formStyle}>
        <label style={labelStyle}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            style={inputStyle}
          />
        </label>
        {error && <p style={errorStyle}>{error}</p>}
        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? "Registering…" : "Register"}
        </button>
      </form>
      <p style={mutedStyle}>
        Already have an account? <Link href="/login" style={linkStyle}>Log in</Link>
      </p>
    </div>
  );
}

const pageStyle: React.CSSProperties = { maxWidth: 400 };
const h1Style: React.CSSProperties = { fontSize: "var(--font-title)", fontWeight: 600, marginBottom: "var(--space-24)" };
const formStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "var(--space-16)" };
const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "var(--space-8)", fontSize: "0.9rem" };
const inputStyle: React.CSSProperties = {
  padding: "var(--space-12) var(--space-16)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  fontSize: "1rem",
};
const buttonStyle: React.CSSProperties = {
  padding: "var(--space-12) var(--space-24)",
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  borderRadius: "var(--radius-btn)",
  fontWeight: 600,
  cursor: "pointer",
  marginTop: "var(--space-8)",
};
const errorStyle: React.CSSProperties = { color: "#e57373", margin: 0 };
const mutedStyle: React.CSSProperties = { color: "var(--muted)", marginTop: "var(--space-24)" };
const linkStyle: React.CSSProperties = { color: "var(--accent)", fontWeight: 500 };
