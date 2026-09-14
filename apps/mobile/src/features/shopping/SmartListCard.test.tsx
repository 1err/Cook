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

test("threads the canonical ingredient key and selected product through each display row", async () => {
  const onSelectProduct = jest.fn();
  await render(
    <SmartListCard
      category="Produce"
      rows={[{ item: { name: "  RICE  ", suggested_purchase: "1 bag", category: "Produce" }, origIndex: 3 }]}
      checked={new Set()}
      productsOpenByName={{ rice: true }}
      productsByName={{
        rice: [
          { name: "White rice", price: "$2.99", image: "", url: "https://www.sayweee.com/product/white-rice" },
          { name: "Brown rice", price: "$4.99", image: "", url: "https://www.sayweee.com/product/brown-rice" },
        ],
      }}
      productsLoadingByName={{ rice: false }}
      productsErrorByName={{ rice: null }}
      selectedUrlByIngredient={{ rice: "https://www.sayweee.com/product/brown-rice" }}
      onSelectProduct={onSelectProduct}
      onToggleChecked={jest.fn()}
      onHide={jest.fn()}
      onTogglePanel={jest.fn()}
      onRetryProducts={jest.fn()}
    />,
  );

  expect(screen.getByRole("radio", { name: "Brown rice: Selected for cart" }))
    .toHaveProp("accessibilityState", { selected: true });
  const user = userEvent.setup();
  await user.press(screen.getByRole("radio", { name: "Choose White rice for cart" }));
  expect(onSelectProduct).toHaveBeenCalledTimes(1);
  expect(onSelectProduct).toHaveBeenCalledWith(
    "rice",
    "https://www.sayweee.com/product/white-rice",
  );
});

test("keeps checked-row product links visible without inactive cart-choice controls", async () => {
  const onToggleChecked = jest.fn();
  const onSelectProduct = jest.fn();
  await render(
    <SmartListCard
      category="Produce"
      rows={[{ item: { name: "Rice", suggested_purchase: "1 bag", category: "Produce" }, origIndex: 7 }]}
      checked={new Set([7])}
      productsOpenByName={{ rice: true }}
      productsByName={{
        rice: [{
          name: "Jasmine rice",
          price: "$2.99",
          image: "",
          url: "https://www.sayweee.com/product/rice",
        }],
      }}
      productsLoadingByName={{ rice: false }}
      productsErrorByName={{ rice: null }}
      selectedUrlByIngredient={{ rice: "https://www.sayweee.com/product/rice" }}
      onSelectProduct={onSelectProduct}
      onToggleChecked={onToggleChecked}
      onHide={jest.fn()}
      onTogglePanel={jest.fn()}
      onRetryProducts={jest.fn()}
    />,
  );

  expect(screen.getByText("Already have")).toBeOnTheScreen();
  expect(screen.getByRole("link", { name: "View Jasmine rice on Weee" })).toBeOnTheScreen();
  expect(screen.queryByText("Top pick")).not.toBeOnTheScreen();
  expect(screen.queryByRole("radio")).not.toBeOnTheScreen();
  const checkbox = screen.getByRole("checkbox");
  expect(checkbox).toHaveProp("accessibilityState", { checked: true });
  const user = userEvent.setup();
  await user.press(checkbox);
  expect(onToggleChecked).toHaveBeenCalledWith(7);
  expect(onSelectProduct).not.toHaveBeenCalled();
});
