"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { safeAuthRedirect } from "@cooking/shared";
import { AuthShell } from "../components/AuthShell";
import { RequireAuth } from "../components/RequireAuth";
import { Button } from "../components/ui/Button";
import { useAuth } from "../lib/auth";
import { webApiClient } from "../lib/api";
import { useT } from "../lib/i18n";
import styles from "../components/AccountRecovery.module.css";

function CheckEmailContent() {
  const { user, refreshUser, logout } = useAuth();
  const router = useRouter();
  const t = useT();
  const [pending, setPending] = useState<"send" | "check" | "logout" | null>(null);
  const [notice, setNotice] = useState<"sent" | "waiting" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (user && (!user.email_verification_required || user.email_verified)) {
      const destination = safeAuthRedirect(new URLSearchParams(window.location.search).get("redirect"));
      // An onboarding URL can be supplied as an old login redirect; never loop.
      const destinationPath = new URL(destination, window.location.origin).pathname.replace(/\/$/, "");
      router.replace(destinationPath === "/check-email" ? "/library" : destination);
    }
  }, [user, router]);

  useEffect(() => {
    const onFocus = () => { if (!busy.current) void refreshUser().catch(() => {}); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshUser]);

  async function run(action: "send" | "check" | "logout") {
    if (busy.current) return;
    busy.current = true;
    setPending(action); setError(null); setNotice(null);
    try {
      if (action === "send") await webApiClient.auth.requestEmailVerification();
      else if (action === "check") await refreshUser();
      else await logout();
      if (active.current && action !== "logout") setNotice(action === "send" ? "sent" : "waiting");
    } catch (caught) {
      const status = (caught as { status?: number } | null)?.status;
      if (active.current) setError(t(status === 429 ? "account.tooManyRequests" : status === 503 ? "account.emailUnavailable" : "account.tryAgain"));
    } finally {
      busy.current = false;
      if (active.current) setPending(null);
    }
  }

  if (!user || !user.email_verification_required || user.email_verified) return null;
  return <div className={styles.page}><AuthShell title={t("account.checkInbox")} subtitle="" eyebrow=""
    footer={<div className={styles.footer}>
      <Link href="/settings">{t("account.settings")}</Link>
      <Button variant="ghost" disabled={pending !== null} loading={pending === "logout"} onClick={() => void run("logout")}>{t("account.differentEmail")}</Button>
    </div>}>
    <div className={styles.form}>
      <p className={styles.copy} style={{ overflowWrap: "anywhere" }}>{t("account.checkInboxHelp", { email: user.email })}</p>
      <p className={styles.copy}>{t("account.checkInboxTips")}</p>
      <Button disabled={pending !== null} loading={pending === "check"} onClick={() => void run("check")}>{t("account.finishVerification")}</Button>
      <Button variant="secondary" disabled={pending !== null} loading={pending === "send"} onClick={() => void run("send")}>{t("account.resendVerification")}</Button>
      {notice ? <p className={styles.copy} role="status">{t(notice === "sent" ? "account.verificationSent" : "account.verificationWaiting")}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  </AuthShell></div>;
}

export default function CheckEmailPage() {
  return <RequireAuth allowUnverified><CheckEmailContent /></RequireAuth>;
}
