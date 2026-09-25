"use client";

import { createManualRecipeDraft, extractSharedVideoUrl, formatStepDuration, recipeSourceMomentUrl, type RecipeImportCapabilities } from "@cooking/shared";
import { runRecipeImport } from "@cooking/api-client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "../components/PageShell";
import { RequireAuth } from "../components/RequireAuth";
import { Icon } from "../components/ui/Icon";
import { webApiClient } from "../lib/api";
import { useEditorialCopy } from "../lib/editorialCopy";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { deleteSharedRecipe, readSharedRecipe, sharedRecipeText, shareErrorMessage } from "../lib/shareTarget";
import type { Recipe } from "../types";
import { DraftRecipeEditor } from "./DraftRecipeEditor";
import { ImportSourceStep, type ImportSourceValues } from "./ImportSourceStep";
import styles from "./ImportFlow.module.css";

const INITIAL_VALUES: ImportSourceValues = { mode: "link", url: "", transcript: "", notes: "", title: "", libraryTags: [] };

function draftWithAdditionalText(draft: Recipe, text: string): string {
  return [
    "Update the current recipe with the additional recipe text. Retain the current details unless the added text corrects them.",
    "Current recipe draft (includes the user's edits):",
    draft.title,
    `Description: ${draft.description ?? ""}`,
    "Ingredients:",
    ...draft.ingredients.map(item => `${item.quantity} ${item.name}${item.metric_quantity ? ` (Metric amount: ${item.metric_quantity})` : ""}${item.notes ? ` — ${item.notes}` : ""}`.trim()),
    "Cooking steps:",
    ...(draft.steps ?? []).map((step, index) => `${index + 1}. ${step.text}`),
    "Tips:",
    ...(draft.tips ?? []),
    "Equipment:",
    ...(draft.equipment ?? []),
    "Additional recipe text:",
    text.trim(),
  ].join("\n");
}

function stepTotalMinutes(steps: Recipe["steps"]): number | null {
  const instructions = steps?.filter(step => step.text.trim()) ?? [];
  if (!instructions.length || instructions.some(step =>
    typeof step.duration_seconds !== "number" || !Number.isFinite(step.duration_seconds) || step.duration_seconds <= 0,
  )) return null;
  return Math.ceil(instructions.reduce((total, step) => total + step.duration_seconds!, 0) / 60);
}

function preserveDraftDetails(original: Recipe, candidate: Recipe): Recipe {
  const steps = candidate.steps?.map(step => {
    const text = step.text.trim();
    const matches = original.steps?.filter(previous => previous.text.trim() === text) ?? [];
    if (!text || matches.length !== 1 || candidate.steps!.filter(next => next.text.trim() === text).length !== 1) return step;
    const previous = matches[0];
    const keepDuration = (previous.duration_source === "user"
      || (previous.duration_source === "stated" && previous.instruction_source === "source" && previous.source_excerpt?.trim()))
      && typeof previous.duration_seconds === "number" && Number.isFinite(previous.duration_seconds) && previous.duration_seconds > 0;
    // Unchanged, unambiguous instructions retain their existing identity and evidence.
    // Timers are restored locally so the text parser cannot mistake them for source claims.
    return {
      ...step,
      id: previous.id ?? step.id,
      image_url: step.image_url ?? previous.image_url,
      instruction_source: previous.instruction_source ?? step.instruction_source,
      source_excerpt: previous.source_excerpt ?? null,
      source_start_seconds: previous.source_start_seconds ?? null,
      source_end_seconds: previous.source_end_seconds ?? null,
      ...(keepDuration ? { duration_seconds: previous.duration_seconds, duration_source: previous.duration_source } : {}),
    };
  });
  const ingredients = candidate.ingredients.map(item => {
    if (item.metric_quantity?.trim()) return item;
    const name = item.name.trim().toLocaleLowerCase();
    const matches = original.ingredients.filter(previous => previous.name.trim().toLocaleLowerCase() === name);
    if (!name || matches.length !== 1 || candidate.ingredients.filter(next => next.name.trim().toLocaleLowerCase() === name).length !== 1) return item;
    return { ...item, metric_quantity: matches[0].metric_quantity };
  });
  const originalTotalIsDistinct = original.total_time_minutes != null && original.total_time_minutes !== stepTotalMinutes(original.steps);
  const candidateTotalTracksSteps = candidate.total_time_minutes == null || candidate.total_time_minutes === stepTotalMinutes(candidate.steps);
  return {
    ...candidate,
    source_url: original.source_url || candidate.source_url,
    description: candidate.description?.trim() ? candidate.description : original.description,
    tips: candidate.tips?.some(tip => tip.trim()) ? candidate.tips : original.tips,
    equipment: candidate.equipment?.some(item => item.trim()) ? candidate.equipment : original.equipment,
    ingredients,
    steps,
    total_time_minutes: originalTotalIsDistinct ? original.total_time_minutes
      : candidateTotalTracksSteps ? stepTotalMinutes(steps) : candidate.total_time_minutes,
  };
}

function ImportPageContent({ userId }: { userId: string }) {
  const router = useRouter();
  const t = useT();
  const editorialCopy = useEditorialCopy();
  const [values, setValues] = useState<ImportSourceValues>(INITIAL_VALUES);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRecipe, setDraftRecipe] = useState<Recipe | null>(null);
  const [candidate, setCandidate] = useState<Recipe | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [addingText, setAddingText] = useState(false);
  const [additionalText, setAdditionalText] = useState("");
  const [capabilities, setCapabilities] = useState<RecipeImportCapabilities | null>(null);
  const [media, setMedia] = useState<File | null>(null);
  const active = useRef<AbortController | null>(null);
  const [pendingShareId, setPendingShareId] = useState<string | null>(null);
  const [receivingShare, setReceivingShare] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("share");
    const shareError = params.get("shareError");
    if (shareError) setError(shareErrorMessage(shareError));
    if (shareId) {
      setReceivingShare(true);
      void readSharedRecipe(shareId, userId).then(share => {
        if (cancelled) return;
        const text = sharedRecipeText(share);
        const url = extractSharedVideoUrl(share.url, `${share.text}\n${share.title}`);
        if (share.video) {
          setMedia(share.video);
          setValues({ ...INITIAL_VALUES, mode: "media", url: url ?? "" });
        } else if (url) {
          setValues({ ...INITIAL_VALUES, url });
        } else {
          if (!text) throw new Error("This shared item is empty. Share a recipe link or video.");
          if (/https?:\/\//i.test(text)) throw new Error("Share a YouTube, TikTok, or RedNote recipe link.");
          setValues({ ...INITIAL_VALUES, mode: "transcript", transcript: text });
        }
        setPendingShareId(shareId);
      }).catch(caught => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Couldn't open this shared item.");
      }).finally(() => { if (!cancelled) setReceivingShare(false); });
    }
    return () => { cancelled = true; };
  }, [userId]);

  function releaseSharedItem() {
    if (pendingShareId) void deleteSharedRecipe(pendingShareId, userId).catch(() => { /* Unread entries also expire. */ });
    setPendingShareId(null);
    const next = new URL(window.location.href);
    next.searchParams.delete("share"); next.searchParams.delete("shareError");
    window.history.replaceState(window.history.state, "", `${next.pathname}${next.search}${next.hash}`);
  }

  function discardSharedItem() {
    releaseSharedItem(); setValues(INITIAL_VALUES); setMedia(null); setError(null);
  }

  useEffect(() => {
    let alive = true;
    void webApiClient.recipes.importCapabilities().then(result => { if (alive) setCapabilities(result); }).catch(() => { if (alive) setCapabilities({ video_analysis: false, media_upload: false, max_media_bytes: 0 }); });
    return () => { alive = false; active.current?.abort(); active.current = null; };
  }, []);

  function cancelImport() {
    active.current?.abort(); active.current = null; setLoading(false);
  }

  async function handleImportPreview(analyzeVideo = false, recipeText?: string) {
    if (active.current) return;
    const updatingDraft = analyzeVideo || recipeText !== undefined;
    const importingMedia = values.mode === "media" && !updatingDraft;
    if (importingMedia && (!media || !capabilities?.media_upload)) return;
    if (importingMedia && media!.size > capabilities!.max_media_bytes) { setError(t("import.mediaTooLarge")); return; }
    setError(null);
    setCandidate(null);
    setLoading(true);
    const controller = new AbortController();
    active.current = controller;
    const pastedUrl = extractSharedVideoUrl(values.url, undefined) ?? values.url.trim();
    const sourceUrl = updatingDraft && !showSource
      ? draftRecipe?.source_url || pastedUrl
      : pastedUrl || draftRecipe?.source_url;
    try {
      const payload = {
        url: sourceUrl || undefined,
        notes: values.notes,
        title: updatingDraft ? draftRecipe?.title || values.title.trim() : values.title.trim() || draftRecipe?.title,
        library_tags: updatingDraft ? draftRecipe?.library_tags ?? values.libraryTags : values.libraryTags,
      };
      const start = () => {
        if (importingMedia) {
          const form = new FormData();
          form.append("file", media!);
          if (payload.url) form.append("source_url", payload.url);
          form.append("notes", payload.notes); form.append("title", payload.title || "");
          form.append("library_tags", JSON.stringify(payload.library_tags));
          return webApiClient.recipes.createMediaImportJob(form);
        }
        return webApiClient.recipes.createImportJob({
          ...payload,
          mode: analyzeVideo ? "video" : recipeText !== undefined || values.mode === "transcript" ? "text" : "link",
          transcript: analyzeVideo ? undefined : recipeText ?? (values.mode === "transcript" ? values.transcript : undefined),
        });
      };
      const draft = await runRecipeImport(start, webApiClient.recipes, controller.signal);
      if (controller.signal.aborted || active.current !== controller) return;
      const recovered = { ...draft, source_url: draft.source_url || sourceUrl || null };
      if (draftRecipe) setCandidate(recipeText !== undefined ? preserveDraftDetails(draftRecipe, recovered) : recovered);
      else { setManual(false); setDraftRecipe(recovered); }
      setShowSource(false);
      setAddingText(false);
      releaseSharedItem();
    } catch (caught) {
      if (controller.signal.aborted || active.current !== controller) return;
      setError(caught instanceof Error ? caught.message : t("import.failed"));
    } finally {
      if (active.current === controller) { active.current = null; setLoading(false); }
    }
  }

  const review = draftRecipe?.import_review;
  const warnings = Array.from(new Map((review?.warnings ?? [])
    .map(warning => warning.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map(warning => [warning.toLocaleLowerCase(), warning])).values());
  const canAnalyzeVideo = Boolean(capabilities?.video_analysis && review?.can_analyze_video
    && review.source_kind !== "video" && review.source_kind !== "media"
    && recipeSourceMomentUrl(draftRecipe?.source_url, 0));
  const sourceSummary = (addingText ? additionalText
    : draftRecipe && !showSource ? draftRecipe.source_url || draftRecipe.title
      : values.mode === "media" ? media?.name || ""
        : values.mode === "transcript" ? values.transcript
          : extractSharedVideoUrl(values.url, undefined) || values.url).trim().replace(/\s+/g, " ");
  const preparing = <section className={styles.preparingPanel} aria-labelledby="import-preparing-title">
    <ol className={styles.progressSteps}>
      <li>{t("import.stageSource")}</li>
      <li aria-current="step">{t("import.createDraft")}</li>
      <li>{t("import.stageReview")}</li>
    </ol>
    <Icon name="chef" size={32} className={styles.progressIcon} />
    <h2 id="import-preparing-title" role="status">{t("import.processing")}</h2>
    <p>{t("import.preparingHelp")}</p>
    {sourceSummary ? <p className={styles.progressSource}>{sourceSummary.length > 140 ? `${sourceSummary.slice(0, 140)}…` : sourceSummary}</p> : null}
    <div className={styles.progressFooter}>
      <p>{t("import.reviewBeforeSaving")}</p>
      <button type="button" onClick={cancelImport}>{t("import.cancelJob")}</button>
    </div>
  </section>;

  const reviewNotice = draftRecipe ? (<>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          {review ? <section className={styles.reviewSummary}>
            <h2>{t("import.partialTitle")}</h2><p>{t("import.partialHelp")}</p>
            {warnings.length ? <details className={styles.reviewDetails}>
              <summary>{t("import.reviewDetails")}</summary>
              <ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
            </details> : null}
            {!addingText && !candidate ? <div className={styles.recoveryActions}>
              {canAnalyzeVideo ? <button type="button" disabled={loading} onClick={() => void handleImportPreview(true)}>{t("import.analyzeVideo")}</button> : null}
              <button type="button" disabled={loading} onClick={() => { setError(null); setAddingText(true); }}>{t("import.recoveryText")}</button>
            </div> : null}
          </section> : null}
          {candidate ? <section className={styles.candidateReview} aria-label={t("import.reviewCandidate")}>
            <p>{t("import.reviewCandidate")}</p>
            <h3>{candidate.title}</h3>
            {candidate.description ? <p>{candidate.description}</p> : null}
            <p>{t(candidate.steps?.some(step => step.duration_source === "estimated" || step.duration_source === "fallback") ? "recipe.estimatedTotal" : "recipe.totalTime")}: {candidate.total_time_minutes == null ? t("recipe.tutorial.source.unknown") : `${candidate.total_time_minutes} ${t("recipe.totalTime.minutesSuffix")}`}</p>
            <ul>{candidate.ingredients.map((ingredient, index) => <li key={index}>{ingredient.quantity} {ingredient.name}{ingredient.metric_quantity ? ` (${ingredient.metric_quantity})` : ""}</li>)}</ul>
            <ol>{candidate.steps?.map((step, index) => <li key={step.id || index}>
              {step.text}
              <p>{formatStepDuration(step.duration_seconds) ? `${formatStepDuration(step.duration_seconds)} · ${t(`recipe.tutorial.source.${step.duration_source ?? "fallback"}`)}` : t("recipe.tutorial.source.unknown")}</p>
            </li>)}</ol>
            {candidate.tips?.length ? <><h4>{t("recipe.tips")}</h4><ul>{candidate.tips.map((tip, index) => <li key={index}>{tip}</li>)}</ul></> : null}
            {candidate.equipment?.length ? <><h4>{t("recipe.equipment")}</h4><ul>{candidate.equipment.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
            <div className={styles.recoveryActions}>
              <button type="button" disabled={loading} onClick={() => { setDraftRecipe(candidate); setCandidate(null); setManual(false); }}>{t("import.applyCandidate")}</button>
              <button type="button" disabled={loading} onClick={() => setCandidate(null)}>{t("import.keepDraft")}</button>
            </div>
          </section> : null}
          {loading ? preparing : addingText ? <form className={styles.contextualText} onSubmit={event => {
            event.preventDefault();
            if (additionalText.trim()) void handleImportPreview(false, draftWithAdditionalText(draftRecipe, additionalText));
          }}>
            <h2>{t("import.recoveryText")}</h2>
            <p>{t("import.addTextHelp")}</p>
            {draftRecipe.source_url ? <p>{t("import.sourcePreserved")}</p> : null}
            <label htmlFor="import-additional-text">{t("import.additionalText")}</label>
            <textarea id="import-additional-text" value={additionalText} onChange={event => { setAdditionalText(event.target.value); setError(null); }} />
            <div className={styles.recoveryActions}>
              <button type="submit" disabled={!additionalText.trim()}>{t("import.updateDraft")}</button>
              <button type="button" onClick={() => { setAddingText(false); setError(null); }}>{t("common.cancel")}</button>
            </div>
          </form> : null}
  </>) : null;

  return (
    <PageShell>
      <div className={styles.importWorkspace}>
      {draftRecipe && !showSource ? (
          <DraftRecipeEditor
            draft={draftRecipe}
            reviewNotice={reviewNotice}
            requireCompleteRecipe={manual}
            disabled={loading}
            onChange={setDraftRecipe}
            onBack={() => { setShowSource(true); setAddingText(false); setError(null); }}
            onSaveSuccess={(savedId) => router.push(`/recipe/${savedId}`)}
          />
      ) : (
        <>
          <header className={styles.sourceHeader}>
            <h1>{t("import.importRecipe")}</h1><p>{editorialCopy["import.tagline"]}</p>
            {draftRecipe ? <button type="button" disabled={loading} onClick={() => { setShowSource(false); setError(null); }}>{t("import.resumeDraft")}</button> : null}
          </header>
          <div className={styles.sourceLayout}>
            <div>
              {pendingShareId && !loading ? <div className={styles.sharedNotice}>
                <p role="status">{t(media ? "import.sharedVideoReady" : "import.sharedRecipeReady")}</p>
                <button type="button" onClick={discardSharedItem}>{t("import.discardShared")}</button>
              </div> : null}
              {loading ? preparing : receivingShare ? <p role="status">{t("import.openingShared")}</p> : <ImportSourceStep values={values} parsing={false} error={error}
                onChange={(next) => { setValues(next); setError(null); }} onSubmit={() => void handleImportPreview()}
                mediaEnabled={Boolean(capabilities?.media_upload)} maxMediaBytes={capabilities?.max_media_bytes} media={media} onMediaChange={(file) => { setMedia(file); setError(null); }} />}
              {!loading && capabilities && !capabilities.video_analysis && values.mode === "link" ? <p className={styles.sourceHint}>{t("import.videoUnavailable")}</p> : null}
              {!loading && error && capabilities?.video_analysis && recipeSourceMomentUrl(values.url, 0) ? <div className={styles.recoveryActions}><button type="button" onClick={() => void handleImportPreview(true)}>{t("import.analyzeVideo")}</button></div> : null}
            </div>
            <aside className={styles.manualAside}>
              <h2>{t("import.manualTitle")}</h2>
              <p>{t("import.manualHelp")}</p>
              <button type="button" disabled={loading || receivingShare} onClick={() => { setError(null); setManual(true); setCandidate(null); setDraftRecipe(createManualRecipeDraft()); setShowSource(false); }}>{t("import.createManually")}</button>
            </aside>
          </div>
        </>
      )}
      </div>
    </PageShell>
  );
}

export default function ImportPage() {
  const { user, loading } = useAuth();
  return <RequireAuth>{!loading && user ? <ImportPageContent key={user.id} userId={user.id} /> : null}</RequireAuth>;
}
