"use client";

import type { CSSProperties, ReactNode } from "react";
import { AccountMenu } from "../../components/AccountMenu";
import { LanguageControl } from "../../components/LanguageControl";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";

const colors = [
  ["canvas", "var(--cw-color-canvas)"],
  ["surface", "var(--cw-color-surface)"],
  ["subtle", "var(--cw-color-subtle-surface)"],
  ["ink", "var(--cw-color-ink)"],
  ["muted", "var(--cw-color-muted-ink)"],
  ["action", "var(--cw-color-action)"],
  ["sage", "var(--cw-color-sage)"],
  ["error", "var(--cw-color-error)"],
  ["success", "var(--cw-color-success)"],
] as const;

const spaces = [
  ["4", "var(--cw-space-1)"],
  ["8", "var(--cw-space-2)"],
  ["12", "var(--cw-space-3)"],
  ["16", "var(--cw-space-4)"],
  ["24", "var(--cw-space-6)"],
  ["32", "var(--cw-space-8)"],
  ["40", "var(--cw-space-10)"],
  ["56", "var(--cw-space-14)"],
  ["72", "var(--cw-space-18)"],
] as const;

const radii = [
  ["8", "var(--cw-radius-control)"],
  ["12", "var(--cw-radius-field)"],
  ["16", "var(--cw-radius-card)"],
  ["24", "var(--cw-radius-modal)"],
] as const;

function StateRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={styles.row}>
      <p style={styles.label}>{label}</p>
      <div style={styles.examples}>{children}</div>
    </div>
  );
}

export function DesignSystemGallery() {
  return (
    <main style={styles.page}>
      <header style={styles.intro}>
        <p style={styles.eyebrow}>Chef World UI foundation</p>
        <h1 style={styles.title}>Design system</h1>
        <p style={styles.summary}>Actual component states and shared semantic tokens.</p>
      </header>

      <section aria-labelledby="buttons-heading" style={styles.section}>
        <h2 id="buttons-heading" style={styles.heading}>Buttons</h2>
        <StateRow label="Variants">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </StateRow>
        <StateRow label="Unavailable">
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
        </StateRow>
      </section>

      <section aria-labelledby="icon-heading" style={styles.section}>
        <h2 id="icon-heading" style={styles.heading}>Icon controls</h2>
        <StateRow label="Default, pressed, disabled">
          <IconButton icon="add" label="Add recipe" onClick={() => undefined} />
          <IconButton icon="menu" label="Open navigation, pressed" pressed onClick={() => undefined} />
          <IconButton icon="settings" label="Settings, disabled" disabled onClick={() => undefined} />
        </StateRow>
      </section>

      <section aria-labelledby="language-heading" style={styles.section}>
        <h2 id="language-heading" style={styles.heading}>Language</h2>
        <StateRow label="Selection"><LanguageControl /></StateRow>
      </section>

      <section aria-labelledby="account-heading" style={styles.section}>
        <h2 id="account-heading" style={styles.heading}>Account</h2>
        <StateRow label="Avatar trigger">
          <AccountMenu
            email="jerryxiang24@gmail.com"
            isAdmin
            onLogout={async () => undefined}
          />
        </StateRow>
      </section>

      <section aria-labelledby="focus-heading" style={styles.section}>
        <h2 id="focus-heading" style={styles.heading}>Focus examples</h2>
        <StateRow label="Tab to inspect visible focus">
          <Button variant="secondary">Focusable button</Button>
          <IconButton icon="account" label="Focusable account control" onClick={() => undefined} />
        </StateRow>
      </section>

      <section aria-labelledby="tokens-heading" style={styles.section}>
        <h2 id="tokens-heading" style={styles.heading}>Tokens</h2>
        <StateRow label="Colors">
          {colors.map(([name, value]) => (
            <div key={name} style={styles.swatchItem}>
              <span style={{ ...styles.swatch, background: value }} />
              <span>{name}</span>
            </div>
          ))}
        </StateRow>
        <StateRow label="Spacing">
          <div style={styles.tokenColumn}>
            {spaces.map(([name, value]) => (
              <div key={name} style={styles.tokenLine}>
                <span style={styles.tokenName}>{name}px</span>
                <span style={{ ...styles.spaceBar, width: value }} />
              </div>
            ))}
          </div>
        </StateRow>
        <StateRow label="Radius">
          {radii.map(([name, value]) => (
            <div key={name} style={styles.swatchItem}>
              <span style={{ ...styles.radiusSample, borderRadius: value }} />
              <span>{name}px</span>
            </div>
          ))}
        </StateRow>
      </section>
    </main>
  );
}

const styles = {
  page: {
    background: "var(--cw-color-canvas)",
    color: "var(--cw-color-ink)",
    display: "grid",
    gap: "var(--cw-space-8)",
    margin: "0 auto",
    maxWidth: 1080,
    minHeight: "100vh",
    padding: "var(--cw-space-8) var(--cw-space-6) var(--cw-space-18)",
  },
  intro: { maxWidth: 680 },
  eyebrow: {
    color: "var(--cw-color-action)",
    fontWeight: 700,
    letterSpacing: "0.08em",
    margin: 0,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: "var(--cw-type-display-family), var(--cw-type-display-fallback)",
    fontSize: "clamp(2.25rem, 6vw, 4.5rem)",
    lineHeight: 1,
    margin: "var(--cw-space-2) 0",
  },
  summary: { color: "var(--cw-color-muted-ink)", fontSize: "1.125rem", margin: 0 },
  section: {
    background: "var(--cw-color-surface)",
    border: "1px solid var(--cw-color-divider)",
    borderRadius: "var(--cw-radius-card)",
    display: "grid",
    gap: "var(--cw-space-4)",
    padding: "var(--cw-space-6)",
  },
  heading: {
    fontFamily: "var(--cw-type-display-family), var(--cw-type-display-fallback)",
    fontSize: "1.75rem",
    margin: 0,
  },
  row: {
    borderTop: "1px solid var(--cw-color-divider)",
    display: "grid",
    gap: "var(--cw-space-4)",
    gridTemplateColumns: "minmax(9rem, 0.35fr) minmax(0, 1fr)",
    paddingTop: "var(--cw-space-4)",
  },
  label: { color: "var(--cw-color-muted-ink)", fontWeight: 600, margin: 0 },
  examples: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--cw-space-3)",
    minWidth: 0,
  },
  swatchItem: { alignItems: "center", display: "grid", gap: "var(--cw-space-2)" },
  swatch: {
    border: "1px solid var(--cw-color-divider)",
    borderRadius: "var(--cw-radius-control)",
    height: 64,
    width: 64,
  },
  tokenColumn: { display: "grid", gap: "var(--cw-space-2)", width: "100%" },
  tokenLine: { alignItems: "center", display: "flex", gap: "var(--cw-space-3)" },
  tokenName: { color: "var(--cw-color-muted-ink)", width: 42 },
  spaceBar: { background: "var(--cw-color-action)", display: "block", height: 8 },
  radiusSample: {
    background: "var(--cw-color-subtle-surface)",
    border: "1px solid var(--cw-color-action)",
    display: "block",
    height: 64,
    width: 64,
  },
} satisfies Record<string, CSSProperties>;
