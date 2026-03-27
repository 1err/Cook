"use client";

import type { ReactNode } from "react";

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1600&q=80";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="auth-layout">
      <section className="auth-hero" aria-hidden="true">
        <img className="auth-hero__img" src={HERO_IMAGE} alt="" />
        <div className="auth-hero__scrim" />
        <div className="auth-hero__brand">
          <div className="auth-hero__mark" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M8 3v18M16 3v18M4 8h16M4 16h16"
                stroke="white"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="font-headline" style={{ fontSize: "1.25rem", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em" }}>
            Cooking
          </span>
        </div>
        <div className="auth-hero__copy">
          <span className="auth-hero__pill">Recipe workspace</span>
          <h2 className="auth-hero__title font-headline">
            Plan meals with calm, editorial clarity.
          </h2>
          <p className="auth-hero__sub">
            Import from video, build your library, and sync a shopping list—without the clutter of a typical recipe app.
          </p>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__inner">
          <header style={{ marginBottom: "2.25rem" }}>
            <h1 className="font-headline" style={{ fontSize: "clamp(1.75rem, 4vw, 2.25rem)", fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 0.65rem", color: "var(--on-surface)" }}>
              {title}
            </h1>
            <p style={{ margin: 0, color: "var(--on-surface-variant)", fontWeight: 500, fontSize: "1rem", lineHeight: 1.5 }}>
              {subtitle}
            </p>
          </header>

          <p
            className="font-headline"
            style={{
              fontSize: "0.8rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--on-surface-variant)",
              marginBottom: "1.25rem",
            }}
          >
            Sign in with email
          </p>

          {children}

          <div style={{ marginTop: "2rem", textAlign: "center", color: "var(--on-surface-variant)", fontWeight: 500, fontSize: "0.95rem" }}>
            {footer}
          </div>
        </div>
      </section>
    </main>
  );
}
