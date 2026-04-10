"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AuthShell } from "../components/AuthShell";

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
        setError(
          Array.isArray(detail)
            ? detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(" ") || "Registration failed"
            : detail || "Registration failed",
        );
        return;
      }
      await refreshUser();
      const params = new URLSearchParams(window.location.search);
      const rawRedirect = params.get("redirect") || "/library";
      const redirectTarget = rawRedirect.startsWith("/") ? rawRedirect : "/library";
      router.push(redirectTarget);
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
    <AuthShell
      title="Create your account"
      subtitle="One account for your recipe library, meal planner, and shopping list."
      eyebrow="Create account with email"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" style={{ marginLeft: 4 }}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.35rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <label className="font-headline" htmlFor="register-email" style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--on-surface)", marginLeft: 4 }}>
            Email
          </label>
          <input
            id="register-email"
            className="input-editorial"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <label className="font-headline" htmlFor="register-password" style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--on-surface)", marginLeft: 4 }}>
            Password
          </label>
          <input
            id="register-password"
            className="input-editorial"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </div>
        {error && (
          <p style={{ margin: 0, color: "var(--error-muted)", fontSize: "0.9rem", fontWeight: 500 }}>
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", marginTop: "0.25rem" }}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
