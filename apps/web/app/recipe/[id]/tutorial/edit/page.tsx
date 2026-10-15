"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { isSafeExternalUrl, type RecipeStep } from "@cooking/shared";
import { PageShell } from "../../../../components/PageShell";
import { RequireAuth } from "../../../../components/RequireAuth";
import { Button } from "../../../../components/ui/Button";
import { StepListEditor } from "../../../../import/StepListEditor";
import { apiFetch } from "../../../../lib/api";
import { useT } from "../../../../lib/i18n";
import { stepTotalMinutes } from "../../../../lib/recipeTotalTime";
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
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [draftSteps, setDraftSteps] = useState<RecipeStep[]>([]);
  const [automaticTotal, setAutomaticTotal] = useState(false);
  const [stepsValid, setStepsValid] = useState(true);
  const [loading, setLoading] = useState(true);
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const detailHref = `/recipe/${id}`;
  const canEstimate = draftSteps.some((step) => step.duration_source === "fallback" || step.duration_source === "unknown" || step.duration_seconds == null);

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
          setCoverUrl(recipe.thumbnail_url ?? null);
          setSourceUrl(recipe.source_url ?? null);
          setDraftSteps(copySteps(recipe.steps));
          // Keep a separate source total even if a temporary step sum matches it.
          setAutomaticTotal(recipe.total_time_minutes == null
            || recipe.total_time_minutes === stepTotalMinutes(recipe.steps));
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
    if (!id || !canEstimate || estimating || saving) return;
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
    if (!id || !stepsValid || saving || estimating) return;
    setSaveError(null);
    setSaving(true);
    try {
      const response = await apiFetch(`/recipes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: draftSteps,
          ...(automaticTotal ? { total_time_minutes: stepTotalMinutes(draftSteps) } : {}),
        }),
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

  const activeSteps = draftSteps.filter(step => step.text.trim());
  const totalSeconds = activeSteps.length && activeSteps.every(step => typeof step.duration_seconds === "number" && step.duration_seconds > 0)
    ? activeSteps.reduce((total, step) => total + step.duration_seconds!, 0) : null;

  return (
    <PageShell className={styles.page}>
      <Link className={styles.back} href={detailHref} aria-disabled={saving || estimating || undefined}
        tabIndex={saving || estimating ? -1 : undefined} onClick={event => { if (saving || estimating) event.preventDefault(); }}>← {t("recipe.tutorial.editor.back")}</Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className="cw-display">{t("recipe.tutorial.edit")}</h1>
          <p>{t("recipe.tutorial.editor.subtitle")}</p>
        </div>
        <div className={styles.actions}>
          <Button disabled={saving || estimating} onClick={() => router.push(detailHref)} size="lg" variant="ghost">
            {t("recipe.tutorial.cancel")}
          </Button>
          <Button disabled={!stepsValid || estimating} loading={saving} onClick={() => void handleSave()} size="lg">
            {t("recipe.tutorial.save")}
          </Button>
        </div>
      </header>

      {estimateError ? <p className={styles.error} role="alert">{estimateError}</p> : null}
      {saveError ? <p className={styles.error} role="alert">{saveError}</p> : null}

      <div className={styles.layout}>
        <div className={styles.method}>
          <StepListEditor disabled={estimating || saving} onChange={setDraftSteps}
            onValidityChange={setStepsValid} steps={draftSteps} sourceUrl={sourceUrl} />
          <p className={styles.saveHint}>{t("recipe.tutorial.editor.saveHint")}</p>
        </div>
        <aside className={styles.context} aria-label={t("recipe.tutorial.editor.overview")}>
          <div className={styles.recipePreview}>
            {coverUrl ? <img src={coverUrl} alt="" className={styles.cover} /> : null}
            <div>
              <p className={styles.eyebrow}>{t("recipe.tutorial.editor.overview")}</p>
              <h2 className="cw-display">{recipeTitle}</h2>
              {isSafeExternalUrl(sourceUrl) ? <a className={styles.source} href={sourceUrl} target="_blank" rel="noopener noreferrer">{t("recipe.originalVideo")} ↗</a> : null}
            </div>
          </div>
          <div className={styles.summary}>
            <span>{t("recipe.tutorial.editor.stepCount", { count: activeSteps.length })}</span>
            {totalSeconds ? <span>{t("recipe.tutorial.duration.aboutMinutes", { minutes: Math.ceil(totalSeconds / 60) })}</span> : null}
          </div>
          <p className={styles.contextHint}>{t(canEstimate ? "recipe.tutorial.editor.estimateHint" : "recipe.tutorial.editor.timingHint")}</p>
          {canEstimate ? (
            <Button disabled={estimating || saving} loading={estimating} onClick={() => void handleEstimate()} size="lg" variant="secondary">
              {estimating ? t("recipe.tutorial.editor.estimating") : t("recipe.tutorial.editor.estimate")}
            </Button>
          ) : null}
        </aside>
      </div>
    </PageShell>
  );
}

export default function TutorialEditPage() {
  return <RequireAuth><TutorialEditContent /></RequireAuth>;
}
