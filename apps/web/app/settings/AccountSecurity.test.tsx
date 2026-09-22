import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MESSAGE_MAP } from "@cooking/shared";
import { AccountSecurity } from "./AccountSecurity";

const state = vi.hoisted(() => ({
  deleteAccount: vi.fn(), logoutAll: vi.fn(), refreshUser: vi.fn(), requestEmailVerification: vi.fn(), capabilities: vi.fn(),
  user: { id: "alice", email: "alice@example.com", email_verified: false },
}));
vi.mock("../lib/auth", () => ({ useAuth: () => state }));
vi.mock("../lib/api", () => ({ webApiClient: { auth: state } }));
vi.mock("../lib/i18n", () => {
  const t = (key: string) => MESSAGE_MAP.en[key] ?? key;
  return { useT: () => t };
});
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); state.capabilities.mockResolvedValue({ email_verification: true }); });

test("requires confirmation and current password before deletion; retains the account after rejection", async () => {
  state.deleteAccount.mockRejectedValueOnce({ status: 403 }).mockResolvedValueOnce(undefined);
  render(<AccountSecurity />);
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  expect(screen.getByRole("button", { name: "Delete account permanently" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong-pass" } });
  fireEvent.click(screen.getByLabelText("I understand that account deletion is permanent."));
  fireEvent.click(screen.getByRole("button", { name: "Delete account permanently" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("account has not been deleted");
  expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "correct-pass" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete account permanently" }));
  await waitFor(() => expect(state.deleteAccount).toHaveBeenLastCalledWith("correct-pass"));
});

test("failed global sign-out stays recoverable and reports failure", async () => {
  state.logoutAll.mockRejectedValue(new Error("network"));
  render(<AccountSecurity />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
  expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeEnabled();
});
