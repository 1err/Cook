import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider, useI18n, useT } from "./i18n";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn(() => "/") }));
vi.mock("next/navigation", () => ({ usePathname }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function LanguageProbe() {
  const { language } = useI18n();
  return <span>{language}</span>;
}

function IngredientCopyProbe() {
  const t = useT();
  return <>
    <span>{t("recipe.metricQty")}</span>
    <span>{t("recipe.metricQtyHelp")}</span>
    <span>{t("import.recipeDetails")}</span>
    <span>{t("import.editTags")}</span>
    <span>{t("import.sourceReviewHint")}</span>
  </>;
}

test.each([
  ["en", "Amount in g / ml", "Optional conversion, e.g. 400 g or 250 ml."],
  ["zh", "用量（克 / 毫升）", "可选换算，例如 400 克或 250 毫升。"],
])("explains the optional ingredient conversion in %s", async (language, label, help) => {
  vi.stubGlobal("localStorage", { getItem: () => language, setItem: vi.fn() });
  usePathname.mockReturnValue("/import");
  render(<I18nProvider><IngredientCopyProbe /></I18nProvider>);
  expect(await screen.findByText(label)).toBeVisible();
  expect(screen.getByText(help)).toBeVisible();
  expect(screen.getByText(language === "zh" ? "菜谱信息" : "Recipe details")).toBeVisible();
  expect(screen.getByText(language === "zh" ? "编辑标签" : "Edit tags")).toBeVisible();
  expect(screen.getByText(language === "zh"
    ? "保存到菜谱库前，你可以先检查并编辑内容。"
    : "Review and edit before saving to your library.")).toBeVisible();
});

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
