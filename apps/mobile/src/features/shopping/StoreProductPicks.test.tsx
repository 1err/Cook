import React from "react";
import { Linking } from "react-native";
import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
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

test("catches a rejected retailer link and lets the user retry it locally", async () => {
  const openUrl = jest.spyOn(Linking, "openURL")
    .mockRejectedValueOnce(new Error("link denied"))
    .mockResolvedValueOnce(undefined);
  await render(
    <StoreProductPicks
      loading={false}
      error={null}
      products={[{
        name: "Silken tofu",
        price: "$2.99",
        image: "",
        url: "https://www.sayweee.com/product/tofu",
      }]}
      onRetry={jest.fn()}
    />,
  );
  const user = userEvent.setup();
  const link = screen.getByRole("link", { name: "View Silken tofu on Weee" });

  await user.press(link);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't open Weee. Tap the product link to try again.",
  );
  await user.press(link);
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeOnTheScreen());
  expect(openUrl).toHaveBeenCalledTimes(2);

  openUrl.mockRestore();
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

test("marks the effective product as selected, labels only the first safe result Top pick, and chooses the exact alternative", async () => {
  const onSelect = jest.fn();
  await render(
    <StoreProductPicks
      loading={false}
      error={null}
      products={[
        { name: "Idaho potatoes", price: "$1.99", image: "", url: "https://www.sayweee.com/product/idaho" },
        { name: "Golden potatoes", price: "$5.49", image: "", url: "https://www.sayweee.com/product/golden" },
        { name: "Red yam", price: "$4.99", image: "", url: "https://www.sayweee.com/product/yam" },
      ]}
      selectedUrl="https://www.sayweee.com/product/idaho"
      onSelect={onSelect}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.getAllByText("Top pick")).toHaveLength(1);
  const selected = screen.getByRole("radio", { name: "Idaho potatoes: Selected for cart" });
  expect(selected).toHaveProp("accessibilityState", { selected: true });
  expect(screen.getByRole("radio", { name: "Choose Golden potatoes for cart" }))
    .toHaveProp("accessibilityState", { selected: false });

  const user = userEvent.setup();
  await user.press(selected);
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenLastCalledWith("https://www.sayweee.com/product/idaho");
  await user.press(screen.getByRole("radio", { name: "Choose Golden potatoes for cart" }));
  expect(onSelect).toHaveBeenCalledTimes(2);
  expect(onSelect).toHaveBeenLastCalledWith("https://www.sayweee.com/product/golden");
  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.getByRole("link", { name: "View Idaho potatoes on Weee" }))
    .toHaveStyle({ minHeight: 44 });
});

test("falls back to the first visible safe product when a selected fourth result is not rendered", async () => {
  await render(
    <StoreProductPicks
      loading={false}
      error={null}
      products={[
        { name: "First rice", price: "$1", image: "", url: "https://www.sayweee.com/product/first-rice" },
        { name: "Second rice", price: "$2", image: "", url: "https://www.sayweee.com/product/second-rice" },
        { name: "Third rice", price: "$3", image: "", url: "https://www.sayweee.com/product/third-rice" },
        { name: "Fourth rice", price: "$4", image: "", url: "https://www.sayweee.com/product/fourth-rice" },
      ]}
      selectedUrl="https://www.sayweee.com/product/fourth-rice"
      onSelect={jest.fn()}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.getAllByRole("radio")).toHaveLength(3);
  expect(screen.getByRole("radio", { name: "First rice: Selected for cart" }))
    .toHaveProp("accessibilityState", { selected: true });
  expect(screen.queryByText("Fourth rice")).not.toBeOnTheScreen();
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
