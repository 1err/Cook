import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { ShoppingCategorySection } from "./ShoppingCategorySection";

afterEach(cleanup);

test("uses a plain category heading and expands vertical store choices", async () => {
  const user = userEvent.setup();
  const onToggleProducts = vi.fn();
  render(
    <I18nProvider>
      <ShoppingCategorySection
        title="Produce"
        rows={[{ item: { name: "Potatoes", suggested_purchase: "2 pieces" }, origIndex: 0 }]}
        checked={new Set()}
        openProducts={{ potatoes: true }}
        lookup={{
          potatoes: {
            status: "success",
            products: [
              { name: "One", price: "$1", image: "https://example.com/1.jpg", url: "https://www.sayweee.com/product/1" },
              { name: "Two", price: "$2", image: "https://example.com/2.jpg", url: "https://www.sayweee.com/product/2" },
              { name: "Three", price: "$3", image: "https://example.com/3.jpg", url: "https://www.sayweee.com/product/3" },
            ],
          },
        }}
        menuOpenFor={null}
        onToggleChecked={vi.fn()}
        onHide={vi.fn()}
        onToggleMenu={vi.fn()}
        onToggleProducts={onToggleProducts}
        onRetryProducts={vi.fn()}
      />
    </I18nProvider>,
  );

  expect(screen.getByRole("heading", { name: "Produce" })).toBeVisible();
  expect(screen.queryByTestId("category-icon")).not.toBeInTheDocument();
  expect(screen.getAllByTestId("store-product-row")).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Hide products" }));
  expect(onToggleProducts).toHaveBeenCalledWith("Potatoes");
});

test("keeps checked rows compact even when cached product panels are open", () => {
  render(
    <I18nProvider>
      <ShoppingCategorySection
        title="Pantry & Dry Goods"
        rows={[{ item: { name: "Rice", suggested_purchase: "1 bag" }, origIndex: 4 }]}
        checked={new Set([4])}
        openProducts={{ rice: true }}
        lookup={{
          rice: {
            status: "success",
            products: [
              { name: "Jasmine rice", price: "$2", image: "", url: "https://www.sayweee.com/product/rice" },
              { name: "Brown rice", price: "$4", image: "", url: "https://www.sayweee.com/product/brown-rice" },
            ],
          },
        }}
        selectedUrlByIngredient={{ rice: "https://www.sayweee.com/product/brown-rice" }}
        menuOpenFor={null}
        onToggleChecked={vi.fn()}
        onHide={vi.fn()}
        onToggleMenu={vi.fn()}
        onToggleProducts={vi.fn()}
        onRetryProducts={vi.fn()}
        onSelectProduct={vi.fn()}
      />
    </I18nProvider>,
  );

  expect(screen.queryByRole("link", { name: "View on Weee" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /products/ })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(screen.getByText("1 bag")).toBeVisible();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.queryByText("Top pick")).not.toBeInTheDocument();
  expect(screen.queryByText("Selected for cart")).not.toBeInTheDocument();
});
