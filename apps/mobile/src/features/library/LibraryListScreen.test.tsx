import React from "react";
jest.mock("../../lib/i18n", () => ({useT: () => (key: string) => key}));
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
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
const mockCatalog = jest.fn<Promise<unknown[]>, []>(async () => []);
const mockApiClient = {
  recipes: {
    page: async () => ({items: await mockList(), next_cursor:null}),
    catalogPage: async () => ({items: await mockCatalog(), next_cursor:null}),
    copyCatalog: jest.fn(),
  },
};

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
}));

beforeEach(() => {
  mockList.mockReset().mockResolvedValue(recipes);
  mockCatalog.mockReset().mockResolvedValue([]);
  mockApiClient.recipes.copyCatalog.mockReset().mockResolvedValue({ id: "copy-1" });
});

let focusLibrary: () => void;

async function renderCatalog() {
  mockCatalog.mockResolvedValue([{ ...recipes[0], already_saved: false }]);
  await render(<LibraryListScreen navigation={{ addListener: (_event: string, listener: () => void) => { focusLibrary = listener; return () => {}; }, navigate: jest.fn() } as never} route={{ key: "library", name: "LibraryList" }} />);
  await fireEvent.press(screen.getByRole("button", { name: "Public Library" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Add to library" })).toBeEnabled());
}

test("allows copying again after the owned copy is deleted and the catalog refreshes", async () => {
  await renderCatalog();
  await fireEvent.press(screen.getByRole("button", { name: "Add to library" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "In your library" })).toBeDisabled());
  await fireEvent.press(screen.getByRole("button", { name: "My Library" }));
  // RecipeDetail deletion leaves the authoritative catalog status false.
  mockList.mockResolvedValue([]);
  await fireEvent.press(screen.getByRole("button", { name: "Public Library" }));
  await act(async () => { await focusLibrary(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Add to library" })).toBeEnabled());
  await fireEvent.press(screen.getByRole("button", { name: "Add to library" }));
  await waitFor(() => expect(mockApiClient.recipes.copyCatalog).toHaveBeenCalledTimes(2));
});

test("a refresh started before copy completion cannot clear that copy's optimistic marker", async () => {
  await renderCatalog();
  let finishCopy!: () => void;
  let finishRefresh!: (value: unknown[]) => void;
  mockApiClient.recipes.copyCatalog.mockImplementationOnce(() => new Promise<void>(resolve => { finishCopy = resolve; }));
  await fireEvent.press(screen.getByRole("button", { name: "Add to library" }));
  expect(screen.getByRole("button", { name: "Add to library" })).toBeDisabled();
  mockCatalog.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
  await act(async () => { void focusLibrary(); });
  await act(async () => { finishCopy(); });
  await act(async () => { finishRefresh([{ ...recipes[0], already_saved: false }]); });
  await waitFor(() => expect(screen.getByRole("button", { name: "In your library" })).toBeDisabled());
  expect(mockApiClient.recipes.copyCatalog).toHaveBeenCalledTimes(1);
  await act(async () => { await focusLibrary(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Add to library" })).toBeEnabled());
});

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

test("an unavailable public catalog does not hide the user's own recipes", async () => {
  mockCatalog.mockRejectedValueOnce(new Error("Catalog unavailable"));
  await render(
    <LibraryListScreen
      navigation={{ addListener: jest.fn(() => jest.fn()), navigate: jest.fn() } as never}
      route={{ key: "library", name: "LibraryList" }}
    />,
  );
  await waitFor(() => expect(screen.getByText("Tomato egg stir-fry")).toBeOnTheScreen());
});
