import React from "react";
import { render, screen } from "@testing-library/react-native";
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
