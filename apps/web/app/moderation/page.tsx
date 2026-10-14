"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ContentReport, ModerationAction } from "@cooking/api-client";
import { PageHeader, PageShell } from "../components/PageShell";
import { RequireAuth } from "../components/RequireAuth";
import { isAdminUser } from "../lib/admin";
import { useAuth } from "../lib/auth";
import { webApiClient } from "../lib/api";
import { useT } from "../lib/i18n";
import styles from "./Moderation.module.css";
import { useAccountScope, type AccountActor } from "../components/safety/useAccountScope";
import { MediaReviewQueue } from "./MediaReviewQueue";

const ACTIONS: Array<{ value: ModerationAction; key: string }> = [
  { value: "dismiss", key: "safety.dismiss" },
  { value: "remove_shared_content", key: "safety.removeSharedContent" },
  { value: "remove_catalog", key: "safety.removeCatalog" },
  { value: "disable_library", key: "safety.disableLibrary" },
];

function ReportReview({ report, onResolved }: { report: ContentReport; onResolved: (report: ContentReport, actor: AccountActor) => void }) {
  const t = useT();
  const scope = useAccountScope();
  const id = useId();
  const [action, setAction] = useState<ModerationAction>("dismiss");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [failed, setFailed] = useState(false);
  async function apply(event: React.FormEvent) {
    event.preventDefault();
    const actor = scope.capture();
    if (!actor || busyRef.current) return;
    const label = t(ACTIONS.find((entry) => entry.value === action)!.key);
    if (!window.confirm(`${t("safety.resolveConfirm")}\n\n${label}\n${report.recipe?.title ?? report.recipe_id}`)) return;
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const updated = await webApiClient.moderation.resolve(report.id, action, notes.trim() || undefined, actor.id);
      onResolved(updated, actor);
    } catch {
      if (scope.active(actor)) setFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const recipe = report.recipe;
  return (
    <article className={styles.report}>
      <p className={styles.meta}>{new Date(report.created_at).toLocaleString()} · {t(`safety.reason.${report.reason}`)}</p>
      <h2>{recipe?.title ?? "Recipe no longer available"}</h2>
      {report.notes ? <p className={styles.notes}>{report.notes}</p> : null}
      {recipe ? <details>
        <summary>Reported recipe snapshot</summary>
        {recipe.thumbnail_url ? <img className={styles.preview} src={recipe.thumbnail_url} alt="" /> : null}
        {recipe.description ? <p>{recipe.description}</p> : null}
        <h3>Ingredients</h3>
        <ul>{recipe.ingredients.map((item, index) => <li key={index}>{item.name} · {item.quantity}</li>)}</ul>
        <h3>Steps</h3>
        <ol>{(recipe.steps ?? []).map((step, index) => <li key={index}>{step.text}</li>)}</ol>
      </details> : null}
      <p className={styles.meta}>Report {report.id} · Recipe {report.recipe_id}</p>
      {report.status === "pending" ? <form className={styles.form} onSubmit={(event) => void apply(event)}>
        <label htmlFor={`${id}-action`}>Action</label>
        <select id={`${id}-action`} value={action} onChange={(event) => setAction(event.target.value as ModerationAction)} disabled={busy}>
          {ACTIONS.map((entry) => <option key={entry.value} value={entry.value}>{t(entry.key)}</option>)}
        </select>
        <label htmlFor={`${id}-notes`}>{t("safety.moderationNotes")}</label>
        <textarea id={`${id}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={2000} disabled={busy} />
        {failed ? <p className={styles.error} role="alert">{t("safety.failed")}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? t("common.saving") : "Apply action"}</button>
      </form> : <p>{t(ACTIONS.find((entry) => entry.value === report.resolution)?.key ?? "safety.resolved")}{report.resolution_notes ? ` · ${report.resolution_notes}` : ""}</p>}
    </article>
  );
}

function AdminReports() {
  const t = useT();
  const scope = useAccountScope();
  const [status, setStatus] = useState<"pending" | "resolved">("pending");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const actor = scope.capture();
    if (!actor) return;
    setLoading(true);
    setFailed(false);
    setReports([]);
    webApiClient.moderation.list({ status, limit: 50, offset, expectedAccountId: actor.id }).then((result) => {
      if (active && scope.active(actor)) { setReports(result.reports); setTotal(result.total); }
    }).catch(() => {
      if (active && scope.active(actor)) { setReports([]); setTotal(0); setFailed(true); }
    }).finally(() => { if (active && scope.active(actor)) setLoading(false); });
    return () => { active = false; };
  }, [status, offset, refresh, scope.accountId]);
  function resolved(_updated: ContentReport, actor: AccountActor) {
    if (scope.active(actor)) setRefresh((value) => value + 1);
  }
  return <PageShell>
    <PageHeader title={t("safety.moderation")} actions={<button type="button" className={styles.button} disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{t("safety.refresh")}</button>} />
    <p>Review the reported content and choose an action. Removing catalog content or disabling sharing prevents the author from republishing it through the normal sharing controls.</p>
    <div className={styles.toolbar}>
      {(["pending", "resolved"] as const).map((value) => <button type="button" className={styles.button} key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setOffset(0); }}>{t(`safety.${value}`)}</button>)}
    </div>
    {failed ? <p role="alert" className={styles.error}>{t("safety.loadFailed")}</p> : null}
    {loading ? <p role="status">{t("common.loading")}</p> : reports.length === 0 && !failed ? <p>No {status} reports.</p> : null}
    {reports.map((report) => <ReportReview key={report.id} report={report} onResolved={resolved} />)}
    {total > 50 || offset > 0 ? <div className={styles.toolbar}>
      <button type="button" className={styles.button} disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Previous</button>
      <span>{offset + 1}–{Math.min(offset + 50, total)} / {total}</span>
      <button type="button" className={styles.button} disabled={loading || offset + 50 >= total} onClick={() => setOffset((value) => value + 50)}>Next</button>
    </div> : null}
  </PageShell>;
}

function ModerationWorkspace() {
  const t = useT();
  const [view, setView] = useState<"reports" | "photos">("reports");
  return <>
    <nav className={styles.queueTabs} aria-label="Review queues">
      <button type="button" className={styles.button} aria-pressed={view === "reports"} onClick={() => setView("reports")}>{t("safety.moderation")}</button>
      <button type="button" className={styles.button} aria-pressed={view === "photos"} onClick={() => setView("photos")}>{t("safety.mediaReviews")}</button>
    </nav>
    {view === "reports" ? <AdminReports /> : <MediaReviewQueue />}
  </>;
}

function ModerationGate() {
  const { user, loading } = useAuth();
  if (loading) return <PageShell><p role="status">Loading…</p></PageShell>;
  if (!isAdminUser(user)) return <PageShell><p role="alert">This page is available to the Chef World review team.</p></PageShell>;
  return <ModerationWorkspace key={user!.id} />;
}

export default function ModerationPage() {
  return <RequireAuth><ModerationGate /></RequireAuth>;
}
