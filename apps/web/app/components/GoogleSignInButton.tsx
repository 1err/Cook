"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { safeAuthRedirect } from "@cooking/shared";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import styles from "./GoogleSignInButton.module.css";

import { loadGoogleIdentity } from "./googleIdentitySdk";

export type GoogleSignInButtonProps = {
  /** Overrides the login action, for example when Google must verify account deletion. */
  onCredential?: (credential: string) => Promise<void>;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** Accessible name describing the purpose of the Google verification. */
  label?: string;
};

type PendingCredential = { value: string; isActive: () => boolean; signal: AbortSignal; resumed?: boolean };

function requiresGoogleRedirect(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

async function bridgeRequest(action: "prepare" | "resume" | "clear", signal?: AbortSignal, context?: object) {
  return fetch(`/api/auth/google/${action}`, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    ...(context ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(context) } : {}),
  });
}

function scrubReturnMarker() {
  const url = new URL(window.location.href);
  url.searchParams.delete("google_resume");
  url.searchParams.delete("google_error");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
type Phase = "hidden" | "loading" | "ready" | "error";

export function GoogleSignInButton({ onCredential, disabled = false, label, onBusyChange }: GoogleSignInButtonProps) {
  const router = useRouter();
  const { refreshUser, user } = useAuth();
  const { t, language } = useI18n();
  const passwordId = useId();
  const buttonRef = useRef<HTMLDivElement>(null);
  const disabledRef = useRef(disabled);
  const callbackRef = useRef(onCredential);
  const busyRef = useRef(false);
  const accountIdRef = useRef(user?.id);
  accountIdRef.current = user?.id;
  // Keep the return intent across locale reinitialization and StrictMode effect replay.
  const returnRef = useRef<{ resume: boolean; failed: boolean } | null>(null);
  const bridgeUsedRef = useRef(false);
  const clearBridgeRef = useRef<Promise<unknown>>(Promise.resolve());
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
  const [verifiedCredential, setVerifiedCredential] = useState<PendingCredential | null>(null);

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  function clearBridge() {
    // A previous clear must finish before a fresh context is prepared.
    const clearing = clearBridgeRef.current.then(() => bridgeRequest("clear")).catch(() => {});
    clearBridgeRef.current = clearing;
    return clearing;
  }

  function retry() {
    if (bridgeUsedRef.current) void clearBridge();
    returnRef.current = { resume: false, failed: false };
    setVerifiedCredential(null);
    setClientId(null);
    setPendingCredential(null);
    setPassword("");
    setError(null);
    setAttempt((previous) => previous + 1);
  }

  useEffect(() => {
    if (!returnRef.current) {
      const params = new URLSearchParams(window.location.search);
      returnRef.current = { resume: params.get("google_resume") === "1", failed: params.get("google_error") === "1" };
    }
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
    setVerifiedCredential(null);
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
          if (credential.resumed) await clearBridge();
          if (!credential.isActive()) return;
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
            setPhase("ready");
            return;
          }
          const detail = data.detail;
          const message = typeof detail === "string" ? detail : typeof detail?.message === "string" ? detail.message : actionsRef.current.t("auth.googleFailed");
          throw new Error(message);
        }
        const account = await response.json();
        if (!credential.isActive()) return;
        if (credential.resumed) await clearBridge();
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
        await clearBridgeRef.current;
        if (!active) return;
        if (returnRef.current?.failed) {
          bridgeUsedRef.current = true;
          scrubReturnMarker();
          void clearBridge();
          throw new Error(actionsRef.current.t("auth.googleFailed"));
        }
        if (returnRef.current?.resume) {
          bridgeUsedRef.current = true;
          const resumed = await bridgeRequest("resume", controller.signal);
          if (!active) return;
          if (!resumed.ok) throw new Error(actionsRef.current.t("auth.googleFailed"));
          const data = await resumed.json();
          if (!active) return;
          scrubReturnMarker();
          if (typeof data.credential !== "string" || !data.credential) throw new Error(actionsRef.current.t("auth.googleFailed"));
          const expectedId = data.expected_account_id;
          if (callbackRef.current && (typeof expectedId !== "string" || expectedId.toLowerCase() !== accountIdRef.current?.toLowerCase())) {
            void clearBridge();
            throw new Error(actionsRef.current.t("auth.googleAccountChanged"));
          }
          // A deletion credential cannot be repurposed as an ordinary login.
          if (!callbackRef.current && expectedId !== undefined) {
            void clearBridge();
            throw new Error(actionsRef.current.t("auth.googleFailed"));
          }
          const credential: PendingCredential = {
            value: data.credential, signal: controller.signal, resumed: true,
            isActive: () => isActive() && (expectedId === undefined || expectedId.toLowerCase() === accountIdRef.current?.toLowerCase()),
          };
          if (callbackRef.current) { setVerifiedCredential(credential); setPhase("ready"); }
          else await authenticate(credential);
          return;
        }
        const identity = await loadGoogleIdentity();
        if (!active) return;
        const redirect = requiresGoogleRedirect();
        if (redirect) {
          bridgeUsedRef.current = true;
          const returnPath = window.location.pathname;
          if (!["/login", "/register", "/settings"].includes(returnPath)) throw new Error("Invalid Google return page");
          const prepared = await bridgeRequest("prepare", controller.signal, {
            return_path: returnPath, redirect: safeAuthRedirect(new URLSearchParams(window.location.search).get("redirect")),
            ...(returnPath === "/settings" ? { expected_account_id: accountIdRef.current } : {}),
          });
          if (!active) return;
          if (!prepared.ok) throw new Error("Google redirect unavailable");
        }
        const response = await apiFetch("/auth/google/nonce", { method: "POST", signal: controller.signal });
        if (!response.ok) throw new Error("Google challenge unavailable");
        const data = await response.json();
        if (!active) return;
        if (typeof data.nonce !== "string" || !data.nonce || !buttonRef.current) throw new Error("Google challenge unavailable");
        buttonRef.current.replaceChildren();
        identity.initialize({
          client_id: clientId!, nonce: data.nonce, ux_mode: redirect ? "redirect" : "popup", auto_select: false,
          ...(redirect ? { login_uri: `${window.location.origin}/api/auth/google/callback` } : {}),
          use_fedcm_for_button: !redirect, button_auto_select: false,
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
      } catch (cause) {
        if (active) {
          if (returnRef.current?.resume || returnRef.current?.failed) {
            scrubReturnMarker();
            setError(cause instanceof Error ? cause.message : actionsRef.current.t("auth.googleFailed"));
          }
          setPhase("error");
        }
      }
    }
    void initialize();
    return () => { active = false; controller.abort(); };
  }, [clientId, language, attempt]);

  if (phase === "hidden") return null;
  return (
    <div className={styles.root}>
      <div className={styles.controls} role="group" aria-label={label || t("auth.googleContinue")} aria-busy={busy}>
        <div ref={buttonRef} className={styles.button} hidden={phase !== "ready" || pendingCredential !== null || verifiedCredential !== null} inert={disabled || busy} style={{ opacity: disabled || busy ? 0.55 : 1 }} />
        {phase === "loading" && <p className={styles.status} role="status">{t("auth.googleLoading")}</p>}
        {busy && <p className={styles.status} role="status">{t("auth.googleVerifying")}</p>}
        {verifiedCredential && (
          <div className={styles.linkForm}>
            <p className={styles.explanation} role="status">{t("auth.googleVerificationReady")}</p>
            <button className="btn-primary" type="button" disabled={disabled || busy} onClick={() => void authenticateRef.current(verifiedCredential)}>{t("auth.googleContinueVerified")}</button>
            <button className={styles.retry} type="button" disabled={disabled || busy} onClick={retry}>{t("auth.googleChooseAnother")}</button>
          </div>
        )}
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
