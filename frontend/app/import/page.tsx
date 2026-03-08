"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import type { Recipe } from "../types";

export default function ImportPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [mode, setMode] = useState<"link" | "transcript">("link");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setError(null);
    setLoading(true);
    try {
      if (mode === "transcript") {
        const res = await apiFetch("/recipes/import/transcript", {
          method: "POST",
          body: JSON.stringify({ transcript }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Import failed");
        }
        const recipe: Recipe = await res.json();
        router.push(`/library?highlight=${recipe.id}`);
        return;
      }
      // mode === "link"
      const params = new URLSearchParams({ url });
      const res = await apiFetch(`/recipes/import/link?${params}`, {
        method: "POST",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Import failed");
      }
      const recipe: Recipe = await res.json();
      router.push(`/library?highlight=${recipe.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <RequireAuth>
    <div className="app-container">
      <h1 style={h1Style}>Import Recipe from Video</h1>
      <p style={mutedStyle}>
        Paste a video link (TikTok, YouTube, etc.) or paste a transcript to
        extract a structured recipe using AI.
      </p>

      <div style={tabsStyle}>
        <button
          type="button"
          onClick={() => setMode("link")}
          style={mode === "link" ? tabActiveStyle : tabStyle}
        >
          Video link
        </button>
        <button
          type="button"
          onClick={() => setMode("transcript")}
          style={mode === "transcript" ? tabActiveStyle : tabStyle}
        >
          Paste transcript
        </button>
      </div>

      {mode === "link" ? (
        <input
          type="url"
          placeholder="https://www.tiktok.com/... or https://youtube.com/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={inputStyle}
          disabled={loading}
        />
      ) : (
        <textarea
          placeholder="Paste transcript or ingredient list from the video here..."
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          style={textareaStyle}
          rows={6}
          disabled={loading}
        />
      )}

      {error && <p style={errorStyle}>{error}</p>}

      <button
        type="button"
        onClick={handleImport}
        disabled={loading || (mode === "link" ? !url.trim() : !transcript.trim())}
        style={buttonStyle}
      >
        {loading ? "Importing…" : "Import recipe"}
      </button>
    </div>
    </RequireAuth>
  );
}

const h1Style: React.CSSProperties = {
  fontSize: "1.75rem",
  fontWeight: 600,
  marginBottom: "0.5rem",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.95rem",
  marginBottom: "1.5rem",
};

const tabsStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  marginBottom: "1rem",
};

const tabStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  cursor: "pointer",
  fontSize: "0.95rem",
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  background: "var(--accent)",
  color: "var(--bg)",
  borderColor: "var(--accent)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1rem",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: "1rem",
  marginBottom: "1rem",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1rem",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: "1rem",
  marginBottom: "1rem",
  resize: "vertical",
  fontFamily: "inherit",
};

const errorStyle: React.CSSProperties = {
  color: "#e57373",
  fontSize: "0.9rem",
  marginBottom: "1rem",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.75rem 1.5rem",
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  borderRadius: 8,
  fontSize: "1rem",
  fontWeight: 600,
  cursor: "pointer",
};
