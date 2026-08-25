"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, PageShell } from "../components/PageShell";
import { RequireAuth } from "../components/RequireAuth";
import { apiFetch } from "../lib/api";
import { useT } from "../lib/i18n";
import type { Recipe } from "../types";
import { DraftRecipeEditor } from "./DraftRecipeEditor";
import { ImportSourceStep, type ImportSourceValues } from "./ImportSourceStep";

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

export default function ImportPage() {
  const router = useRouter();
  const t = useT();
  const [values, setValues] = useState<ImportSourceValues>(INITIAL_VALUES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRecipe, setDraftRecipe] = useState<Recipe | null>(null);

  async function handleImportPreview() {
    setError(null);
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
    <RequireAuth>
      <PageShell>
        {draftRecipe ? (
          <DraftRecipeEditor
            draft={draftRecipe}
            onChange={setDraftRecipe}
            onBack={() => setDraftRecipe(null)}
            onSaveSuccess={(savedId) => router.push(`/recipe/${savedId}`)}
          />
        ) : (
          <>
            <PageHeader title="Import recipe" />
            <ImportSourceStep
              values={values}
              parsing={loading}
              error={error}
              onChange={setValues}
              onSubmit={() => void handleImportPreview()}
            />
          </>
        )}
      </PageShell>
    </RequireAuth>
  );
}
