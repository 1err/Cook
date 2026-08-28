"use client";

import type { ReactNode } from "react";
import { LanguageControl } from "./LanguageControl";

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1600&q=80";

export function AuthShell({
  title,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  eyebrow: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="auth-layout">
      <section className="auth-hero" aria-hidden="true">
        <img className="auth-hero__img" src={HERO_IMAGE} alt="" />
        <div className="auth-hero__scrim" />
        <div className="auth-hero__brand">
          <img
            alt=""
            aria-hidden="true"
            className="auth-hero__mark"
            height="40"
            src="/brand/chef-world-mark.svg"
            width="40"
          />
          <span className="font-headline" style={{ fontSize: "1.25rem", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em" }}>
            Chef World
          </span>
        </div>
      </section>

      <section className="auth-panel" style={{ position: "relative" }}>
        <div style={{ position: "absolute", right: "var(--cw-space-6)", top: "var(--cw-space-6)" }}>
          <LanguageControl compact />
        </div>
        <div className="auth-panel__inner">
          <div aria-label="Chef World" className="auth-panel__brand">
            <img
              alt=""
              aria-hidden="true"
              className="auth-panel__mark"
              height="36"
              src="/brand/chef-world-mark.svg"
              width="36"
            />
            <span>Chef World</span>
          </div>
          <header style={{ marginBottom: "2.25rem" }}>
            <h1 className="cw-display" style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)", fontWeight: 600, letterSpacing: "-0.035em", margin: 0, color: "var(--cw-color-ink)" }}>
              {title}
            </h1>
          </header>

          {children}

          <div style={{ marginTop: "2rem", textAlign: "center", color: "var(--on-surface-variant)", fontWeight: 500, fontSize: "0.95rem" }}>
            {footer}
          </div>
        </div>
      </section>
    </main>
  );
}
