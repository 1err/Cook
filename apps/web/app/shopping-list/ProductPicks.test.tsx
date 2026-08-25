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
  const { container } = renderPicks(
    <ProductPicks state={{ status }} onRetry={vi.fn()} />,
  );

  expect(screen.getByText(message)).toBeVisible();
  expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  expect(container.querySelector(".shop-bulk-loading-banner__spinner")).toBeInTheDocument();
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

test("renders store choices as complete vertical product rows", () => {
  renderPicks(
    <ProductPicks
      state={{
        status: "success",
        products: [
          { name: "Idaho potatoes", price: "$1.99", image: "https://example.com/potato.jpg", url: "https://www.sayweee.com/product/potato" },
          { name: "Golden potatoes", price: "$5.49", image: "https://example.com/gold.jpg", url: "https://www.sayweee.com/product/gold" },
          { name: "Red yam", price: "$4.99", image: "https://example.com/yam.jpg", url: "https://www.sayweee.com/product/yam" },
        ],
      }}
      onRetry={vi.fn()}
    />,
  );

  expect(screen.getAllByTestId("store-product-row")).toHaveLength(3);
  expect(screen.getByRole("img", { name: "Idaho potatoes" })).toBeVisible();
  expect(screen.getByText("$1.99")).toBeVisible();
  expect(screen.getAllByRole("link", { name: "View on Weee" })).toHaveLength(3);
});

test.each([
  "http://www.sayweee.com/product/tofu",
  "https://sayweee.com.evil.test/product/tofu",
  "https://user@sayweee.com/product/tofu",
  "https://sayweee.com:444/product/tofu",
])("does not expose an unsafe product navigation target: %s", (url) => {
  renderPicks(
    <ProductPicks
      state={{
        status: "success",
        products: [{ name: "Unsafe tofu", price: "$1", image: "", url }],
      }}
      onRetry={vi.fn()}
    />,
  );

  expect(screen.queryByRole("link", { name: "View on Weee" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});
