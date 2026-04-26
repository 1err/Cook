"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && typeof window !== "undefined") {
      const redirect = `${window.location.pathname}${window.location.search || ""}`;
      router.replace(`/login?redirect=${encodeURIComponent(redirect)}`);
    }
  }, [loading, router, user]);

  if (loading) return <div style={loadingWrapStyle}><p style={loadingStyle}>Opening your workspace…</p></div>;
  if (!user) return null;
  return <>{children}</>;
}

const loadingWrapStyle: React.CSSProperties = {
  minHeight: "40vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-32)",
};

const loadingStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--font-body)",
  background: "var(--surface-container-low)",
  padding: "0.9rem 1.1rem",
  borderRadius: "9999px",
};
