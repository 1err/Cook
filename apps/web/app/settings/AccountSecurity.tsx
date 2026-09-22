"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
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
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void webApiClient.auth.capabilities().then((value) => {
      if (active.current) setEmailAvailable(value.email_verification);
    }).catch(() => { if (active.current) setEmailAvailable(false); });
    return () => { active.current = false; };
  }, []);

  async function run(action: () => Promise<unknown>, successMessage?: string) {
    if (pending) return;
    setPending(true); setError(null); setNotice(null);
    try {
      await action();
      if (active.current && successMessage) setNotice(successMessage);
    } catch (caught) {
      if (!active.current) return;
      const status = (caught as { status?: number } | null)?.status;
      setError(t(status === 403 ? "account.passwordIncorrect" : status === 429 ? "account.tooManyRequests"
        : status === 503 ? "account.emailUnavailable" : "account.tryAgain"));
    } finally { if (active.current) setPending(false); }
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
      <p>{user.email}</p>
      <p>{t(user.email_verified ? "account.verified" : "account.notVerified")}</p>
    </div>
    {!user.email_verified ? <>
      {emailAvailable === false ? <p>{t("account.emailUnavailable")}</p> : null}
      <div className={styles.actions}>
        <Button variant="secondary" disabled={pending || emailAvailable !== true} onClick={() => void run(() => webApiClient.auth.requestEmailVerification(), t("account.verificationSent"))}>{t("account.verifyEmail")}</Button>
        <Button variant="secondary" disabled={pending} onClick={() => void run(async () => {
          const capabilities = await webApiClient.auth.capabilities();
          if (active.current) setEmailAvailable(capabilities.email_verification);
          await refreshUser();
        })}>{t("account.checkVerification")}</Button>
      </div>
    </> : null}
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
    {notice ? <p role="status">{notice}</p> : null}
    <div className={styles.actions}>
      <a href={BETA_FEEDBACK_URL}>{t("account.support")}</a>
      <a href={PRIVACY_URL}>{t("account.privacy")}</a>
    </div>
  </section>;
}
