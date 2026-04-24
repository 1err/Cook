"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";

export type Language = "en" | "zh";
type Messages = Record<string, string>;

const LANGUAGE_STORAGE_KEY = "cooking-ui-language";
const MESSAGE_MAP: Record<Language, Messages> = { en, zh };

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (saved === "en" || saved === "zh") {
        setLanguageState(saved);
      }
    } catch {
      // ignore storage failures
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // ignore storage failures
    }
  }, [language]);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const message = MESSAGE_MAP[language][key] ?? MESSAGE_MAP.en[key] ?? key;
      return interpolate(message, vars);
    },
    [language]
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}

export function useT() {
  return useI18n().t;
}

export function LanguageToggle() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div aria-label={t("language.label")} className="language-toggle">
      {(["en", "zh"] as const).map((option) => {
        const active = language === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => setLanguage(option)}
            className={`font-headline language-toggle__button${active ? " is-active" : ""}`}
            aria-pressed={active}
          >
            {t(`language.${option}`)}
          </button>
        );
      })}
    </div>
  );
}
