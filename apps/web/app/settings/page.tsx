"use client";

import { useState } from "react";
import { PageHeader, PageShell } from "../components/PageShell";
import { RequireAuth } from "../components/RequireAuth";
import { useAuth } from "../lib/auth";
import styles from "./Settings.module.css";

function SettingsPageContent() {
  const { user, setLibraryVisibility } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggle(next: boolean) {
    if (pending || !user) return;
    setPending(true);
    setError(null);
    try {
      await setLibraryVisibility(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't update — please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!user) return null;

  return (
    <PageShell>
      <PageHeader title="Settings" />
      <section className={styles.section}>
        <div className={styles.copy}>
          <h2>Share my library</h2>
          <p>Anyone who knows your email can browse and copy your recipes.</p>
        </div>

        <label className={styles.switch}>
          <input
            type="checkbox"
            aria-label="Share my library"
            checked={user.is_library_public}
            onChange={(event) => void onToggle(event.target.checked)}
            disabled={pending}
          />
          <span className={styles.track} aria-hidden><span /></span>
          <span className={styles.state}>{pending ? "Saving…" : user.is_library_public ? "On" : "Off"}</span>
        </label>
      </section>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </PageShell>
  );
}

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsPageContent />
    </RequireAuth>
  );
}
