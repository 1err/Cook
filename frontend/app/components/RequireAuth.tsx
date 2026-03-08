"use client";

import { useEffect } from "react";
import { useAuth } from "../lib/auth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user && typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }, [loading, user]);

  if (loading) return <p style={loadingStyle}>Loading...</p>;
  if (!user) return null;
  return <>{children}</>;
}

const loadingStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--font-body)",
};
