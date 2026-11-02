import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { RecipeAuthor } from "@cooking/shared";
import { AuthorPicker } from "./AuthorPicker";

const author: RecipeAuthor = { id: "creator-1", name: "Chef Lin", aliases: ["小林", "Lín"] };
const mockApi = { recipes: { authors: jest.fn(), createAuthor: jest.fn() } };
let mockSelectedApi = mockApi;
jest.mock("../../lib/api", () => ({ useApiClient: () => mockSelectedApi }));
jest.mock("../../lib/i18n", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => {
  const { MESSAGE_MAP } = require("@cooking/shared");
  return (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_: string, token: string) => String(vars?.[token] ?? ""));
} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { resolve, promise };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectedApi = mockApi;
  mockApi.recipes.authors.mockResolvedValue([author]);
  mockApi.recipes.createAuthor.mockResolvedValue(author);
});

test("searching a normalized alias offers the existing creator without a create action", async () => {
  const onChange = jest.fn();
  await render(<AuthorPicker value={null} onChange={onChange} initialExpanded />);
  await fireEvent.changeText(screen.getByPlaceholderText("Search creators or aliases"), "  小林  ");
  await screen.findByRole("button", { name: "By Chef Lin" });
  expect(screen.queryByRole("button", { name: /Add “/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "By Chef Lin" }));
  expect(onChange).toHaveBeenCalledWith(author);
  expect(mockApi.recipes.createAuthor).not.toHaveBeenCalled();
});

test("using your own chosen name requires manual entry and explicit creation", async () => {
  const onChange = jest.fn();
  mockApi.recipes.authors.mockResolvedValue([]);
  await render(<AuthorPicker onChange={onChange} initialExpanded />);
  await fireEvent.press(screen.getByRole("button", { name: "Use my chosen author name" }));
  const input = screen.getByLabelText("Author name");
  expect(input).toHaveProp("value", "");
  await fireEvent.changeText(input, "My kitchen name");
  expect(onChange).not.toHaveBeenCalled();
  expect(mockApi.recipes.createAuthor).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByRole("button", { name: "Add “My kitchen name”" }));
  expect(mockApi.recipes.createAuthor).toHaveBeenCalledWith({ name: "My kitchen name" }, expect.objectContaining({ signal: expect.anything() }));
  expect(onChange).toHaveBeenCalledWith(author);
});

test.each([false, true])("author entry accepts 80 characters and rejects longer names (own-name path: %s)", async (ownName) => {
  const onChange = jest.fn();
  mockApi.recipes.authors.mockResolvedValue([]);
  await render(<AuthorPicker onChange={onChange} initialExpanded />);
  if (ownName) await fireEvent.press(screen.getByRole("button", { name: "Use my chosen author name" }));
  const input = screen.getByLabelText(ownName ? "Author name" : "Search creators or aliases");
  const tooLong = "a".repeat(81);
  // Synthetic input can bypass the native TextInput limit; the submission
  // boundary must still reject a name the API will reject.
  await fireEvent.changeText(input, tooLong);
  await screen.findByText("No matching creators");
  const oversizedAction = screen.queryByRole("button", { name: `Add “${tooLong}”` });
  if (oversizedAction) await fireEvent.press(oversizedAction);
  expect(mockApi.recipes.createAuthor).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect(input).toHaveProp("maxLength", 80);
  const accepted = "b".repeat(80);
  await fireEvent.changeText(input, accepted);
  await fireEvent.press(await screen.findByRole("button", { name: `Add “${accepted}”` }));
  expect(mockApi.recipes.createAuthor).toHaveBeenCalledWith({ name: accepted }, expect.objectContaining({ signal: expect.anything() }));
});

test("a failed create retains the current credit and the typed name for retry", async () => {
  const onChange = jest.fn();
  mockApi.recipes.authors.mockResolvedValue([]);
  mockApi.recipes.createAuthor.mockRejectedValueOnce(new Error("private transport details"));
  await render(<AuthorPicker value={author} onChange={onChange} initialExpanded />);
  await fireEvent.changeText(screen.getByPlaceholderText("Search creators or aliases"), "My own name");
  await fireEvent.press(await screen.findByRole("button", { name: "Add “My own name”" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save author. Try again.");
  expect(screen.getByPlaceholderText("Search creators or aliases")).toHaveProp("value", "My own name");
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Add “My own name”" }));
  expect(onChange).toHaveBeenCalledWith(author);
});

test("late suggestions for an older query cannot replace newer search results", async () => {
  const stale = deferred<RecipeAuthor[]>();
  mockApi.recipes.authors.mockImplementation(({ q }) => q === "old" ? stale.promise : Promise.resolve([author]));
  await render(<AuthorPicker onChange={jest.fn()} initialExpanded />);
  await fireEvent.changeText(screen.getByPlaceholderText("Search creators or aliases"), "old");
  await fireEvent.changeText(screen.getByPlaceholderText("Search creators or aliases"), "小林");
  await screen.findByRole("button", { name: "By Chef Lin" });
  await act(async () => { stale.resolve([{ id: "old", name: "Old result", aliases: [] }]); });
  expect(screen.queryByRole("button", { name: "By Old result" })).toBeNull();
  expect(screen.getByRole("button", { name: "By Chef Lin" })).toBeOnTheScreen();
});

test("switching accounts ignores the previous account's pending creator creation", async () => {
  const pending = deferred<RecipeAuthor>();
  const onChange = jest.fn();
  mockApi.recipes.authors.mockResolvedValue([]);
  mockApi.recipes.createAuthor.mockReturnValue(pending.promise);
  const rendered = await render(<AuthorPicker onChange={onChange} initialExpanded />);
  await fireEvent.changeText(screen.getByPlaceholderText("Search creators or aliases"), "My own name");
  await fireEvent.press(await screen.findByRole("button", { name: "Add “My own name”" }));
  mockSelectedApi = { recipes: { authors: jest.fn(async () => [author]), createAuthor: jest.fn() } };
  await rendered.rerender(<AuthorPicker onChange={onChange} initialExpanded />);
  await act(async () => { pending.resolve(author); });
  expect(onChange).not.toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: "By Chef Lin" })).toBeEnabled();
});
