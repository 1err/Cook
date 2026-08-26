import React from "react";
import { render, screen } from "@testing-library/react-native";
import { StoreProductPicks } from "./StoreProductPicks";

test("keeps an ingredient in the matching state until its lookup finishes", async () => {
  await render(
    <StoreProductPicks
      loading={false}
      error={null}
      products={undefined}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.getByText("Finding matches on Weee…")).toBeOnTheScreen();
  expect(screen.queryByText("No products found.")).not.toBeOnTheScreen();
});

test("shows the empty result only after a lookup completes without products", async () => {
  await render(
    <StoreProductPicks
      loading={false}
      error={null}
      products={[]}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.getByText("No products found.")).toBeOnTheScreen();
  expect(screen.queryByText("Finding matches on Weee…")).not.toBeOnTheScreen();
});

test("keeps a failed lookup in the retry state when it has no products", async () => {
  await render(
    <StoreProductPicks
      loading={false}
      error="We couldn't reach Weee."
      products={undefined}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.getByText("We couldn't reach Weee.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Retry" })).toBeOnTheScreen();
  expect(screen.queryByText("Finding matches on Weee…")).not.toBeOnTheScreen();
});

test("links successful product results to Weee", async () => {
  await render(
    <StoreProductPicks
      loading={false}
      error={null}
      products={[{ name: "Silken tofu", price: "$2.99", image: "", url: "https://www.sayweee.com/product/tofu" }]}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.getByText("View on Weee")).toBeOnTheScreen();
});

test("keeps each product as its own accessible vertical result", async () => {
  await render(
    <StoreProductPicks
      loading={false}
      error={null}
      products={[
        { name: "Idaho potatoes", price: "$1.99", image: "", url: "https://www.sayweee.com/product/idaho" },
        { name: "Golden potatoes", price: "$5.49", image: "", url: "https://www.sayweee.com/product/golden" },
        { name: "Red yam", price: "$4.99", image: "", url: "https://www.sayweee.com/product/yam" },
      ]}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.getByLabelText("View Idaho potatoes on Weee")).toBeOnTheScreen();
});

test("defensively renders only the first three safe products", async () => {
  await render(
    <StoreProductPicks
      loading={false}
      error={null}
      products={[
        { name: "Rice", price: "$1", image: "", url: "https://www.sayweee.com/product/rice" },
        { name: "Beans", price: "$1", image: "", url: "https://www.sayweee.com/product/beans" },
        { name: "Milk", price: "$1", image: "", url: "https://www.sayweee.com/product/milk" },
        { name: "Tofu", price: "$1", image: "", url: "https://www.sayweee.com/product/tofu" },
      ]}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.queryByLabelText("View Tofu on Weee")).not.toBeOnTheScreen();
});

test.each([
  "http://www.sayweee.com/product/tofu",
  "https://sayweee.com.evil.test/product/tofu",
  "https://user@sayweee.com/product/tofu",
  "https://sayweee.com:444/product/tofu",
])("does not offer navigation to an unsafe product URL: %s", async (url) => {
  await render(
    <StoreProductPicks
      loading={false}
      error={null}
      products={[{ name: "Unsafe tofu", price: "$1", image: "", url }]}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.queryByText("View on Weee")).not.toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Retry" })).toBeOnTheScreen();
});
