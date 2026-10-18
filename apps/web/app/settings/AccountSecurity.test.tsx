import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MESSAGE_MAP } from "@cooking/shared";
import { AccountSecurity } from "./AccountSecurity";

const state = vi.hoisted(() => ({
  deleteAccount: vi.fn(), logoutAll: vi.fn(), refreshUser: vi.fn(), requestEmailVerification: vi.fn(), capabilities: vi.fn(),
  apiFetch: vi.fn(),
  user: { id: "alice", email: "alice@example.com", email_verified: false } as { id: string; email: string; email_verified: boolean; has_password?: boolean; auth_providers?: string[] },
}));
const navigation = vi.hoisted(() => ({ search: "", router: { replace: vi.fn(), push: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("../lib/auth", () => ({ useAuth: () => state }));
vi.mock("../lib/api", () => ({ apiFetch: state.apiFetch, webApiClient: { auth: state } }));
vi.mock("../lib/i18n", () => {
  const t = (key: string) => MESSAGE_MAP.en[key] ?? key;
  return { useT: () => t, useI18n: () => ({ t, language: "en" }) };
});
type GoogleConfiguration = { callback: (response: { credential: string }) => void };
let googleConfiguration: GoogleConfiguration;
const googleWindow = window as typeof window & { google?: unknown };
afterEach(() => { cleanup(); delete googleWindow.google; });
beforeEach(() => {
  vi.resetAllMocks();
  navigation.search = "";
  navigation.router.replace.mockImplementation((url: string) => {
    navigation.search = new URL(url, "http://localhost").search.slice(1);
  });
  state.user = { id: "alice", email: "alice@example.com", email_verified: false };
  state.capabilities.mockResolvedValue({ password_recovery: true, email_verification: true });
  state.refreshUser.mockResolvedValue(undefined);
  state.apiFetch.mockImplementation(async (path: string) => {
    if (path === "/auth/google/config") return new Response('{"client_id":"chef-world.apps.googleusercontent.com"}');
    if (path === "/auth/google/nonce") return new Response('{"nonce":"deletion-challenge"}');
    throw new Error(`Unexpected request: ${path}`);
  });
  googleWindow.google = { accounts: { id: {
    initialize: (configuration: GoogleConfiguration) => { googleConfiguration = configuration; },
    renderButton: (container: HTMLElement) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Continue with Google";
      button.onclick = () => googleConfiguration.callback({ credential: "google-deletion-token" });
      container.appendChild(button);
    },
  } } };
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

test("a menu deletion request opens and focuses confirmation without deleting the account", async () => {
  navigation.search = "delete=1&from=menu";
  render(<AccountSecurity />);

  const form = await screen.findByRole("form", { name: /^Delete account$/ });
  expect(form).toHaveAttribute("id", "delete-account");
  expect(form).toHaveFocus();
  expect(screen.getByLabelText("Current password")).toHaveValue("");
  expect(screen.getByRole("checkbox", { name: "I understand that account deletion is permanent." })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Delete account permanently" })).toBeDisabled();
  expect(navigation.router.replace).toHaveBeenCalledWith("/settings?from=menu", { scroll: false });
  expect(state.deleteAccount).not.toHaveBeenCalled();
});

test("cancel clears confirmation and password, restores focus and permits a fresh menu request", async () => {
  navigation.search = "delete=1";
  const view = render(<AccountSecurity />);
  await screen.findByRole("form", { name: /^Delete account$/ });
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "sample-current-password" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "I understand that account deletion is permanent." }));
  fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));

  expect(screen.queryByRole("form", { name: /^Delete account$/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Delete account$/ })).toHaveFocus();
  expect(navigation.search).toBe("");
  expect(state.deleteAccount).not.toHaveBeenCalled();

  navigation.search = "delete=1";
  view.rerender(<AccountSecurity />);
  expect(await screen.findByRole("form", { name: /^Delete account$/ })).toHaveFocus();
  expect(screen.getByLabelText("Current password")).toHaveValue("");
  expect(screen.getByRole("checkbox", { name: "I understand that account deletion is permanent." })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Delete account permanently" })).toBeDisabled();
  expect(state.deleteAccount).not.toHaveBeenCalled();
});

test.each(["", "delete=0", "delete=true"])("ordinary settings visits do not open deletion confirmation (%s)", async (search) => {
  navigation.search = search;
  render(<AccountSecurity />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Verify email" })).toBeEnabled());
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  expect(navigation.router.replace).not.toHaveBeenCalled();
  expect(state.deleteAccount).not.toHaveBeenCalled();
});


test("Google-only deletion requires permanent confirmation and a Google credential without asking for a password", async () => {
  state.user = { ...state.user, has_password: false, auth_providers: ["google"] };
  render(<AccountSecurity />);
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  const googleButton = await screen.findByRole("button", { name: "Continue with Google" });
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete account permanently" })).not.toBeInTheDocument();
  fireEvent.click(googleButton);
  expect(state.deleteAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("I understand that account deletion is permanent."));
  fireEvent.click(googleButton);
  await waitFor(() => expect(state.deleteAccount).toHaveBeenCalledWith({ google_credential: "google-deletion-token" }));
  expect(navigation.router.push).not.toHaveBeenCalled();
});

test("a rejected Google deletion retains confirmation and the account, then permits a fresh Google attempt", async () => {
  state.user = { ...state.user, has_password: false, auth_providers: ["google"] };
  state.deleteAccount.mockRejectedValueOnce({ status: 403 }).mockResolvedValueOnce(undefined);
  render(<AccountSecurity />);
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  fireEvent.click(screen.getByLabelText("I understand that account deletion is permanent."));
  fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Google could not confirm this account. Your account has not been deleted.");
  expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  expect(screen.getByLabelText("I understand that account deletion is permanent.")).toBeChecked();
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  await waitFor(() => expect(state.apiFetch.mock.calls.filter(([path]) => path === "/auth/google/nonce")).toHaveLength(2));
  fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
  await waitFor(() => expect(state.deleteAccount).toHaveBeenCalledTimes(2));
});

test.each([true, undefined])("password-capable and legacy accounts keep password confirmation (has_password=%s)", async (hasPassword) => {
  state.user = { ...state.user, has_password: hasPassword, auth_providers: ["google"] };
  render(<AccountSecurity />);
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  expect(screen.getByLabelText("Current password")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current-password" } });
  fireEvent.click(screen.getByLabelText("I understand that account deletion is permanent."));
  fireEvent.click(screen.getByRole("button", { name: "Delete account permanently" }));
  await waitFor(() => expect(state.deleteAccount).toHaveBeenCalledWith("current-password"));
});
