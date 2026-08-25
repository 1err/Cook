"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { RecipeStep } from "@cooking/shared";
import { PageShell } from "../../../../components/PageShell";
import { RequireAuth } from "../../../../components/RequireAuth";
import { Button } from "../../../../components/ui/Button";
import { StepListEditor } from "../../../../import/StepListEditor";
import { apiFetch } from "../../../../lib/api";
import { useT } from "../../../../lib/i18n";
import type { Recipe } from "../../../../types";
import styles from "./TutorialEdit.module.css";

function copySteps(steps: RecipeStep[] | undefined): RecipeStep[] {
  return Array.isArray(steps) ? steps.map((step) => ({ ...step })) : [];
}

function TutorialEditContent() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const t = useT();
  const [recipeTitle, setRecipeTitle] = useState("");
  const [draftSteps, setDraftSteps] = useState<RecipeStep[]>([]);
  const [stepsValid, setStepsValid] = useState(true);
  const [loading, setLoading] = useState(true);
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const detailHref = `/recipe/${id}`;
  const canEstimate = draftSteps.some((step) => step.duration_source === "fallback");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function loadRecipe() {
      try {
        const response = await apiFetch(`/recipes/${id}`);
        if (!response.ok) throw new Error("load failed");
        const recipe = (await response.json()) as Recipe;
        if (!cancelled) {
          setRecipeTitle(recipe.title);
          setDraftSteps(copySteps(recipe.steps));
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRecipe();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleEstimate() {
    if (!id || !canEstimate || estimating) return;
    setEstimateError(null);
    setEstimating(true);
    try {
      const response = await apiFetch(`/recipes/${id}/tutorial/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: draftSteps }),
      });
      if (!response.ok) throw new Error(await response.text());
      const estimated = (await response.json()) as { steps?: RecipeStep[] };
      if (!Array.isArray(estimated.steps)) throw new Error("Invalid tutorial estimate");
      setDraftSteps(copySteps(estimated.steps));
    } catch {
      setEstimateError(t("recipe.tutorial.editor.estimateError"));
    } finally {
      setEstimating(false);
    }
  }

  async function handleSave() {
    if (!id || !stepsValid || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      const response = await apiFetch(`/recipes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: draftSteps }),
      });
      if (!response.ok) throw new Error(await response.text());
      router.push(detailHref);
    } catch {
      setSaveError(t("recipe.tutorial.editor.saveError"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <PageShell size="narrow"><p className={styles.status}>{t("common.loading")}</p></PageShell>;
  }

  if (loadFailed) {
    return (
      <PageShell size="narrow">
        <p className={styles.error} role="alert">{t("recipe.tutorial.editor.loadError")}</p>
      </PageShell>
    );
  }

  return (
    <PageShell className={styles.page} size="narrow">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{recipeTitle}</p>
          <h1 className="cw-display">{t("recipe.tutorial.edit")}</h1>
        </div>
        <div className={styles.actions}>
          <Button
            disabled={!canEstimate || estimating || saving}
            loading={estimating}
            onClick={() => void handleEstimate()}
            variant="secondary"
          >
            {estimating
              ? t("recipe.tutorial.editor.estimating")
              : t("recipe.tutorial.editor.estimate")}
          </Button>
          <Button
            disabled={saving}
            onClick={() => router.push(detailHref)}
            variant="ghost"
          >
            {t("recipe.tutorial.cancel")}
          </Button>
          <Button
            disabled={!stepsValid || estimating}
            loading={saving}
            onClick={() => void handleSave()}
          >
            {t("recipe.tutorial.save")}
          </Button>
        </div>
      </header>

      {estimateError ? <p className={styles.error} role="alert">{estimateError}</p> : null}
      {saveError ? <p className={styles.error} role="alert">{saveError}</p> : null}

      <StepListEditor
        onChange={setDraftSteps}
        onValidityChange={setStepsValid}
        steps={draftSteps}
      />
    </PageShell>
  );
}

export default function TutorialEditPage() {
  return <RequireAuth><TutorialEditContent /></RequireAuth>;
}
