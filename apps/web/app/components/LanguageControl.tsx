"use client";

import { useI18n } from "../lib/i18n";
import styles from "./LanguageControl.module.css";

type LanguageControlProps = {
  compact?: boolean;
};

const LANGUAGE_OPTIONS = [
  { language: "en", key: "language.english" },
  { language: "zh", key: "language.chinese" },
] as const;

export function LanguageControl({ compact = false }: LanguageControlProps) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      aria-label={t("account.language")}
      className={`${styles.control}${compact ? ` ${styles.compact}` : ""}`}
      role="group"
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <button
          aria-pressed={language === option.language}
          className={styles.option}
          key={option.language}
          onClick={() => setLanguage(option.language)}
          type="button"
        >
          {t(option.key)}
        </button>
      ))}
    </div>
  );
}

export type { LanguageControlProps };
