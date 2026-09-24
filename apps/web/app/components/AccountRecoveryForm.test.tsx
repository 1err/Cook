import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MESSAGE_MAP } from "@cooking/shared";
import { AccountRecoveryForm } from "./AccountRecoveryForm";

const api = vi.hoisted(() => ({ capabilities: vi.fn(), requestPasswordReset: vi.fn(), confirmPasswordReset: vi.fn(), confirmEmailVerification: vi.fn() }));
const auth = vi.hoisted(() => ({ refreshUser: vi.fn() }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../lib/api", () => ({ webApiClient: { auth: api } }));
vi.mock("../lib/i18n", () => {
  const t = (key: string) => MESSAGE_MAP.en[key] ?? key;
  return { useT: () => t };
});

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/forgot-password");
  api.capabilities.mockResolvedValue({ password_recovery: true, email_verification: true });
  auth.refreshUser.mockResolvedValue(undefined);
});
afterEach(cleanup);

test("keeps the email on a failed request so the user can retry", async () => {
  api.requestPasswordReset.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ok: true });
  render(<AccountRecoveryForm mode="request" />);
  await screen.findByRole("button", { name: "Send reset link" });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "cook@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Email")).toHaveValue("cook@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(await screen.findByRole("status")).toHaveTextContent("If an account exists");
  expect(api.requestPasswordReset).toHaveBeenLastCalledWith("cook@example.com");
});

test("removes the fragment immediately and only resets after matching password confirmation", async () => {
  window.history.replaceState(null, "", "/reset-password#token=one-use-token");
  api.confirmPasswordReset.mockResolvedValue({ ok: true });
  render(<AccountRecoveryForm mode="reset" />);
  await screen.findByLabelText("New password");
  expect(window.location.hash).toBe("");
  expect(api.confirmPasswordReset).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-pass-123" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different" } });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match");
  expect(api.confirmPasswordReset).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "new-pass-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  await waitFor(() => expect(api.confirmPasswordReset).toHaveBeenCalledWith("one-use-token", "new-pass-123"));
  expect(await screen.findByRole("status")).toHaveTextContent("Sign in with your new password");
});

test("verification does not mutate on page load and preserves an expired-link recovery path", async () => {
  window.history.replaceState(null, "", "/verify-email#token=expired-token");
  api.confirmEmailVerification.mockRejectedValue({ status: 400 });
  render(<AccountRecoveryForm mode="verify" />);
  const button = await screen.findByRole("button", { name: "Verify email" });
  expect(api.confirmEmailVerification).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  expect(screen.getByRole("link", { name: "Account settings" })).toHaveAttribute("href", "/settings");
  expect(screen.queryByRole("button", { name: "Verify email" })).not.toBeInTheDocument();
});

test("a missing verification token provides a way to request a fresh link", async () => {
  window.history.replaceState(null, "", "/verify-email");
  render(<AccountRecoveryForm mode="verify" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  expect(screen.getByRole("link", { name: "Account settings" })).toHaveAttribute("href", "/settings");
  expect(screen.getByText(/request a new verification link from account settings/i)).toBeVisible();
});

test("verification retries a connection failure with the captured token and refreshes the account", async () => {
  window.history.replaceState(null, "", "/verify-email#token=retry-token");
  api.confirmEmailVerification.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ok: true });
  render(<AccountRecoveryForm mode="verify" />);
  fireEvent.click(await screen.findByRole("button", { name: "Verify email" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Email verified");
  await waitFor(() => expect(auth.refreshUser).toHaveBeenCalledOnce());
  expect(api.confirmEmailVerification).toHaveBeenLastCalledWith("retry-token");
  expect(screen.getByRole("link", { name: "Continue to Chef World" })).toHaveAttribute("href", "/library");
  expect(screen.getByRole("link", { name: "Account settings" })).toHaveAttribute("href", "/settings");
});

test("a refresh failure does not undo successful email verification or reuse its token", async () => {
  window.history.replaceState(null, "", "/verify-email#token=successful-token");
  api.confirmEmailVerification.mockResolvedValue({ ok: true });
  auth.refreshUser.mockRejectedValue(new Error("offline"));
  render(<AccountRecoveryForm mode="verify" />);
  fireEvent.click(await screen.findByRole("button", { name: "Verify email" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Email verified");
  await waitFor(() => expect(auth.refreshUser).toHaveBeenCalledOnce());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Verify email" })).not.toBeInTheDocument();
});

test("unconfigured email cannot show a false message-sent success", async () => {
  api.capabilities.mockResolvedValue({ password_recovery: false, email_verification: false });
  render(<AccountRecoveryForm mode="request" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
  expect(screen.queryByRole("button", { name: "Send reset link" })).not.toBeInTheDocument();
  expect(api.requestPasswordReset).not.toHaveBeenCalled();
});

test("a long multilingual password can be corrected without losing the reset link", async () => {
  window.history.replaceState(null, "", "/reset-password#token=valid-token");
  api.confirmPasswordReset.mockResolvedValue({ ok: true });
  render(<AccountRecoveryForm mode="reset" />);
  await screen.findByLabelText("New password");
  for (const label of ["New password", "Confirm password"]) fireEvent.change(screen.getByLabelText(label), { target: { value: "密".repeat(25) } });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("shorter password");
  expect(api.confirmPasswordReset).not.toHaveBeenCalled();
  for (const label of ["New password", "Confirm password"]) fireEvent.change(screen.getByLabelText(label), { target: { value: "密".repeat(20) } });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  await waitFor(() => expect(api.confirmPasswordReset).toHaveBeenCalledWith("valid-token", "密".repeat(20)));
});

test("password minimum length counts Unicode characters consistently with the server", async () => {
  window.history.replaceState(null, "", "/reset-password#token=valid-token");
  render(<AccountRecoveryForm mode="reset" />);
  await screen.findByLabelText("New password");
  for (const label of ["New password", "Confirm password"]) fireEvent.change(screen.getByLabelText(label), { target: { value: "🔐".repeat(4) } });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
  expect(api.confirmPasswordReset).not.toHaveBeenCalled();
});
