import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { RecipeAuthor } from "@cooking/shared";
import { AuthorPicker } from "./AuthorPicker";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), account: { id: "account-1", generation: 0 } }));
vi.mock("../lib/api", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return { useT: () => (key: string) => MESSAGE_MAP.en[key] ?? key };
});
vi.mock("../lib/useAccountScope", () => ({ useAccountScope: () => ({ accountId: mocks.account.id,
  capture: () => ({ ...mocks.account }), active: (actor: { id: string; generation: number }) => actor.id === mocks.account.id && actor.generation === mocks.account.generation,
}) }));
const author = { id: "author-1", name: "Lin's Kitchen", aliases: ["阿林"] };
beforeEach(() => { mocks.account.id = "account-1"; mocks.account.generation = 0; mocks.apiFetch.mockReset().mockImplementation(async () => new Response(JSON.stringify([author]))); });
afterEach(cleanup);

test("searches aliases and chooses an existing canonical author with the keyboard without creating one", async () => {
  const changed = vi.fn();
  render(<AuthorPicker onChange={changed} />);
  await userEvent.click(screen.getByRole("button", { name: "Add author" }));
  const input = screen.getByRole("combobox");
  await userEvent.type(input, "阿林");
  await screen.findByRole("option", { name: /Lin's Kitchen/ });
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(changed).toHaveBeenCalledWith(author);
  expect(mocks.apiFetch.mock.calls.some(([, options]) => options.method === "POST")).toBe(false);
  expect(mocks.apiFetch).toHaveBeenLastCalledWith(expect.stringContaining("q=%E9%98%BF%E6%9E%97"), expect.objectContaining({ headers: { "X-Chef-World-Account-ID": "account-1" } }));
});

test("creates only after an explicit save, supports chosen self-name and aliases, and uses the canonical response", async () => {
  const changed = vi.fn();
  mocks.apiFetch.mockImplementation(async (_url: string, options: RequestInit) => new Response(JSON.stringify(options.method === "POST" ? author : [])));
  render(<AuthorPicker onChange={changed} />);
  await userEvent.click(screen.getByRole("button", { name: "Add author" }));
  await userEvent.click(screen.getByRole("button", { name: "Use my chosen author name" }));
  await userEvent.type(screen.getByLabelText("Author name"), "My kitchen");
  await userEvent.type(screen.getByLabelText("Aliases (comma separated)"), "阿林, Lin, Lin");
  expect(changed).not.toHaveBeenCalled();
  expect(mocks.apiFetch.mock.calls.some(([, options]) => options.method === "POST")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith(author));
  const [, options] = mocks.apiFetch.mock.calls.find(([, options]) => options.method === "POST")!;
  expect(JSON.parse(options.body)).toEqual({ name: "My kitchen", aliases: ["阿林", "Lin"] });
});

test("cancel leaves the selected author unchanged and clearing is explicit", async () => {
  const changed = vi.fn();
  render(<AuthorPicker value={author} onChange={changed} />);
  await userEvent.click(screen.getByRole("button", { name: author.name }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(changed).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: author.name }));
  await userEvent.click(screen.getByRole("button", { name: "Clear author" }));
  expect(changed).toHaveBeenCalledWith(null);
});

test("retains a new name and aliases after a create failure and allows retry", async () => {
  const changed = vi.fn(); let attempts = 0;
  mocks.apiFetch.mockImplementation(async (_url: string, options: RequestInit) => options.method === "POST"
    ? new Response(JSON.stringify(author), { status: ++attempts === 1 ? 409 : 200 })
    : new Response("[]"));
  render(<AuthorPicker onChange={changed} />);
  await userEvent.click(screen.getByRole("button", { name: "Add author" }));
  await userEvent.click(screen.getByRole("button", { name: "Add a new author" }));
  await userEvent.type(screen.getByLabelText("Author name"), "Lin");
  await userEvent.type(screen.getByLabelText("Aliases (comma separated)"), "阿林");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not add author");
  expect(screen.getByLabelText("Author name")).toHaveValue("Lin");
  expect(screen.getByLabelText("Aliases (comma separated)")).toHaveValue("阿林");
  expect(changed).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith(author));
});

test("discards suggestions and pending creations when the account changes", async () => {
  let finishLookup!: (response: Response) => void; let finishCreate!: (response: Response) => void;
  mocks.apiFetch.mockImplementation((_url: string, options: RequestInit) => new Promise(resolve => {
    if (options.method === "POST") finishCreate = resolve; else finishLookup = resolve;
  }));
  const changed = vi.fn();
  const view = render(<AuthorPicker onChange={changed} />);
  await userEvent.click(screen.getByRole("button", { name: "Add author" }));
  await waitFor(() => expect(finishLookup).toBeDefined());
  const oldLookup = finishLookup;
  mocks.account.id = "account-2"; mocks.account.generation++;
  view.rerender(<AuthorPicker onChange={changed} />);
  await act(async () => oldLookup(new Response(JSON.stringify([author]))));
  expect(screen.queryByRole("option", { name: /Lin's Kitchen/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add a new author" }));
  await userEvent.type(screen.getByLabelText("Author name"), "Lin");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(finishCreate).toBeDefined());
  mocks.account.id = "account-3"; mocks.account.generation++;
  view.rerender(<AuthorPicker onChange={changed} />);
  await act(async () => finishCreate(new Response(JSON.stringify(author))));
  expect(changed).not.toHaveBeenCalled();
});

test("failed lookup explains the error and retries without clearing the query", async () => {
  let failed = true;
  mocks.apiFetch.mockImplementation(async () => new Response(JSON.stringify([author]), { status: failed ? 503 : 200 }));
  render(<AuthorPicker onChange={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Add author" }));
  await userEvent.type(screen.getByRole("combobox"), "Lin");
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load authors");
  failed = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("option", { name: /Lin's Kitchen/ })).toBeVisible();
  expect(screen.getByRole("combobox")).toHaveValue("Lin");
});

test("a long search query cannot create an over-limit name through the prefilled creation form", async () => {
  const changed = vi.fn();
  mocks.apiFetch.mockImplementation(async (_url: string, options: RequestInit) => new Response(JSON.stringify(options.method === "POST" ? author : [])));
  render(<AuthorPicker onChange={changed} />);
  await userEvent.click(screen.getByRole("button", { name: "Add author" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "x".repeat(81) } });
  await userEvent.click(screen.getByRole("button", { name: "Add a new author" }));
  expect(screen.getByLabelText("Author name")).toHaveValue("x".repeat(81));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(mocks.apiFetch.mock.calls.some(([, options]) => options.method === "POST")).toBe(false);
  fireEvent.change(screen.getByLabelText("Author name"), { target: { value: "x".repeat(80) } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith(author));
});
