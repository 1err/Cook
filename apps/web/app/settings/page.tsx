"use client";

import { useState } from "react";
import { RequireAuth } from "../components/RequireAuth";
import { useAuth } from "../lib/auth";

function SettingsPageContent() {
  const { user, setLibraryVisibility } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggle(next: boolean) {
    if (pending || !user) return;
    setPending(true);
    setError(null);
    try {
      await setLibraryVisibility(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update — please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!user) return null;

  return (
    <main style={mainStyle}>
      <h1 style={titleStyle}>Settings</h1>
      <section style={sectionStyle}>
        <div style={rowHeaderStyle}>
          <div style={{ flex: 1 }}>
            <h2 style={rowTitleStyle}>Share my library</h2>
            <p style={rowSubtitleStyle}>
              Anyone who knows your email can browse and copy your recipes.
            </p>
          </div>
          <label style={switchLabelStyle}>
            <input
              type="checkbox"
              checked={user.is_library_public}
              onChange={(e) => onToggle(e.target.checked)}
              disabled={pending}
              style={switchInputStyle}
            />
            <span style={switchTextStyle(user.is_library_public)}>
              {user.is_library_public ? "On" : "Off"}
            </span>
          </label>
        </div>
        {error ? <p style={errorStyle}>{error}</p> : null}
      </section>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsPageContent />
    </RequireAuth>
  );
}

const mainStyle: React.CSSProperties = {
  padding: "32px 24px",
  maxWidth: 720,
  margin: "0 auto",
};

const titleStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  margin: "0 0 24px",
};

const sectionStyle: React.CSSProperties = {
  padding: 16,
  border: "1px solid var(--border-color, #e9e8e7)",
  borderRadius: 12,
  background: "var(--surface-color, #ffffff)",
};

const rowHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
};

const rowTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 600,
};

const rowSubtitleStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 14,
  color: "var(--muted-color, #55423e)",
};

const switchLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  cursor: "pointer",
};

const switchInputStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  accentColor: "var(--primary-color, #9a442d)",
  cursor: "pointer",
};

function switchTextStyle(on: boolean): React.CSSProperties {
  return {
    fontSize: 14,
    fontWeight: 600,
    color: on ? "var(--primary-color, #9a442d)" : "var(--muted-color, #55423e)",
    minWidth: 28,
    textAlign: "center",
  };
}

const errorStyle: React.CSSProperties = {
  margin: "12px 0 0",
  fontSize: 14,
  color: "var(--error-color, #ba1a1a)",
};
