"use client";

import { useState } from "react";
import { PageHeader, PageShell } from "../components/PageShell";
import { RequireAuth } from "../components/RequireAuth";
import { useAuth } from "../lib/auth";
import { useEditorialCopy } from "../lib/editorialCopy";
import { useT } from "../lib/i18n";
import styles from "./Settings.module.css";
import { AccountSecurity } from "./AccountSecurity";

function SettingsPageContent() {
  const { user, setLibraryVisibility } = useAuth();
  const editorialCopy = useEditorialCopy();
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggle(next: boolean) {
    if (pending || !user) return;
    setPending(true);
    setError(null);
    try {
      await setLibraryVisibility(next);
    } catch (caught) {
      setError(t("settings.updateError"));
    } finally {
      setPending(false);
    }
  }

  if (!user) return null;

  return (
    <PageShell>
      <PageHeader title={t("nav.settings")} description={editorialCopy["settings.tagline"]} />
      {!(user.email_verification_required && !user.email_verified) ? <section className={styles.section}>
        <div className={styles.copy}>
          <h2>{t("settings.shareLibrary")}</h2>
          <p>{t("settings.shareConsequence")}</p>
        </div>

        <label className={styles.switch}>
          <input
            type="checkbox"
            aria-label={t("settings.shareLibrary")}
            checked={user.is_library_public}
            onChange={(event) => void onToggle(event.target.checked)}
            disabled={pending}
          />
          <span className={styles.track} aria-hidden><span /></span>
          <span className={styles.state}>{pending ? t("common.saving") : t(user.is_library_public ? "settings.on" : "settings.off")}</span>
        </label>
      </section> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <AccountSecurity />
    </PageShell>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <RequireAuth allowUnverified>
      <SettingsPageContent key={user?.id ?? "signed-out"} />
    </RequireAuth>
  );
}
