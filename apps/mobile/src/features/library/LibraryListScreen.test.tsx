import React from "react";
import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import { LibraryListScreen } from "./LibraryListScreen";

const recipes = [
  {
    id: "recipe-1",
    title: "Tomato egg stir-fry",
    thumbnail_url: null,
    total_time_minutes: 35,
    library_tags: ["chinese", "weeknight"],
    ingredients: [
      { name: "Tomato", quantity: "2" },
      { name: "Egg", quantity: "3" },
    ],
  },
  {
    id: "recipe-2",
    title: "Slow tofu stew",
    thumbnail_url: null,
    total_time_minutes: 70,
    library_tags: ["korean", "slow-cooked"],
    ingredients: [{ name: "Tofu", quantity: "1 block" }],
  },
];

const mockList = jest.fn(async () => recipes);
const mockCatalog = jest.fn(async () => []);
const mockApiClient = {
  recipes: {
    list: mockList,
    catalog: mockCatalog,
    copyCatalog: jest.fn(),
  },
};

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
}));

test("shows useful recipe metadata instead of ingredient counts", async () => {
  await render(
    <LibraryListScreen
      navigation={{
        addListener: jest.fn(() => jest.fn()),
        navigate: jest.fn(),
      } as never}
      route={{ key: "library", name: "LibraryList" }}
    />,
  );

  await waitFor(() => expect(screen.getByText("Tomato egg stir-fry")).toBeOnTheScreen());
  expect(screen.getByText("35 min")).toBeOnTheScreen();
  expect(screen.getAllByText("Chinese")).not.toHaveLength(0);
  expect(screen.getAllByText("Weeknight")).not.toHaveLength(0);
  expect(screen.queryByText(/2 ingredients/i)).not.toBeOnTheScreen();
});

test("filters recipes by title and a selected tag", async () => {
  const user = userEvent.setup();
  await render(
    <LibraryListScreen
      navigation={{
        addListener: jest.fn(() => jest.fn()),
        navigate: jest.fn(),
      } as never}
      route={{ key: "library", name: "LibraryList" }}
    />,
  );

  await waitFor(() => expect(screen.getByText("Tomato egg stir-fry")).toBeOnTheScreen());

  const search = screen.getByLabelText("Search recipes");
  await user.type(search, "tofu");
  await waitFor(() => expect(screen.queryByText("Tomato egg stir-fry")).not.toBeOnTheScreen());
  expect(screen.getByText("Slow tofu stew")).toBeOnTheScreen();

  await user.clear(search);
  await user.press(screen.getByRole("button", { name: "Weeknight" }));
  await waitFor(() => expect(screen.queryByText("Slow tofu stew")).not.toBeOnTheScreen());
  expect(screen.getByText("Tomato egg stir-fry")).toBeOnTheScreen();
});
