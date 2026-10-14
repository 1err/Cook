import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MESSAGE_MAP } from "@cooking/shared";
import { BlockUserButton, ReportRecipeControl } from "./SharingSafety";

const { reportRecipe, blockUser, blockRecipeAuthor, actor } = vi.hoisted(() => ({
  reportRecipe: vi.fn(), blockUser: vi.fn(), blockRecipeAuthor: vi.fn(), actor: { id: "viewer-1" },
}));
vi.mock("../../lib/api", () => ({ webApiClient: { users: { reportRecipe, blockUser, blockRecipeAuthor } } }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: actor }) }));
vi.mock("../../lib/i18n", () => ({ useT: () => (key: string) => MESSAGE_MAP.en[key] ?? key }));
beforeEach(() => {
  vi.clearAllMocks();
  actor.id = "viewer-1";
  reportRecipe.mockResolvedValue({ id: "report-1", status: "pending" });
  blockUser.mockResolvedValue({ ok: true });
  blockRecipeAuthor.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("only submits a report after the user selects the reason and submits", async () => {
  render(<ReportRecipeControl recipeId="recipe-1" />);
  expect(reportRecipe).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Report recipe" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "privacy" } });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "My personal information is included." } });
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(() => expect(reportRecipe).toHaveBeenCalledWith("recipe-1", "privacy", "My personal information is included.", "viewer-1"));
  expect(await screen.findByRole("status")).toHaveTextContent("Report sent");
});

test("a rejected report stays open and can be retried", async () => {
  reportRecipe.mockRejectedValueOnce(new Error("Unavailable"));
  render(<ReportRecipeControl recipeId="recipe-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Report recipe" }));
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(MESSAGE_MAP.en["safety.failed"]);
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
  await screen.findByRole("status");
  expect(reportRecipe).toHaveBeenCalledTimes(2);
});

test("blocking requires confirmation and hides content only after server success", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const onBlocked = vi.fn();
  render(<BlockUserButton userId="friend-1" onBlocked={onBlocked} />);
  fireEvent.click(screen.getByRole("button", { name: "Block user" }));
  expect(blockUser).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Block user" }));
  await waitFor(() => expect(blockUser).toHaveBeenCalledWith("friend-1", "viewer-1"));
  expect(onBlocked).toHaveBeenCalledTimes(1);
});


test("a report response from the previous account does not update the new account", async () => {
  let finish!: (value: unknown) => void;
  reportRecipe.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<ReportRecipeControl recipeId="recipe-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Report recipe" }));
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
  actor.id = "viewer-2";
  rerender(<ReportRecipeControl recipeId="recipe-1" />);
  await act(async () => { finish({ id: "report-1", status: "pending" }); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Report recipe" })).toBeEnabled();
  expect(reportRecipe).toHaveBeenCalledWith("recipe-1", "objectionable", undefined, "viewer-1");
});

test("a late block response cannot hide the next account's content", async () => {
  let finish!: (value: unknown) => void;
  blockUser.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const onBlocked = vi.fn();
  const { rerender } = render(<BlockUserButton userId="friend-1" onBlocked={onBlocked} />);
  fireEvent.click(screen.getByRole("button", { name: "Block user" }));
  actor.id = "viewer-2";
  rerender(<BlockUserButton userId="friend-1" onBlocked={onBlocked} />);
  await act(async () => { finish({ ok: true }); });
  expect(onBlocked).not.toHaveBeenCalled();
});
