"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { webApiClient } from "../lib/api";
import { Button } from "./ui/Button";
import { useT } from "../lib/i18n";

export function AccountRecoveryForm({ mode }: { mode: "request" | "reset" | "verify" }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captured = useRef(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mode !== "request") {
      if (!captured.current) {
        captured.current = true;
        const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
        setToken(value && value.length <= 512 ? value : null);
      }
      setReady(true);
      return;
    }
    let active = true;
    setReady(false);
    setError(null);
    void webApiClient.auth.capabilities().then((capabilities) => {
      if (!active) return;
      setAvailable(capabilities.password_recovery);
      if (!capabilities.password_recovery) setError(t("account.emailUnavailable"));
    }).catch(() => {
      if (!active) return;
      setAvailable(false);
      setError(t("account.tryAgain"));
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [mode, attempt, t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (mode === "reset" && password !== confirmation) {
      setError(t("account.passwordMismatch"));
      return;
    }
    if (mode === "reset" && (Array.from(password).length < 8 || new TextEncoder().encode(password).length > 72)) {
      setError(t("account.passwordLength"));
      return;
    }
    setPending(true);
    try {
      if (mode === "request") await webApiClient.auth.requestPasswordReset(email.trim());
      else if (mode === "reset" && token) await webApiClient.auth.confirmPasswordReset(token, password);
      else if (mode === "verify" && token) await webApiClient.auth.confirmEmailVerification(token);
      else { setError(t("account.linkInvalid")); return; }
      setSuccess(true);
      setToken(null);
      setPassword("");
      setConfirmation("");
    } catch (caught) {
      const status = (caught as { status?: number } | null)?.status;
      setError(t(status === 429 ? "account.tooManyRequests" : status === 503 ? "account.emailUnavailable"
        : status === 400 && mode !== "request" ? "account.linkInvalid" : "account.tryAgain"));
    } finally { setPending(false); }
  }

  if (!ready) return <p role="status">{t("common.loading")}</p>;
  if (success) return <p role="status">{t(mode === "request" ? "account.resetSent" : mode === "reset" ? "account.resetComplete" : "account.verificationComplete")}</p>;
  if (mode !== "request" && !token) return <p role="alert">{t("account.linkInvalid")}</p>;
  if (!available) return <div><p role="alert">{error}</p><Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>{t("account.retry")}</Button></div>;

  return <form onSubmit={submit} style={{ display: "grid", gap: "1rem" }}>
    <p>{t(mode === "request" ? "account.resetHelp" : mode === "reset" ? "account.passwordHelp" : "account.verifyHelp")}</p>
    {mode === "request" ? <label>{t("common.email")}<input className="input-editorial" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label> : null}
    {mode === "reset" ? <>
      <label>{t("account.newPassword")}<input className="input-editorial" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>{t("account.confirmPassword")}<input className="input-editorial" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    <Button type="submit" disabled={pending}>{t(pending ? "common.saving" : mode === "request" ? "account.sendReset" : mode === "reset" ? "account.setPassword" : "account.verifyEmail")}</Button>
    {mode === "verify" ? <Link href="/settings">{t("account.settings")}</Link> : null}
  </form>;
}
