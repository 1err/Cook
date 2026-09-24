"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BETA_FEEDBACK_URL, PRIVACY_URL } from "@cooking/shared";
import { useAuth } from "../lib/auth";
import { webApiClient } from "../lib/api";
import { Button } from "../components/ui/Button";
import { useT } from "../lib/i18n";
import styles from "./Settings.module.css";

export function AccountSecurity() {
  const { user, deleteAccount, logoutAll, refreshUser } = useAuth();
  const t = useT();
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

  async function run(action: () => Promise<unknown>) {
    if (pending) return;
    setPending(true); setError(null);
    try {
      await action();
    } catch (caught) {
      if (!active.current) return;
      const status = (caught as { status?: number } | null)?.status;
      setError(t(status === 403 ? "account.passwordIncorrect" : status === 429 ? "account.tooManyRequests"
        : status === 503 ? "account.emailUnavailable" : "account.tryAgain"));
    } finally { if (active.current) setPending(false); }
  }

  async function runVerification(action: "send" | "check") {
    if (pending) return;
    setPending(true); setVerificationAction(action); setVerificationError(null); setVerificationNotice(null);
    try {
      if (action === "send") {
        await webApiClient.auth.requestEmailVerification();
        if (active.current) { setLinkRequested(true); setVerificationNotice("sent"); }
      } else {
        // Email delivery availability must not delay or block refreshing account status.
        void refreshEmailAvailability();
        await refreshUser();
        if (active.current) setVerificationNotice("checked");
      }
    } catch (caught) {
      if (!active.current) return;
      const status = (caught as { status?: number } | null)?.status;
      setVerificationError(t(status === 429 ? "account.tooManyRequests" : status === 503 ? "account.emailUnavailable" : "account.tryAgain"));
    } finally {
      if (active.current) { setPending(false); setVerificationAction(null); }
    }
  }

  function submitDeletion(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || !password) return;
    void run(() => deleteAccount(password));
  }

  if (!user) return null;
  return <section className={`${styles.section} ${styles.account}`} aria-labelledby="account-security-title">
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
    {deleting ? <form onSubmit={submitDeletion} className={styles.deletion}>
      <h3>{t("account.deleteTitle")}</h3>
      <p>{t("account.deleteHelp")}</p>
      <label>{t("account.currentPassword")}<input className="input-editorial" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t("account.deleteConfirm")}</label>
      <div className={styles.actions}>
        <Button variant="secondary" type="submit" disabled={pending || !confirmed || !password}>{t("account.deletePermanently")}</Button>
        <Button variant="secondary" type="button" disabled={pending} onClick={() => { setDeleting(false); setPassword(""); setConfirmed(false); setError(null); }}>{t("common.cancel")}</Button>
      </div>
    </form> : <Button variant="secondary" disabled={pending} onClick={() => setDeleting(true)}>{t("account.deleteTitle")}</Button>}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.actions}>
      <a href={BETA_FEEDBACK_URL}>{t("account.support")}</a>
      <a href={PRIVACY_URL}>{t("account.privacy")}</a>
    </div>
  </section>;
}
