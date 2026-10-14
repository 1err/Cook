import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MESSAGE_MAP } from "@cooking/shared";
import type React from "react";
import ModerationPage from "./page";

const { list, resolve, auth } = vi.hoisted(() => ({
  list: vi.fn(), resolve: vi.fn(), auth: { user: { id: "admin", email: "owner@example.com", is_admin: true }, loading: false },
}));
vi.mock("../lib/api", () => ({ webApiClient: { moderation: { list, resolve } } }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../lib/i18n", () => ({ useT: () => (key: string) => MESSAGE_MAP.en[key] ?? key }));
vi.mock("../components/RequireAuth", () => ({ RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const report = { id: "report-1", recipe_id: "recipe-1", owner_id: "owner-1", reporter_id: "reporter-1", reason: "privacy", notes: "Personal information", status: "pending", created_at: "2026-10-13T12:00:00Z", recipe: { id: "recipe-1", title: "Shared noodle recipe", description: "Reported recipe snapshot.", ingredients: [], steps: [], thumbnail_url: null } };
beforeEach(() => { vi.clearAllMocks(); auth.user.is_admin = true; list.mockResolvedValue({ reports: [report], total: 1 }); resolve.mockResolvedValue({ ...report, status: "resolved" }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("does not fetch or expose report data for a non-admin account", () => {
  auth.user.is_admin = false;
  render(<ModerationPage />);
  expect(list).not.toHaveBeenCalled();
  expect(screen.queryByText("Shared noodle recipe")).not.toBeInTheDocument();
});

test("shows a reviewable sanitized snapshot and confirms a moderation action", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<ModerationPage />);
  expect(await screen.findByText("Shared noodle recipe")).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: /action/i }), { target: { value: "disable_library" } });
  list.mockResolvedValue({ reports: [], total: 0 });
  fireEvent.click(screen.getByRole("button", { name: /apply/i }));
  await waitFor(() => expect(resolve).toHaveBeenCalledWith("report-1", "disable_library", undefined, "admin"));
  await waitFor(() => expect(screen.queryByText("Shared noodle recipe")).not.toBeInTheDocument());
});

test("a server authorization failure reveals no report content and offers retry", async () => {
  list.mockRejectedValueOnce(new Error("Forbidden"));
  render(<ModerationPage />);
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("Shared noodle recipe")).not.toBeInTheDocument();
});


test("a resolution completed after a tab switch refreshes the current list", async () => {
  let finish!: (value: unknown) => void;
  const completed = { ...report, status: "resolved", resolution: "dismiss" };
  list.mockReset();
  list.mockImplementation(async ({ status }: { status: string }) => ({ reports: [status === "resolved" ? completed : report], total: 1 }));
  resolve.mockReturnValueOnce(new Promise((done) => { finish = done; }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<ModerationPage />);
  await screen.findByText("Shared noodle recipe");
  fireEvent.click(screen.getByRole("button", { name: /apply/i }));
  fireEvent.click(screen.getByRole("button", { name: "Resolved" }));
  await screen.findByText("Shared noodle recipe");
  await act(async () => { finish(completed); });
  await waitFor(() => expect(list.mock.calls.filter(([args]) => args.status === "resolved")).toHaveLength(2));
  expect(await screen.findByText("Shared noodle recipe")).toBeVisible();
});
