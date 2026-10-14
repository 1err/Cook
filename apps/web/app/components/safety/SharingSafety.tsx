"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ContentReportReason } from "@cooking/api-client";
import { webApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import styles from "./SharingSafety.module.css";
import { useAccountScope, type AccountActor } from "./useAccountScope";

const REASONS: ContentReportReason[] = ["objectionable", "harassment", "privacy", "spam", "other"];

export function SharedPhotoStatus({ status }: { status?: "none" | "pending" | "approved" | "rejected" }) {
  const t = useT();
  return status === "pending" || status === "rejected"
    ? <p className={styles.notice}>{t(status === "pending" ? "safety.photosPending" : "safety.photosRejected")}</p>
    : null;
}

export function ReportRecipeControl(props: { recipeId: string; recipeTitle?: string }) {
  const scope = useAccountScope();
  return <AccountReportRecipeControl key={scope.accountId} {...props} />;
}

function AccountReportRecipeControl({ recipeId, recipeTitle }: { recipeId: string; recipeTitle?: string }) {
  const t = useT();
  const scope = useAccountScope();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ContentReportReason>("objectionable");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef<object | null>(null);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => { setOpen(false); setNotes(""); setSent(false); setFailed(false); setBusy(false); busyRef.current = null; }, [scope.accountId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const actor = scope.capture();
    if (!actor || busyRef.current || sent) return;
    const operation = {};
    busyRef.current = operation;
    setBusy(true);
    setFailed(false);
    try {
      await webApiClient.users.reportRecipe(recipeId, reason, notes.trim() || undefined, actor.id);
      if (!scope.active(actor)) return;
      setSent(true);
      setOpen(false);
    } catch {
      if (scope.active(actor)) setFailed(true);
    } finally {
      if (busyRef.current === operation) { busyRef.current = null; setBusy(false); }
    }
  }

  return (
    <div className={styles.control}>
      <button type="button" className={styles.quietButton} onClick={() => setOpen((value) => !value)} disabled={busy || sent || !scope.accountId} aria-expanded={open} aria-controls={id} aria-label={recipeTitle ? `${t("safety.report")}: ${recipeTitle}` : undefined}>
        {t(sent ? "safety.reportSent" : "safety.report")}
      </button>
      {sent ? <p className={styles.notice} role="status">{t("safety.reportSent")}. {t("safety.reportSentBody")}</p> : null}
      {open ? (
        <form id={id} className={styles.form} onSubmit={(event) => void submit(event)}>
          <p>{t("safety.reportBody")}</p>
          <label htmlFor={`${id}-reason`}>{t("safety.reasonLabel")}</label>
          <select id={`${id}-reason`} value={reason} onChange={(event) => setReason(event.target.value as ContentReportReason)} disabled={busy}>
            {REASONS.map((value) => <option key={value} value={value}>{t(`safety.reason.${value}`)}</option>)}
          </select>
          <label htmlFor={`${id}-notes`}>{t("safety.notes")}</label>
          <textarea id={`${id}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={3} disabled={busy} />
          {failed ? <p role="alert" className={styles.error}>{t("safety.failed")}</p> : null}
          <div className={styles.buttons}>
            <button type="submit" className="btn-primary" disabled={busy}>{t(busy ? "common.saving" : "safety.submit")}</button>
            <button type="button" className={styles.quietButton} onClick={() => setOpen(false)} disabled={busy}>{t("common.cancel")}</button>
          </div>
          <a href="https://chef-world.com/contact" target="_blank" rel="noopener noreferrer">chef-world.com/contact</a>
        </form>
      ) : null}
    </div>
  );
}

export function BlockUserButton({ userId, recipeId, onBlocked }: {
  userId?: string; recipeId?: string; onBlocked: (actor: AccountActor) => void | Promise<void>;
}) {
  const t = useT();
  const scope = useAccountScope();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef<object | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setBusy(false); setFailed(false); busyRef.current = null; }, [scope.accountId]);
  async function block() {
    const actor = scope.capture();
    if (!actor || busyRef.current || (!userId && !recipeId)) return;
    if (!window.confirm(`${t("safety.blockTitle")}\n\n${t("safety.blockBody")}`)) return;
    const operation = {};
    busyRef.current = operation;
    setBusy(true);
    setFailed(false);
    try {
      if (userId) await webApiClient.users.blockUser(userId, actor.id);
      else await webApiClient.users.blockRecipeAuthor(recipeId!, actor.id);
      // The row can disappear during a filter change; its surviving parent owns the UI update.
      if (scope.isCurrent(actor)) await onBlocked(actor);
    } catch {
      if (scope.active(actor)) setFailed(true);
    } finally {
      if (busyRef.current === operation) { busyRef.current = null; if (scope.active(actor)) setBusy(false); }
    }
  }
  return <div className={styles.control}>
    <button type="button" className={styles.quietButton} disabled={busy || !scope.accountId} onClick={() => void block()}>{t(busy ? "common.saving" : userId ? "safety.block" : "safety.blockAuthor")}</button>
    {failed ? <p role="alert" className={styles.error}>{t("safety.failed")}</p> : null}
  </div>;
}
