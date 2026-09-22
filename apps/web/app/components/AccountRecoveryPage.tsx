"use client";

import Link from "next/link";
import { BETA_FEEDBACK_URL } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { AccountRecoveryForm } from "./AccountRecoveryForm";

export function AccountRecoveryPage({ mode }: { mode: "request" | "reset" | "verify" }) {
  const t = useT();
  return <main style={{ maxWidth: "30rem", padding: "3rem 1.25rem", margin: "0 auto" }}>
    <p>Chef World</p>
    <h1>{t(mode === "request" ? "account.forgotPassword" : mode === "reset" ? "account.setPassword" : "account.verifyEmail")}</h1>
    <AccountRecoveryForm mode={mode} />
    {mode === "reset" ? <p><Link href="/forgot-password">{t("account.requestNewLink")}</Link></p> : null}
    <p><a href={BETA_FEEDBACK_URL}>{t("account.support")}</a></p>
    <p><Link href="/login">{t("nav.signIn")}</Link></p>
  </main>;
}
