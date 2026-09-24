"use client";

import { createManualRecipeDraft } from "@cooking/shared";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "../components/PageShell";
import { RequireAuth } from "../components/RequireAuth";
import { apiFetch } from "../lib/api";
import { useEditorialCopy } from "../lib/editorialCopy";
import { useT } from "../lib/i18n";
import type { Recipe } from "../types";
import { DraftRecipeEditor } from "./DraftRecipeEditor";
import { ImportSourceStep, type ImportSourceValues } from "./ImportSourceStep";
import styles from "./ImportFlow.module.css";

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    if (!text.trim()) return fallback;
    try {
      const data = JSON.parse(text);
      if (data && typeof data === "object" && typeof data.detail === "string" && data.detail.trim()) {
        return data.detail;
      }
    } catch {
      return text;
    }
    return text;
  } catch {
    return fallback;
  }
}

const INITIAL_VALUES: ImportSourceValues = {
  mode: "link",
  url: "",
  transcript: "",
  notes: "",
  title: "",
  libraryTags: [],
};

function ImportPageContent() {
  const router = useRouter();
  const t = useT();
  const editorialCopy = useEditorialCopy();
  const [values, setValues] = useState<ImportSourceValues>(INITIAL_VALUES);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRecipe, setDraftRecipe] = useState<Recipe | null>(null);

  function handleValuesChange(next: ImportSourceValues) {
    setValues(next);
    setError(null);
  }

  async function handleImportPreview() {
    setError(null);
    setManual(false);
    setLoading(true);
    try {
      const endpoint = values.mode === "link" ? "/recipes/parse/link" : "/recipes/parse/transcript";
      const body =
        values.mode === "link"
          ? {
              url: values.url.trim(),
              notes: values.notes,
              title: values.title.trim(),
              library_tags: values.libraryTags,
            }
          : {
              transcript: values.transcript,
              notes: values.notes,
              title: values.title.trim(),
              library_tags: values.libraryTags,
            };
      const response = await apiFetch(endpoint, { method: "POST", body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await readErrorMessage(response, t("import.importRecipe")));
      setDraftRecipe(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("import.importRecipe"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell>
      {draftRecipe ? (
        <DraftRecipeEditor
          draft={draftRecipe}
          requireCompleteRecipe={manual}
          onChange={setDraftRecipe}
          onBack={() => setDraftRecipe(null)}
          onSaveSuccess={(savedId) => router.push(`/recipe/${savedId}`)}
        />
      ) : (
        <>
          <header className={styles.sourceHeader}>
            <h1>{t("import.importRecipe")}</h1>
            <p>{editorialCopy["import.tagline"]}</p>
            <button className="btn-secondary" type="button" disabled={loading} onClick={() => {
              setError(null);
              setManual(true);
              setDraftRecipe(createManualRecipeDraft());
            }}>{t("import.createManually")}</button>
          </header>
          <ImportSourceStep
            values={values}
            parsing={loading}
            error={error}
            onChange={handleValuesChange}
            onSubmit={() => void handleImportPreview()}
          />
        </>
      )}
    </PageShell>
  );
}

export default function ImportPage() {
  return <RequireAuth><ImportPageContent /></RequireAuth>;
}
