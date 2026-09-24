"use client";

import { Fragment, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

export function RequireAuth({ children, allowUnverified = false }: { children: React.ReactNode; allowUnverified?: boolean }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const needsVerification = Boolean(user?.email_verification_required && !user.email_verified && !allowUnverified);

  useEffect(() => {
    if (!loading && !user && typeof window !== "undefined") {
      const redirect = `${window.location.pathname}${window.location.search || ""}`;
      router.replace(`/login?redirect=${encodeURIComponent(redirect)}`);
    } else if (!loading && needsVerification) {
      const redirect = `${window.location.pathname}${window.location.search || ""}`;
      router.replace(`/check-email?redirect=${encodeURIComponent(redirect)}`);
    }
  }, [loading, router, user, needsVerification]);

  if (loading) return <div style={loadingWrapStyle}><p style={loadingStyle}>Opening your workspace…</p></div>;
  if (!user || needsVerification) return null;
  return <Fragment key={user.id}>{children}</Fragment>;
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
