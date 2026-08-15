import AsyncStorage from "@react-native-async-storage/async-storage";
import { MESSAGE_MAP, type Language } from "@cooking/shared";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type { Language };

const LANGUAGE_STORAGE_KEY = "cooking-ui-language";

type TranslationVariables = Record<string, string | number>;

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, variables?: TranslationVariables) => string;
  loading: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, variables?: TranslationVariables): string {
  if (!variables) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(variables[key] ?? ""));
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  const [loading, setLoading] = useState(true);
  const hasExplicitLanguage = useRef(false);

  useEffect(() => {
    let active = true;

    void AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((savedLanguage) => {
        if (
          active &&
          !hasExplicitLanguage.current &&
          (savedLanguage === "en" || savedLanguage === "zh")
        ) {
          setLanguageState(savedLanguage);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const setLanguage = useCallback((nextLanguage: Language) => {
    hasExplicitLanguage.current = true;
    setLanguageState(nextLanguage);
    void AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage).catch(() => undefined);
  }, []);

  const t = useCallback(
    (key: string, variables?: TranslationVariables) => {
      const message = MESSAGE_MAP[language][key] ?? MESSAGE_MAP.en[key] ?? key;
      return interpolate(message, variables);
    },
    [language],
  );

  const value = useMemo(
    () => ({ language, setLanguage, t, loading }),
    [language, setLanguage, t, loading],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}

export function useT(): I18nContextValue["t"] {
  return useI18n().t;
}
