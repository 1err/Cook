import React from "react";
jest.mock("../../lib/auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
jest.mock("../../lib/i18n", () => {
  const { MESSAGE_MAP } = require("@cooking/shared");
  return { useT: () => (key: string, vars?: Record<string, unknown>) => key.startsWith("menu.") ? (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_: string, token: string) => String(vars?.[token] ?? "")) : key };
});
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
    list: jest.fn(async () => recipes),
    page: async () => ({items: await mockList(), next_cursor:null}),
    catalogPage: async () => ({items: await mockCatalog(), next_cursor:null}),
    copyCatalog: jest.fn(),
  },
};

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
}));

beforeEach(() => {
  mockApiClient.recipes.list.mockReset().mockResolvedValue(recipes);
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

test('retains the private library after a catalog error and retries the failed source', async () => {
  mockList.mockResolvedValueOnce(recipes).mockRejectedValue(new Error('Private offline'));
  mockCatalog.mockRejectedValueOnce(new Error('Catalog offline')).mockResolvedValueOnce([{ ...recipes[0], id: 'public-1', title: 'Recovered catalog' }]);
  await render(<LibraryListScreen navigation={{ addListener: jest.fn(() => jest.fn()), navigate: jest.fn() } as never} route={{ key: 'library', name: 'LibraryList' }} />);
  await screen.findByText('Tomato egg stir-fry');
  await fireEvent.press(screen.getByRole('button', { name: 'Public Library' }));
  await screen.findByRole('alert');
  await fireEvent.press(screen.getByRole('button', { name: 'library.retry' }));
  await screen.findByText('Recovered catalog');
  await fireEvent.press(screen.getByRole('button', { name: 'My Library' }));
  expect(screen.getByText('Tomato egg stir-fry')).toBeOnTheScreen();
  expect(mockList).toHaveBeenCalledTimes(1);
});

test('a copied recipe appears in the retained private library', async () => {
  await renderCatalog();
  mockList.mockResolvedValue([{ ...recipes[0], title: 'Newly copied' }]);
  await fireEvent.press(screen.getByRole('button', { name: 'Add to library' }));
  await screen.findByRole('button', { name: 'In your library' });
  await fireEvent.press(screen.getByRole('button', { name: 'My Library' }));
  expect(await screen.findByText('Newly copied')).toBeOnTheScreen();
});

test('a failed refresh keeps a completed copy marked as saved', async () => {
  await renderCatalog();
  await fireEvent.press(screen.getByRole('button', { name: 'Add to library' }));
  await screen.findByRole('button', { name: 'In your library' });
  mockCatalog.mockRejectedValueOnce(new Error('Catalog offline'));
  await act(async () => { await focusLibrary(); });
  expect(screen.getByRole('button', { name: 'In your library' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'library.retry' })).toBeEnabled();
});

test('a late catalog copy does not refresh after the account view unmounts', async () => {
  let finish!: () => void;
  mockApiClient.recipes.copyCatalog.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  mockCatalog.mockResolvedValue([{ ...recipes[0], already_saved: false }]);
  const rendered = await render(<LibraryListScreen navigation={{ addListener: jest.fn(() => jest.fn()), navigate: jest.fn() } as never} route={{ key: 'library', name: 'LibraryList' }} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Public Library' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Add to library' }));
  await rendered.unmount();
  await act(async () => { finish(); });
  expect(mockList).toHaveBeenCalledTimes(1);
});


test("menu selection loads the whole owned library only on request and selects all under a search", async () => {
  const navigate = jest.fn();
  mockApiClient.recipes.list.mockResolvedValueOnce([...recipes, { ...recipes[0], id: "recipe-2", title: "Soup" }]);
  await render(<LibraryListScreen navigation={{ addListener: jest.fn(() => jest.fn()), navigate } as never} route={{ key: "library", name: "LibraryList" }} />);
  await screen.findByText("Tomato egg stir-fry");
  expect(mockApiClient.recipes.list).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Make a menu" }));
  await fireEvent.press(await screen.findByRole("checkbox", { name: "Select Soup" }));
  expect(screen.getByText("1 dishes selected")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Choose a style" }));
  expect(navigate).toHaveBeenLastCalledWith("MenuMaker", { recipeIds: ["recipe-2"] });
  await fireEvent.changeText(screen.getByPlaceholderText("Search recipes"), "Soup");
  expect(screen.queryByRole("checkbox", { name: "Select Tomato egg stir-fry" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Select all recipes" }));
  await fireEvent.press(screen.getByRole("button", { name: "Choose a style" }));
  expect(navigate).toHaveBeenLastCalledWith("MenuMaker", { recipeIds: ["recipe-1", "recipe-2"] });
  await fireEvent.press(screen.getByRole("button", { name: "Public Library" }));
  expect(screen.queryByRole("button", { name: "Make a menu" })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

test("menu load failure keeps library browsing available and supports retry", async () => {
  mockApiClient.recipes.list.mockRejectedValueOnce(new Error("Offline"));
  await render(<LibraryListScreen navigation={{ addListener: jest.fn(() => jest.fn()), navigate: jest.fn() } as never} route={{ key: "library", name: "LibraryList" }} />);
  await screen.findByText("Tomato egg stir-fry");
  await fireEvent.press(screen.getByRole("button", { name: "Make a menu" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Tomato egg stir-fry")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Make a menu" }));
  expect(await screen.findByRole("checkbox", { name: "Select Tomato egg stir-fry" })).toBeOnTheScreen();
});
