"use client";

import { useEffect, useState } from "react";
import { Icon } from "../components/ui/Icon";
import { useT } from "../lib/i18n";
import styles from "./LibraryPage.module.css";

export function PublicRecipeSaveButton({ title, saved, saving, onSave }: {
  title: string;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const t = useT();
  const [hintDismissed, setHintDismissed] = useState(false);
  useEffect(() => {
    function dismissHint(event: KeyboardEvent) {
      if (event.key === "Escape") setHintDismissed(true);
    }
    document.addEventListener("keydown", dismissHint);
    return () => document.removeEventListener("keydown", dismissHint);
  }, []);
  const label = t(saved ? "library.inYourLibrary" : saving ? "library.adding" : "library.addToMyLibrary");

  return <div className={styles.saveControl} data-hint-dismissed={hintDismissed}>
    <button
      type="button"
      className={`${styles.saveButton} ${saved ? styles.saveButtonSaved : ""}`}
      aria-label={`${label}: ${title}`}
      aria-disabled={saved || saving}
      aria-busy={saving}
      onPointerEnter={() => setHintDismissed(false)}
      onFocus={() => setHintDismissed(false)}
      onClick={() => { if (!saved && !saving) onSave(); }}
    >
      {saving ? <span className={styles.saveSpinner} aria-hidden="true" /> : <Icon name="bookmark" size={20} />}
    </button>
    <span className={styles.saveHint} aria-hidden="true">{label}</span>
  </div>;
}
