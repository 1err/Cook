import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
beforeEach(() => {
  vi.resetAllMocks();
  state.user = { id: "alice", email: "alice@example.com", email_verified: false };
  state.capabilities.mockResolvedValue({ password_recovery: true, email_verification: true });
  state.refreshUser.mockResolvedValue(undefined);
});

test("checking account status still refreshes when the email capability request fails", async () => {
  render(<AccountSecurity />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Verify email" })).toBeEnabled());
  state.capabilities.mockRejectedValueOnce(new Error("capability endpoint unavailable"));

  fireEvent.click(screen.getByRole("button", { name: "Check verification status" }));

  await waitFor(() => expect(state.refreshUser).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("status")).toHaveTextContent("Verification status updated");
  expect(screen.getByText("Email not verified")).toBeInTheDocument();
  expect(screen.queryByText("Email verified")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check verification status" })).toBeEnabled();
});

test("a stalled capability check cannot hold back the refreshed verified account", async () => {
  render(<AccountSecurity />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Verify email" })).toBeEnabled());
  state.capabilities.mockReturnValueOnce(new Promise(() => {}));
  state.refreshUser.mockImplementationOnce(async () => {
    state.user = { ...state.user, email_verified: true };
  });

  fireEvent.click(screen.getByRole("button", { name: "Check verification status" }));

  expect(await screen.findByText("Email verified")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Verify email" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Verification status updated");
  expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeEnabled();
});

test("failed status refresh remains retryable without claiming verification succeeded", async () => {
  state.refreshUser.mockRejectedValueOnce(new Error("offline"));
  render(<AccountSecurity />);
  fireEvent.click(screen.getByRole("button", { name: "Check verification status" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
  expect(screen.getByText("Email not verified")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check verification status" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Verification status updated");
});

test("verification requests preserve offline retry and offer resend only after success", async () => {
  state.requestEmailVerification.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true });
  render(<AccountSecurity />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Verify email" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

  const verification = within(screen.getByRole("region", { name: "Email verification" }));
  expect(await verification.findByRole("alert")).toHaveTextContent("Check your connection");
  expect(verification.queryByRole("status")).not.toBeInTheDocument();
  expect(verification.queryByRole("button", { name: "Resend verification link" })).not.toBeInTheDocument();
  fireEvent.click(verification.getByRole("button", { name: "Verify email" }));

  expect(await verification.findByRole("status")).toHaveTextContent("Check your email");
  expect(verification.queryByRole("alert")).not.toBeInTheDocument();
  state.requestEmailVerification.mockReturnValueOnce(new Promise(() => {}));
  fireEvent.click(verification.getByRole("button", { name: "Resend verification link" }));
  expect(verification.getByRole("button", { name: "Resend verification link" })).toHaveAttribute("aria-busy", "true");
  expect(verification.getByRole("button", { name: "Check verification status" })).toBeDisabled();
  expect(state.requestEmailVerification).toHaveBeenCalledTimes(3);
});

test("disabled email delivery cannot display a successful verification request", async () => {
  state.capabilities.mockResolvedValue({ password_recovery: false, email_verification: false });
  render(<AccountSecurity />);

  expect(await screen.findByText(/Account email is temporarily unavailable/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Verify email" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Check verification status" })).toBeEnabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(state.requestEmailVerification).not.toHaveBeenCalled();
});

test("verified accounts display their status in the verification group without resend actions", async () => {
  state.user.email_verified = true;
  render(<AccountSecurity />);

  const verification = within(screen.getByRole("region", { name: "Email verification" }));
  expect(verification.getByText("Email verified")).toBeInTheDocument();
  expect(verification.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete account" })).toBeInTheDocument();
});

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
