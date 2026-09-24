"use client";

import { createManualRecipeDraft, extractSharedVideoUrl, recipeSourceMomentUrl, type RecipeImportCapabilities } from "@cooking/shared";
import { runRecipeImport } from "@cooking/api-client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "../components/PageShell";
import { RequireAuth } from "../components/RequireAuth";
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

  async function handleImportPreview(analyzeVideo = false) {
    if (active.current) return;
    if (values.mode === "media" && (!media || !capabilities?.media_upload)) return;
    if (values.mode === "media" && media!.size > capabilities!.max_media_bytes) { setError(t("import.mediaTooLarge")); return; }
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    active.current = controller;
    const pastedUrl = extractSharedVideoUrl(values.url, undefined) ?? values.url.trim();
    const sourceUrl = analyzeVideo
      ? draftRecipe?.source_url || pastedUrl
      : pastedUrl || draftRecipe?.source_url;
    try {
      const payload = { url: sourceUrl || undefined, notes: values.notes, title: values.title.trim() || draftRecipe?.title, library_tags: values.libraryTags };
      const start = () => {
        if (values.mode === "media" && !analyzeVideo) {
          const form = new FormData();
          form.append("file", media!);
          if (payload.url) form.append("source_url", payload.url);
          form.append("notes", payload.notes); form.append("title", payload.title || "");
          form.append("library_tags", JSON.stringify(payload.library_tags));
          return webApiClient.recipes.createMediaImportJob(form);
        }
        return webApiClient.recipes.createImportJob({ ...payload, mode: analyzeVideo ? "video" : values.mode === "transcript" ? "text" : "link", transcript: values.mode === "transcript" ? values.transcript : undefined });
      };
      const draft = await runRecipeImport(start, webApiClient.recipes, controller.signal);
      if (controller.signal.aborted || active.current !== controller) return;
      const recovered = { ...draft, source_url: draft.source_url || sourceUrl || null };
      if (draftRecipe) setCandidate(recovered);
      else { setManual(false); setDraftRecipe(recovered); }
      setShowSource(false);
      releaseSharedItem();
    } catch (caught) {
      if (controller.signal.aborted || active.current !== controller) return;
      setError(caught instanceof Error ? caught.message : t("import.failed"));
    } finally {
      if (active.current === controller) { active.current = null; setLoading(false); }
    }
  }

  return (
    <PageShell>
      {loading ? <div className={styles.recoveryPanel} role="status"><p>{t("import.processing")}</p><button type="button" onClick={cancelImport}>{t("import.cancelJob")}</button></div> : null}
      {draftRecipe && !showSource ? (
        <>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          {candidate ? <section className={styles.recoveryPanel} aria-label={t("import.reviewCandidate")}>
            <p>{t("import.reviewCandidate")}</p>
            <h3>{candidate.title}</h3>
            <ul>{candidate.ingredients.map((ingredient, index) => <li key={index}>{ingredient.quantity} {ingredient.name}</li>)}</ul>
            <ol>{candidate.steps?.map((step, index) => <li key={step.id || index}>{step.text}</li>)}</ol>
            <button type="button" disabled={loading} onClick={() => { setDraftRecipe(candidate); setCandidate(null); setManual(false); }}>{t("import.applyCandidate")}</button>
            <button type="button" disabled={loading} onClick={() => setCandidate(null)}>{t("import.keepDraft")}</button>
          </section> : null}
          {draftRecipe.import_review?.status === "needs_review" ? <section className={styles.recoveryPanel} role="status">
            <h2>{t("import.partialTitle")}</h2><p>{t("import.partialHelp")}</p>
            {draftRecipe.import_review.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
            {capabilities?.video_analysis && draftRecipe.import_review.can_analyze_video ? <button type="button" disabled={loading} onClick={() => void handleImportPreview(true)}>{t("import.analyzeVideo")}</button> : <p>{t("import.videoUnavailable")}</p>}
            <button type="button" disabled={loading} onClick={() => { setValues(current => ({ ...current, mode: "transcript" })); setShowSource(true); }}>{t("import.recoveryText")}</button>
          </section> : null}
          <DraftRecipeEditor
            draft={draftRecipe}
            requireCompleteRecipe={manual}
            disabled={loading}
            onChange={setDraftRecipe}
            onBack={() => setShowSource(true)}
            onSaveSuccess={(savedId) => router.push(`/recipe/${savedId}`)}
          />
        </>
      ) : (
        <>
          <header className={styles.sourceHeader}>
            <h1>{t("import.importRecipe")}</h1><p>{editorialCopy["import.tagline"]}</p>
            {draftRecipe ? <button type="button" disabled={loading} onClick={() => setShowSource(false)}>{t("import.resumeDraft")}</button> : <button className="btn-secondary" type="button" disabled={loading} onClick={() => { setError(null); setManual(true); setDraftRecipe(createManualRecipeDraft()); setShowSource(false); }}>{t("import.createManually")}</button>}
          </header>
          {capabilities && !capabilities.video_analysis && values.mode === "link" ? <p>{t("import.videoUnavailable")}</p> : null}
          {error && capabilities?.video_analysis && recipeSourceMomentUrl(values.url, 0) ? <button type="button" disabled={loading} onClick={() => void handleImportPreview(true)}>{t("import.analyzeVideo")}</button> : null}
          {pendingShareId ? <div className={styles.sharedNotice}>
            <p role="status">{t(media ? "import.sharedVideoReady" : "import.sharedRecipeReady")}</p>
            <button type="button" disabled={loading} onClick={discardSharedItem}>{t("import.discardShared")}</button>
          </div> : null}
          {receivingShare ? <p role="status">{t("import.openingShared")}</p> : <ImportSourceStep values={values} parsing={loading} error={error}
            onChange={(next) => { setValues(next); setError(null); }} onSubmit={() => void handleImportPreview()}
            mediaEnabled={Boolean(capabilities?.media_upload)} maxMediaBytes={capabilities?.max_media_bytes} media={media} onMediaChange={(file) => { setMedia(file); setError(null); }} />}
        </>
      )}
    </PageShell>
  );
}

export default function ImportPage() {
  const { user, loading } = useAuth();
  return <RequireAuth>{!loading && user ? <ImportPageContent key={user.id} userId={user.id} /> : null}</RequireAuth>;
}
