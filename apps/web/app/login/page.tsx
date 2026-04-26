"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AuthShell } from "../components/AuthShell";
import { useT } from "../lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data.detail;
        setError(
          Array.isArray(detail)
            ? detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(" ") || t("auth.loginFailed")
            : detail || t("auth.loginFailed"),
        );
        return;
      }
      await refreshUser();
      const params = new URLSearchParams(window.location.search);
      const rawRedirect = params.get("redirect") || "/library";
      const redirectTarget = rawRedirect.startsWith("/") ? rawRedirect : "/library";
      router.push(redirectTarget);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("auth.loginFailed");
      if (message === "Failed to fetch") {
        setError(t("auth.cannotReachServer"));
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={t("auth.loginTitle")}
      subtitle={t("auth.loginSubtitle")}
      eyebrow={t("auth.loginEyebrow")}
      footer={
        <>
          {t("auth.newHere")}{" "}
          <Link href="/register" style={{ marginLeft: 4 }}>
            {t("auth.createAccount")}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.35rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <label className="font-headline" htmlFor="login-email" style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--on-surface)", marginLeft: 4 }}>
            {t("common.email")}
          </label>
          <input
            id="login-email"
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
          <label className="font-headline" htmlFor="login-password" style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--on-surface)", marginLeft: 4 }}>
            {t("common.password")}
          </label>
          <input
            id="login-password"
            className="input-editorial"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </div>
        {error && (
          <p style={{ margin: 0, color: "var(--error-muted)", fontSize: "0.9rem", fontWeight: 500 }}>
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", marginTop: "0.25rem" }}>
          {loading ? t("auth.signingIn") : t("nav.signIn")}
        </button>
      </form>
    </AuthShell>
  );
}
