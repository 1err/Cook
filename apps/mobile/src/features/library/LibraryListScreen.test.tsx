import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
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

test("keeps the library list focused on collection browsing", async () => {
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
  expect(screen.getByRole("button", { name: "My Library" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Public Library" })).toBeOnTheScreen();
  expect(screen.queryByLabelText("Search recipes")).not.toBeOnTheScreen();
});
