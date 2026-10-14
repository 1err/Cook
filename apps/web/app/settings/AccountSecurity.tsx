"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BETA_FEEDBACK_URL, PRIVACY_URL } from "@cooking/shared";
import { useAuth } from "../lib/auth";
import { webApiClient } from "../lib/api";
import { Button } from "../components/ui/Button";
import { useT } from "../lib/i18n";
import { useAccountScope } from "../lib/useAccountScope";
import styles from "./Settings.module.css";

function AccountSecurityContent() {
  const { user, deleteAccount, logoutAll, refreshUser } = useAuth();
  const router = useRouter();
  const query = useSearchParams().toString();
  const t = useT();
  const scope = useAccountScope();
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationAction, setVerificationAction] = useState<"send" | "check" | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<"sent" | "checked" | null>(null);
  const [linkRequested, setLinkRequested] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const deletionFormRef = useRef<HTMLFormElement>(null);
  const restoreDeletionFocus = useRef(false);
  const active = useRef(true);
  const capabilityGeneration = useRef(0);
  const refreshEmailAvailability = useCallback(async () => {
    const generation = ++capabilityGeneration.current;
    try {
      const value = await webApiClient.auth.capabilities();
      if (active.current && generation === capabilityGeneration.current) setEmailAvailable(value.email_verification);
    } catch {
      if (active.current && generation === capabilityGeneration.current) setEmailAvailable((previous) => previous ?? false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void refreshEmailAvailability();
    return () => { active.current = false; };
  }, [refreshEmailAvailability]);

  useEffect(() => {
    const parameters = new URLSearchParams(query);
    if (parameters.get("delete") !== "1" || !user?.id) return;
    setDeleting(true); setPassword(""); setConfirmed(false); setError(null);
    deletionFormRef.current?.focus();
    // Consume the opening request so Cancel/revisiting Settings cannot reopen it.
    parameters.delete("delete");
    const remaining = parameters.toString();
    router.replace(`/settings${remaining ? `?${remaining}` : ""}`, { scroll: false });
  }, [query, router, user?.id]);

  useEffect(() => {
    if (deleting) deletionFormRef.current?.focus();
    else if (restoreDeletionFocus.current) {
      restoreDeletionFocus.current = false;
      sectionRef.current?.querySelector<HTMLButtonElement>("#delete-account-trigger")?.focus();
    }
  }, [deleting]);

  async function run(action: () => Promise<unknown>) {
    const actor = scope.capture();
    if (pending || !actor) return;
    setPending(true); setError(null);
    try {
      await action();
    } catch (caught) {
      if (!scope.active(actor)) return;
      const status = (caught as { status?: number } | null)?.status;
      setError(t(status === 403 ? "account.passwordIncorrect" : status === 429 ? "account.tooManyRequests"
        : status === 503 ? "account.emailUnavailable" : "account.tryAgain"));
    } finally { if (scope.active(actor)) setPending(false); }
  }

  async function runVerification(action: "send" | "check") {
    const actor = scope.capture();
    if (pending || !actor) return;
    setPending(true); setVerificationAction(action); setVerificationError(null); setVerificationNotice(null);
    try {
      if (action === "send") {
        await webApiClient.auth.requestEmailVerification(actor.id);
        if (scope.active(actor)) { setLinkRequested(true); setVerificationNotice("sent"); }
      } else {
        // Email delivery availability must not delay or block refreshing account status.
        void refreshEmailAvailability();
        await refreshUser();
        if (scope.active(actor)) setVerificationNotice("checked");
      }
    } catch (caught) {
      if (!scope.active(actor)) return;
      const status = (caught as { status?: number } | null)?.status;
      setVerificationError(t(status === 429 ? "account.tooManyRequests" : status === 503 ? "account.emailUnavailable" : "account.tryAgain"));
    } finally {
      if (scope.active(actor)) { setPending(false); setVerificationAction(null); }
    }
  }

  function submitDeletion(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || !password) return;
    void run(() => deleteAccount(password));
  }

  if (!user) return null;
  return <section ref={sectionRef} className={`${styles.section} ${styles.account}`} aria-labelledby="account-security-title">
    <div className={styles.copy}>
      <h2 id="account-security-title">{t("account.settings")}</h2>
      <p className={styles.accountEmail}>{user.email}</p>
    </div>
    <section className={styles.verification} aria-labelledby="email-verification-title">
      <div className={styles.verificationHeader}>
        <h3 id="email-verification-title">{t("account.verificationTitle")}</h3>
        <span className={`${styles.verificationBadge} ${user.email_verified ? styles.verifiedBadge : styles.unverifiedBadge}`}>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="10" cy="10" r="7.5" />
            {user.email_verified ? <path d="m6.5 10 2.3 2.3 4.7-4.7" /> : <path d="M10 5.8v5M10 13.3v.9" />}
          </svg>
          {t(user.email_verified ? "account.verified" : "account.notVerified")}
        </span>
      </div>
      {!user.email_verified ? <>
        <p className={styles.verificationHelp}>{t("account.verificationHelp")}</p>
        {emailAvailable === false ? <p className={styles.verificationHelp}>{t("account.emailUnavailable")}</p> : null}
        <div className={`${styles.actions} ${styles.verificationActions}`}>
          <Button variant="secondary" loading={verificationAction === "send"} disabled={pending || emailAvailable !== true} onClick={() => void runVerification("send")}>{t(linkRequested ? "account.resendVerification" : "account.verifyEmail")}</Button>
          <Button variant="ghost" loading={verificationAction === "check"} disabled={pending} onClick={() => void runVerification("check")}>{t("account.checkVerification")}</Button>
        </div>
      </> : null}
      {verificationError ? <p className={styles.verificationError} role="alert">{verificationError}</p> : null}
      {verificationNotice ? <p className={styles.verificationNotice} role="status">{t(verificationNotice === "sent" ? "account.verificationSent" : "account.verificationChecked")}</p> : null}
    </section>
    <p>{t("account.logoutAllHelp")}</p>
    <Button variant="secondary" disabled={pending} onClick={() => void run(logoutAll)}>{t("account.logoutAll")}</Button>
    {deleting ? <form ref={deletionFormRef} id="delete-account" tabIndex={-1} aria-labelledby="delete-account-title" aria-describedby="delete-account-help" onSubmit={submitDeletion} className={styles.deletion} style={{ scrollMarginTop: "6rem" }}>
      <h3 id="delete-account-title">{t("account.deleteTitle")}</h3>
      <p id="delete-account-help">{t("account.deleteHelp")}</p>
      <label>{t("account.currentPassword")}<input className="input-editorial" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t("account.deleteConfirm")}</label>
      <div className={styles.actions}>
        <Button variant="secondary" type="submit" disabled={pending || !confirmed || !password}>{t("account.deletePermanently")}</Button>
        <Button variant="secondary" type="button" disabled={pending} onClick={() => { restoreDeletionFocus.current = true; setDeleting(false); setPassword(""); setConfirmed(false); setError(null); }}>{t("common.cancel")}</Button>
      </div>
    </form> : <Button id="delete-account-trigger" variant="secondary" disabled={pending} onClick={() => setDeleting(true)}>{t("account.deleteTitle")}</Button>}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.actions}>
      <a href={BETA_FEEDBACK_URL}>{t("account.support")}</a>
      <a href={PRIVACY_URL}>{t("account.privacy")}</a>
    </div>
  </section>;
}

export function AccountSecurity() {
  const { user } = useAuth();
  return <Suspense fallback={null}><AccountSecurityContent key={user?.id ?? "signed-out"} /></Suspense>;
}
