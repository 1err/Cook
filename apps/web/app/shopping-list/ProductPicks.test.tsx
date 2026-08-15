import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { ProductPicks } from "./ProductPicks";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubLanguageStorage(language: "en" | "zh") {
  const values = new Map<string, string>([["cooking-ui-language", language]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
}

function renderPicks(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

test.each([
  ["queued", "Waiting to load from Weee…"],
  ["loading", "Finding matches on Weee…"],
] as const)("renders %s without the empty message", (status, message) => {
  renderPicks(<ProductPicks state={{ status }} onRetry={vi.fn()} />);

  expect(screen.getByText(message)).toBeVisible();
  expect(screen.queryByText("No products found on Weee")).not.toBeInTheDocument();
});

test("shows empty only after a completed empty response", () => {
  renderPicks(
    <ProductPicks
      state={{ status: "empty", products: [] }}
      onRetry={vi.fn()}
    />,
  );

  expect(screen.getByText("No products found on Weee")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("renders a localized failure instead of technical error details", () => {
  renderPicks(
    <ProductPicks
      state={{ status: "error", error: "Network unavailable" }}
      onRetry={vi.fn()}
    />,
  );

  expect(screen.getByText("Could not load products from Weee.")).toBeVisible();
  expect(screen.queryByText("Network unavailable")).not.toBeInTheDocument();
});

test("renders the localized Chinese failure", async () => {
  stubLanguageStorage("zh");
  renderPicks(<ProductPicks state={{ status: "error" }} onRetry={vi.fn()} />);

  expect(await screen.findByText("无法从 Weee 加载商品。")).toBeVisible();
});
