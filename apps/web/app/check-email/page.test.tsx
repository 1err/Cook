import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MESSAGE_MAP } from "@cooking/shared";
import CheckEmailPage from "./page";

const state = vi.hoisted(() => ({
  replace: vi.fn(), refreshUser: vi.fn(), logout: vi.fn(), requestEmailVerification: vi.fn(),
  user: { id: "new", email: "new@example.com", email_verified: false, email_verification_required: true },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }), usePathname: () => window.location.pathname }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ ...state, loading: false }) }));
vi.mock("../lib/api", () => ({ webApiClient: { auth: state } }));
vi.mock("../lib/i18n", () => {
  const t = (key: string, vars?: Record<string, string>) => (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => vars?.[name] ?? "");
  return { useT: () => t, useI18n: () => ({ t, language: "en", setLanguage: vi.fn() }) };
});
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  state.user = { id: "new", email: "new@example.com", email_verified: false, email_verification_required: true };
  state.refreshUser.mockResolvedValue(undefined);
  state.requestEmailVerification.mockResolvedValue({ ok: true });
  window.history.replaceState({}, "", "/check-email?redirect=%2Fplanner");
});

test("onboarding names the recipient and does not automatically replace the signup email link", () => {
  render(<CheckEmailPage />);
  expect(screen.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(screen.getByText(/new@example.com/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Resend verification link" })).toBeEnabled();
  expect(screen.getByRole("link", { name: "Account settings" })).toHaveAttribute("href", "/settings");
  expect(state.requestEmailVerification).not.toHaveBeenCalled();
  expect(state.replace).not.toHaveBeenCalled();
});

test("checking an unverified account remains on onboarding without a false success", async () => {
  render(<CheckEmailPage />);
  fireEvent.click(screen.getByRole("button", { name: "I’ve verified my email" }));
  expect(await screen.findByRole("status")).toHaveTextContent("not verified yet");
  expect(state.replace).not.toHaveBeenCalled();
});

test("a verified server response continues to the original destination", async () => {
  state.refreshUser.mockImplementationOnce(async () => { state.user = { ...state.user, email_verified: true }; });
  render(<CheckEmailPage />);
  fireEvent.click(screen.getByRole("button", { name: "I’ve verified my email" }));
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/planner"));
  expect(screen.queryByText(/not verified yet/)).not.toBeInTheDocument();
});

test("failed resend stays retryable and only acknowledges a successful request", async () => {
  state.requestEmailVerification.mockRejectedValueOnce({ status: 503 });
  render(<CheckEmailPage />);
  fireEvent.click(screen.getByRole("button", { name: "Resend verification link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Resend verification link" }));
  expect(await screen.findByRole("status")).toHaveTextContent("link has been requested");
});

test("failed status checks preserve retry and do not unlock the app", async () => {
  state.refreshUser.mockRejectedValueOnce(new Error("offline"));
  render(<CheckEmailPage />);
  fireEvent.click(screen.getByRole("button", { name: "I’ve verified my email" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
  expect(screen.getByRole("button", { name: "I’ve verified my email" })).toBeEnabled();
  expect(state.replace).not.toHaveBeenCalled();
});

test("verified accounts cannot follow an external onboarding redirect", async () => {
  state.user.email_verified = true;
  window.history.replaceState({}, "", "/check-email?redirect=%2F%2Fevil.example");
  render(<CheckEmailPage />);
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/library"));
});

test.each(["/check-email#done", "/old/../check-email?redirect=%2Fplanner"])("verification cannot redirect back into onboarding via %s", async (destination) => {
  state.user.email_verified = true;
  window.history.replaceState({}, "", `/check-email?redirect=${encodeURIComponent(destination)}`);
  render(<CheckEmailPage />);
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/library"));
});
