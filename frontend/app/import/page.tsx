"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import type { Recipe } from "../types";

export default function ImportPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [notes, setNotes] = useState("");
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
          body: JSON.stringify({ transcript, notes }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Import failed");
        }
        const recipe: Recipe = await res.json();
        router.push(`/library?highlight=${recipe.id}`);
        return;
      }
      const res = await apiFetch("/recipes/import/link", {
        method: "POST",
        body: JSON.stringify({ url: url.trim(), notes }),
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

  const canSubmit =
    mode === "link" ? url.trim().length > 0 : transcript.trim().length > 0;

  return (
    <RequireAuth>
      <div className="import-editorial">
        <div className="import-editorial__header">
          <span className="import-editorial__kicker font-headline">New import</span>
          <h1 className="import-editorial__title font-headline">
            Import your <br />
            <span>culinary inspiration</span>
          </h1>
          <p className="import-editorial__sub">
            Turn video links or messy transcripts into structured recipes for your library and planner.
          </p>
        </div>

        <div className="import-engine">
          <div className="import-engine__tabs">
            <button
              type="button"
              className={`import-engine__tab font-headline${mode === "link" ? " is-active" : ""}`}
              onClick={() => setMode("link")}
            >
              Video link
            </button>
            <button
              type="button"
              className={`import-engine__tab font-headline${mode === "transcript" ? " is-active" : ""}`}
              onClick={() => setMode("transcript")}
            >
              Paste transcript
            </button>
          </div>

          {mode === "link" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <label className="import-engine__label" htmlFor="import-url">
                  Video URL
                </label>
                <div className="import-engine__field-wrap">
                  <span className="material-symbols-outlined">link</span>
                  <input
                    id="import-url"
                    className="import-engine__input"
                    type="url"
                    placeholder="https://www.youtube.com/… or TikTok…"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
              <div>
                <label className="import-engine__label" htmlFor="import-notes-link">
                  Additional context (optional)
                </label>
                <textarea
                  id="import-notes-link"
                  className="import-engine__textarea"
                  placeholder="Notes for the importer (diet, servings, what to focus on)…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={loading}
                  rows={4}
                />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <label className="import-engine__label" htmlFor="import-transcript">
                  Transcript or ingredient list
                </label>
                <textarea
                  id="import-transcript"
                  className="import-engine__textarea"
                  placeholder="Paste transcript or ingredients from the video…"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  disabled={loading}
                  rows={8}
                />
              </div>
              <div>
                <label className="import-engine__label" htmlFor="import-notes-tx">
                  Additional context (optional)
                </label>
                <textarea
                  id="import-notes-tx"
                  className="import-engine__textarea"
                  placeholder="Extra hints for extraction…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={loading}
                  rows={3}
                />
              </div>
            </div>
          )}

          {error && (
            <p style={{ color: "var(--error)", fontSize: "0.9rem", marginTop: "1rem" }} role="alert">
              {error}
            </p>
          )}

          <div className="import-engine__actions">
            <button
              type="button"
              className="import-engine__cta"
              onClick={handleImport}
              disabled={loading || !canSubmit}
            >
              {loading ? (
                <>
                  Importing…
                  <span className="material-symbols-outlined ms-fill import-spin" style={{ fontSize: "1.25rem" }}>
                    progress_activity
                  </span>
                </>
              ) : (
                <>
                  Import recipe
                  <span className="material-symbols-outlined" style={{ fontSize: "1.25rem" }}>
                    auto_awesome
                  </span>
                </>
              )}
            </button>
            <p className="import-engine__hint">
              <span className="material-symbols-outlined" style={{ fontSize: "1rem", color: "var(--tertiary)" }}>
                check_circle
              </span>
              Results go to your library when ready.
            </p>
          </div>

          <div className="import-engine__foot">
            <h4 className="font-headline">What happens next</h4>
            <p>
              We parse the link or text and save a draft recipe. Open it from the{" "}
              <Link href="/library" style={{ fontWeight: 800 }}>
                library
              </Link>{" "}
              to edit ingredients or add a cover image.
            </p>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
