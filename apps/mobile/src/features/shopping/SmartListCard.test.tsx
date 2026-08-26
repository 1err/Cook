import React from "react";
import { render, screen, userEvent } from "@testing-library/react-native";
import { SmartListCard } from "./SmartListCard";

test("uses a plain category heading without a decorative category icon", async () => {
  await render(
    <SmartListCard
      category="Produce"
      rows={[{ item: { name: "Potatoes", suggested_purchase: "2 pieces", category: "Produce" }, origIndex: 0 }]}
      checked={new Set()}
      productsOpenByName={{}}
      productsByName={{}}
      productsLoadingByName={{}}
      productsErrorByName={{}}
      onToggleChecked={jest.fn()}
      onHide={jest.fn()}
      onTogglePanel={jest.fn()}
      onRetryProducts={jest.fn()}
    />,
  );

  expect(screen.getByText("Produce")).toBeOnTheScreen();
  expect(screen.queryByText("eco")).not.toBeOnTheScreen();
});

test("looks up product state through the canonical ingredient key", async () => {
  await render(
    <SmartListCard
      category="Produce"
      rows={[{ item: { name: "  RICE  ", suggested_purchase: "1 bag", category: "Produce" }, origIndex: 0 }]}
      checked={new Set()}
      productsOpenByName={{ rice: true }}
      productsByName={{ rice: [{ name: "Rice", price: "$2.99", image: "", url: "https://www.sayweee.com/product/rice" }] }}
      productsLoadingByName={{ rice: false }}
      productsErrorByName={{ rice: null }}
      onToggleChecked={jest.fn()}
      onHide={jest.fn()}
      onTogglePanel={jest.fn()}
      onRetryProducts={jest.fn()}
    />,
  );

  expect(screen.getByText("View on Weee")).toBeOnTheScreen();
});

test("preserves the row spelling when product callbacks are invoked", async () => {
  const onTogglePanel = jest.fn();
  const onRetryProducts = jest.fn();
  await render(
    <SmartListCard
      category="Produce"
      rows={[{ item: { name: "  RICE  ", suggested_purchase: "1 bag", category: "Produce" }, origIndex: 0 }]}
      checked={new Set()}
      productsOpenByName={{ rice: true }}
      productsByName={{}}
      productsLoadingByName={{ rice: false }}
      productsErrorByName={{ rice: "Couldn't load products" }}
      onToggleChecked={jest.fn()}
      onHide={jest.fn()}
      onTogglePanel={onTogglePanel}
      onRetryProducts={onRetryProducts}
    />,
  );

  const user = userEvent.setup();
  await user.press(screen.getByText("Hide products"));
  await user.press(screen.getByRole("button", { name: "Retry" }));
  expect(onTogglePanel).toHaveBeenCalledWith("  RICE  ");
  expect(onRetryProducts).toHaveBeenCalledWith("  RICE  ");
});
