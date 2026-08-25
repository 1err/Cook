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
