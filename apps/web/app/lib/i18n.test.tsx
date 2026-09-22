import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider, useI18n } from "./i18n";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn(() => "/") }));
vi.mock("next/navigation", () => ({ usePathname }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function LanguageProbe() {
  const { language } = useI18n();
  return <span>{language}</span>;
}

test("keeps a saved Chinese app preference through StrictMode and English public navigation", async () => {
  const values = new Map([["cooking-ui-language", "zh"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  usePathname.mockReturnValue("/");
  const tree = () => <StrictMode><I18nProvider><LanguageProbe /></I18nProvider></StrictMode>;
  const { rerender } = render(tree());
  expect(await screen.findByText("zh")).toBeVisible();
  expect(document.documentElement.lang).toBe("en");
  expect(localStorage.getItem("cooking-ui-language")).toBe("zh");

  usePathname.mockReturnValue("/library");
  rerender(tree());
  expect(document.documentElement.lang).toBe("zh");
  expect(localStorage.getItem("cooking-ui-language")).toBe("zh");
});
