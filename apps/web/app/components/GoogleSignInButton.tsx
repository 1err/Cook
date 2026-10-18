"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { safeAuthRedirect } from "@cooking/shared";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import styles from "./GoogleSignInButton.module.css";

type CredentialResponse = { credential: string };
type GoogleIdentity = {
  initialize: (options: {
    client_id: string;
    nonce: string;
    callback: (response: CredentialResponse) => void;
    ux_mode: "popup";
    auto_select: false;
    use_fedcm_for_button: true;
    button_auto_select: false;
  }) => void;
  renderButton: (parent: HTMLElement, options: {
    type: "standard";
    theme: "outline";
    size: "large";
    text: "continue_with";
    shape: "pill";
    locale: string;
    width: number;
  }) => void;
};
type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleIdentity } } };
const GOOGLE_SCRIPT_URL = "https://accounts.google.com/gsi/client";
let sdkLoading: Promise<GoogleIdentity> | null = null;

function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const identity = (window as GoogleWindow).google?.accounts?.id;
  if (identity) return Promise.resolve(identity);
  if (sdkLoading) return sdkLoading;
  sdkLoading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    const timeout = window.setTimeout(() => fail(), 15000);
    function fail() {
      window.clearTimeout(timeout);
      script.remove();
      sdkLoading = null;
      reject(new Error("Google Identity Services could not load"));
    }
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timeout);
      const loaded = (window as GoogleWindow).google?.accounts?.id;
      if (!loaded) { fail(); return; }
      resolve(loaded);
    };
    document.head.appendChild(script);
  });
  return sdkLoading;
}

export type GoogleSignInButtonProps = {
  /** Overrides the login action, for example when Google must verify account deletion. */
  onCredential?: (credential: string) => Promise<void>;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** Accessible name describing the purpose of the Google verification. */
  label?: string;
};

type PendingCredential = { value: string; isActive: () => boolean; signal: AbortSignal };
type Phase = "hidden" | "loading" | "ready" | "error";

export function GoogleSignInButton({ onCredential, disabled = false, label, onBusyChange }: GoogleSignInButtonProps) {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const { t, language } = useI18n();
  const passwordId = useId();
  const buttonRef = useRef<HTMLDivElement>(null);
  const disabledRef = useRef(disabled);
  const callbackRef = useRef(onCredential);
  const busyRef = useRef(false);
  const actionsRef = useRef({ router, refreshUser, t });
  actionsRef.current = { router, refreshUser, t };
  const authenticateRef = useRef<(credential: PendingCredential, accountPassword?: string) => Promise<void>>(async () => {});
  disabledRef.current = disabled;
  callbackRef.current = onCredential;
  const [clientId, setClientId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("hidden");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCredential, setPendingCredential] = useState<PendingCredential | null>(null);
  const [password, setPassword] = useState("");

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  function retry() {
    setClientId(null);
    setPendingCredential(null);
    setPassword("");
    setError(null);
    setAttempt((previous) => previous + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setClientId(null);
    setPhase("hidden");
    async function configure() {
      try {
        const response = await apiFetch("/auth/google/config", { signal: controller.signal });
        if (!response.ok) throw new Error("Google configuration unavailable");
        const data = await response.json();
        if (!active) return;
        if (typeof data.client_id !== "string" || !data.client_id) return;
        setClientId(data.client_id);
        setPhase("loading");
      } catch {
        if (active) setPhase("error");
      }
    }
    void configure();
    return () => { active = false; controller.abort(); };
  }, [attempt]);

  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();
    let active = true;
    let credentialReceived = false;
    busyRef.current = false;
    setBusy(false);
    setPendingCredential(null);
    setPassword("");
    setError(null);
    setPhase("loading");
    const isActive = () => active && !disabledRef.current;

    async function authenticate(credential: PendingCredential, accountPassword?: string) {
      if (!credential.isActive() || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const credentialHandler = callbackRef.current;
      try {
        if (credentialHandler) {
          await credentialHandler(credential.value);
          if (active) retry();
          return;
        }
        const response = await apiFetch("/auth/google", {
          method: "POST",
          body: JSON.stringify({ credential: credential.value, ...(accountPassword !== undefined ? { password: accountPassword } : {}) }),
          signal: credential.signal,
        });
        if (!credential.isActive()) return;
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (!credential.isActive()) return;
          if (response.status === 409 && data.detail?.code === "google_password_required") {
            setPendingCredential(credential);
            return;
          }
          const detail = data.detail;
          const message = typeof detail === "string" ? detail : typeof detail?.message === "string" ? detail.message : actionsRef.current.t("auth.googleFailed");
          throw new Error(message);
        }
        const account = await response.json();
        if (!credential.isActive()) return;
        await actionsRef.current.refreshUser({ newSession: true });
        if (!credential.isActive()) return;
        const params = new URLSearchParams(window.location.search);
        const destination = safeAuthRedirect(params.get("redirect"));
        actionsRef.current.router.push(account.email_verification_required && !account.email_verified
          ? `/check-email?redirect=${encodeURIComponent(destination)}` : destination);
      } catch (cause) {
        if (!active || (!credentialHandler && disabledRef.current)) return;
        setError(cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : actionsRef.current.t("auth.googleFailed"));
        if (accountPassword === undefined) setPhase("error");
      } finally {
        busyRef.current = false;
        if (active) setBusy(false);
      }
    }
    authenticateRef.current = authenticate;

    async function initialize() {
      try {
        const identity = await loadGoogleIdentity();
        if (!active) return;
        const response = await apiFetch("/auth/google/nonce", { method: "POST", signal: controller.signal });
        if (!response.ok) throw new Error("Google challenge unavailable");
        const data = await response.json();
        if (!active) return;
        if (typeof data.nonce !== "string" || !data.nonce || !buttonRef.current) throw new Error("Google challenge unavailable");
        buttonRef.current.replaceChildren();
        identity.initialize({
          client_id: clientId!, nonce: data.nonce, ux_mode: "popup", auto_select: false,
          use_fedcm_for_button: true, button_auto_select: false,
          callback: ({ credential }) => {
            if (!isActive() || credentialReceived || !credential) return;
            credentialReceived = true;
            void authenticate({ value: credential, isActive, signal: controller.signal });
          },
        });
        identity.renderButton(buttonRef.current, {
          type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill",
          locale: language === "zh" ? "zh-CN" : "en", width: Math.min(400, Math.max(200, buttonRef.current.parentElement?.clientWidth || 320)),
        });
        setPhase("ready");
      } catch {
        if (active) setPhase("error");
      }
    }
    void initialize();
    return () => { active = false; controller.abort(); };
  }, [clientId, language, attempt]);

  if (phase === "hidden") return null;
  return (
    <div className={styles.root}>
      <div className={styles.controls} role="group" aria-label={label || t("auth.googleContinue")} aria-busy={busy}>
        <div ref={buttonRef} className={styles.button} hidden={phase !== "ready" || pendingCredential !== null} inert={disabled || busy} style={{ opacity: disabled || busy ? 0.55 : 1 }} />
        {phase === "loading" && <p className={styles.status} role="status">{t("auth.googleLoading")}</p>}
        {busy && <p className={styles.status} role="status">{t("auth.googleVerifying")}</p>}
        {pendingCredential && (
          <form className={styles.linkForm} onSubmit={(event) => { event.preventDefault(); const submittedPassword = password; setPassword(""); void authenticateRef.current(pendingCredential, submittedPassword); }}>
            <p className={styles.explanation}>{t("auth.googlePasswordRequired")}</p>
            <label htmlFor={passwordId} className={styles.passwordLabel}>{t("auth.googlePasswordLabel")}</label>
            <input id={passwordId} className="input-editorial" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={disabled || busy} />
            <button className="btn-primary" type="submit" disabled={disabled || busy}>{t("auth.googleLinkAndSignIn")}</button>
            <button className={styles.retry} type="button" onClick={retry} disabled={disabled || busy}>{t("auth.googleChooseAnother")}</button>
          </form>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {phase === "error" && (
          <div className={styles.recovery}>
            {!error && <span>{t("auth.googleUnavailable")}</span>}
            <button className={styles.retry} type="button" onClick={retry} disabled={disabled || busy}>{t("auth.googleRetry")}</button>
          </div>
        )}
      </div>
      {clientId && !onCredential && <div className={styles.divider}><span>{t("auth.googleOrEmail")}</span></div>}
    </div>
  );
}
