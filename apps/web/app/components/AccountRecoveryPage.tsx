"use client";

import Link from "next/link";
import { BETA_FEEDBACK_URL } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { AccountRecoveryForm } from "./AccountRecoveryForm";
import { AuthShell } from "./AuthShell";
import styles from "./AccountRecovery.module.css";

export function AccountRecoveryPage({ mode }: { mode: "request" | "reset" | "verify" }) {
  const t = useT();
  return <div className={styles.page}><AuthShell
    title={t(mode === "request" ? "account.forgotPassword" : mode === "reset" ? "account.setPassword" : "account.verifyEmail")}
    subtitle="" eyebrow=""
    footer={<div className={styles.footer}>
      <Link href="/login">{t("account.backToSignIn")}</Link>
      <a href={BETA_FEEDBACK_URL}>{t("account.support")}</a>
    </div>}
  >
    <AccountRecoveryForm mode={mode} />
  </AuthShell></div>;
}
