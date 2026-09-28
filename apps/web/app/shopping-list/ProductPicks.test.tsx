import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

test("localizes the Chinese cart-selection labels", async () => {
  stubLanguageStorage("zh");
  renderPicks(
    <ProductPicks
      state={{
        status: "success",
        products: [
          { name: "茉莉香米", price: "$2.99", image: "", url: "https://www.sayweee.com/product/rice" },
        ],
      }}
      onRetry={vi.fn()}
      ingredientKey="大米"
      ingredientName="大米"
      selectedUrl="https://www.sayweee.com/product/rice"
      onSelect={vi.fn()}
    />,
  );

  expect(await screen.findByText("首选")).toBeVisible();
  expect(screen.getByRole("radio", { name: "已为购物草稿选择 茉莉香米" })).toBeChecked();
  expect(screen.getByRole("radiogroup", { name: "为 大米 选择购物草稿商品" })).toBeVisible();
  expect(screen.getByText("已选入购物草稿")).toBeVisible();
});

test("labels the safe top pick, exposes the selected radio, and selects another safe product", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
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
      ingredientKey="canonical-potatoes"
      ingredientName="Potatoes"
      selectedUrl="https://www.sayweee.com/product/potato"
      onSelect={onSelect}
    />,
  );

  expect(screen.getAllByTestId("store-product-row")).toHaveLength(3);
  expect(screen.getByRole("img", { name: "Idaho potatoes" })).toBeVisible();
  expect(screen.getByText("$1.99")).toBeVisible();
  expect(screen.getByText("Top pick")).toBeVisible();
  expect(screen.getByRole("radiogroup", { name: "Choose Potatoes for cart" })).toBeVisible();
  const radios = screen.getAllByRole("radio");
  expect(radios).toHaveLength(3);
  expect(new Set(radios.map((radio) => radio.getAttribute("name"))).size).toBe(1);
  expect(screen.getByRole("radio", { name: "Idaho potatoes: Selected for cart" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "Idaho potatoes: Selected for cart" }));
  expect(onSelect).not.toHaveBeenCalled();
  await user.click(screen.getByRole("radio", { name: "Choose Golden potatoes for cart" }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith("https://www.sayweee.com/product/gold");
  expect(screen.getAllByRole("link", { name: "View on Weee" })).toHaveLength(3);
});

test("keeps duplicate ingredient rows in separate native radio groups", () => {
  const state = {
    status: "success" as const,
    products: [
      { name: "Jasmine rice", price: "$2", image: "", url: "https://www.sayweee.com/product/rice" },
      { name: "Brown rice", price: "$4", image: "", url: "https://www.sayweee.com/product/brown-rice" },
    ],
  };
  renderPicks(
    <>
      <ProductPicks
        state={state}
        onRetry={vi.fn()}
        ingredientKey="rice"
        ingredientName="Rice"
      />
      <ProductPicks
        state={state}
        onRetry={vi.fn()}
        ingredientKey="rice"
        ingredientName=" RICE "
      />
    </>,
  );

  const names = screen.getAllByRole("radio").map((radio) => radio.getAttribute("name"));
  expect(names[0]).toBe(names[1]);
  expect(names[2]).toBe(names[3]);
  expect(names[0]).not.toBe(names[2]);
});

test("falls back to the first visible product when the selected safe product is not rendered", () => {
  renderPicks(
    <ProductPicks
      state={{
        status: "success",
        products: [
          { name: "First rice", price: "$1", image: "", url: "https://www.sayweee.com/product/first-rice" },
          { name: "Second rice", price: "$2", image: "", url: "https://www.sayweee.com/product/second-rice" },
          { name: "Third rice", price: "$3", image: "", url: "https://www.sayweee.com/product/third-rice" },
          { name: "Fourth rice", price: "$4", image: "", url: "https://www.sayweee.com/product/fourth-rice" },
        ],
      }}
      onRetry={vi.fn()}
      ingredientKey="rice"
      ingredientName="Rice"
      selectedUrl="https://www.sayweee.com/product/fourth-rice"
      onSelect={vi.fn()}
    />,
  );

  const radios = screen.getAllByRole("radio");
  expect(radios).toHaveLength(3);
  expect(radios[0]).toBeChecked();
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
      ingredientKey="tofu"
      selectedUrl={url}
      onSelect={vi.fn()}
    />,
  );

  expect(screen.queryByRole("link", { name: "View on Weee" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});


test("uses readable titles and accessible labels without altering the product link or source", async () => {
  const product = { name: "weee_seasoning_Lee_Kum_Kee Soy Sauce", price: "$3", image: "/soy.jpg", url: "https://www.sayweee.com/product/soy" };
  const onSelect = vi.fn();
  renderPicks(<ProductPicks
    state={{ status: "success", products: [
      { name: "Other sauce", price: "$2", image: "", url: "https://www.sayweee.com/product/other" }, product,
    ] }} onRetry={vi.fn()} onSelect={onSelect}
  />);
  expect(screen.getByText("Lee Kum Kee Soy Sauce")).toBeVisible();
  expect(screen.getByRole("img", { name: "Lee Kum Kee Soy Sauce" })).toBeVisible();
  await userEvent.setup().click(screen.getByRole("radio", { name: "Choose Lee Kum Kee Soy Sauce for cart" }));
  expect(onSelect).toHaveBeenCalledWith(product.url);
  expect(screen.getAllByRole("link", { name: "View on Weee" })[1]).toHaveAttribute("href", product.url);
  expect(product.name).toBe("weee_seasoning_Lee_Kum_Kee Soy Sauce");
});
