import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { GoogleSignInButton } from "./GoogleSignInButton";
import LoginPage from "../login/page";
import RegisterPage from "../register/page";

const { push, refreshUser, apiFetch } = vi.hoisted(() => ({
  push: vi.fn(), refreshUser: vi.fn(), apiFetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/login" }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ refreshUser }) }));
vi.mock("../lib/api", () => ({ apiFetch }));

type GoogleConfig = { client_id: string; nonce: string; callback: (response: { credential: string }) => void; ux_mode: string; auto_select: boolean; use_fedcm_for_button: boolean; button_auto_select: boolean };
let configuration: GoogleConfig;
let renderOptions: Record<string, unknown>;
const googleWindow = window as typeof window & { google?: unknown };
function installGoogle() {
  googleWindow.google = { accounts: { id: {
    initialize: (config: GoogleConfig) => { configuration = config; },
    renderButton: (container: HTMLElement, options: Record<string, unknown>) => {
      renderOptions = options;
      const button = document.createElement("button");
      button.textContent = "Continue with Google";
      button.onclick = () => configuration.callback({ credential: "google-id-token" });
      container.appendChild(button);
    },
  } } };
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
function renderButton(props: React.ComponentProps<typeof GoogleSignInButton> = {}) {
  return render(<I18nProvider><GoogleSignInButton {...props} /></I18nProvider>);
}
async function googleButton() { return screen.findByRole("button", { name: "Continue with Google" }); }

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/login");
  installGoogle();
  refreshUser.mockResolvedValue(undefined);
  apiFetch.mockImplementation(async (path: string) => {
    if (path === "/auth/google/config") return response({ client_id: "chef-world.apps.googleusercontent.com" });
    if (path === "/auth/google/nonce") return response({ nonce: "browser-challenge" });
    if (path === "/auth/google") return response({ access_token: "session", token_type: "bearer" });
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(() => {
  cleanup();
  delete googleWindow.google;
  document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').forEach((script) => script.remove());
  vi.useRealTimers();
});

test("disabled Google configuration leaves email sign in available without loading Google's script", async () => {
  apiFetch.mockResolvedValue(response({ client_id: null }));
  const { container } = renderButton();
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/auth/google/config", expect.anything()));
  expect(container).toBeEmptyDOMElement();
  expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeNull();
  expect(apiFetch).not.toHaveBeenCalledWith("/auth/google/nonce", expect.anything());
});

test("uses the official popup button with a server nonce, then restores the pending import", async () => {
  window.history.replaceState({}, "", "/login?redirect=%2Fimport%3Fshare%3Dpending");
  renderButton();
  fireEvent.click(await googleButton());
  await waitFor(() => expect(push).toHaveBeenCalledWith("/import?share=pending"));
  expect(configuration).toMatchObject({ client_id: "chef-world.apps.googleusercontent.com", nonce: "browser-challenge", ux_mode: "popup", auto_select: false, use_fedcm_for_button: true, button_auto_select: false });
  expect(renderOptions).toMatchObject({ theme: "outline", text: "continue_with", locale: "en" });
  expect(apiFetch).toHaveBeenCalledWith("/auth/google", expect.objectContaining({ method: "POST", body: JSON.stringify({ credential: "google-id-token" }) }));
  expect(refreshUser).toHaveBeenCalledOnce();
  expect(refreshUser).toHaveBeenCalledWith({ newSession: true });
});

test("Google sign in rejects an external post-login redirect", async () => {
  window.history.replaceState({}, "", "/login?redirect=%2F%2Fevil.example");
  renderButton();
  fireEvent.click(await googleButton());
  await waitFor(() => expect(push).toHaveBeenCalledWith("/library"));
});

test("linking an existing account asks for its password and reuses the Google credential and challenge", async () => {
  let loginAttempts = 0;
  apiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/auth/google/config") return response({ client_id: "client" });
    if (path === "/auth/google/nonce") return response({ nonce: "browser-challenge" });
    if (path === "/auth/google") {
      loginAttempts += 1;
      if (loginAttempts === 1) return response({ detail: { code: "google_password_required", message: "Confirm your existing password" } }, 409);
      expect(JSON.parse(String(options?.body))).toEqual({ credential: "google-id-token", password: "existing-password" });
      return response({ access_token: "session", token_type: "bearer" });
    }
    throw new Error(path);
  });
  renderButton();
  fireEvent.click(await googleButton());
  const password = await screen.findByLabelText("Your Chef World password");
  expect(push).not.toHaveBeenCalled();
  fireEvent.change(password, { target: { value: "existing-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Google and sign in" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/library"));
  expect(apiFetch.mock.calls.filter(([path]) => path === "/auth/google/nonce")).toHaveLength(1);
});

test("an existing password can be retried after an incorrect password without resetting the challenge", async () => {
  let loginAttempts = 0;
  apiFetch.mockImplementation(async (path: string) => {
    if (path === "/auth/google/config") return response({ client_id: "client" });
    if (path === "/auth/google/nonce") return response({ nonce: "browser-challenge" });
    if (++loginAttempts === 1) return response({ detail: { code: "google_password_required", message: "Confirm password" } }, 409);
    if (loginAttempts === 2) return response({ detail: "Incorrect password" }, 401);
    return response({ access_token: "session", token_type: "bearer" });
  });
  renderButton();
  fireEvent.click(await googleButton());
  fireEvent.change(await screen.findByLabelText("Your Chef World password"), { target: { value: "wrong-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Google and sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password");
  fireEvent.change(screen.getByLabelText("Your Chef World password"), { target: { value: "correct-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Google and sign in" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/library"));
  expect(apiFetch.mock.calls.filter(([path]) => path === "/auth/google/nonce")).toHaveLength(1);
});

test("reauthentication passes the credential to its caller without signing in or redirecting", async () => {
  const onCredential = vi.fn().mockResolvedValue(undefined);
  renderButton({ onCredential, label: "Confirm your Google account" });
  fireEvent.click(await googleButton());
  await waitFor(() => expect(onCredential).toHaveBeenCalledWith("google-id-token"));
  expect(apiFetch.mock.calls.some(([path]) => path === "/auth/google")).toBe(false);
  expect(refreshUser).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
  expect(screen.queryByText("or continue with email")).not.toBeInTheDocument();
});

test("a popup callback from an unmounted auth page cannot sign in", async () => {
  const { unmount } = renderButton();
  await googleButton();
  const callback = configuration.callback;
  unmount();
  act(() => callback({ credential: "stale-token" }));
  expect(apiFetch.mock.calls.some(([path]) => path === "/auth/google")).toBe(false);
  expect(push).not.toHaveBeenCalled();
});

test("an auth response arriving after unmount cannot refresh or redirect", async () => {
  let resolveLogin!: (response: Response) => void;
  const original = apiFetch.getMockImplementation()!;
  apiFetch.mockImplementation((path: string, options?: RequestInit) => path === "/auth/google" ? new Promise<Response>((resolve) => { resolveLogin = resolve; }) : original(path, options));
  const { unmount } = renderButton();
  fireEvent.click(await googleButton());
  unmount();
  await act(async () => resolveLogin(response({ access_token: "session", token_type: "bearer" })));
  expect(refreshUser).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

test("disabled reauthentication cannot pass a stale popup credential to its caller", async () => {
  const onCredential = vi.fn().mockResolvedValue(undefined);
  const view = renderButton({ onCredential });
  await googleButton();
  const callback = configuration.callback;
  view.rerender(<I18nProvider><GoogleSignInButton onCredential={onCredential} disabled /></I18nProvider>);
  act(() => callback({ credential: "stale-token" }));
  expect(onCredential).not.toHaveBeenCalled();
});

test("a configuration outage offers recovery without preventing the email form", async () => {
  apiFetch.mockRejectedValueOnce(new Error("Failed to fetch"));
  renderButton();
  fireEvent.click(await screen.findByRole("button", { name: "Retry Google sign in" }));
  expect(await googleButton()).toBeVisible();
});

test("a failed Google script load can be retried with a fresh script", async () => {
  delete googleWindow.google;
  renderButton();
  await waitFor(() => expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).not.toBeNull());
  fireEvent.error(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')!);
  fireEvent.click(await screen.findByRole("button", { name: "Retry Google sign in" }));
  await waitFor(() => expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).not.toBeNull());
  installGoogle();
  fireEvent.load(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')!);
  expect(await googleButton()).toBeVisible();
});


test.each([["login", LoginPage], ["register", RegisterPage]] as const)("%s offers Google before the email form", async (_name, Page) => {
  const { container } = render(<I18nProvider><Page /></I18nProvider>);
  const button = await googleButton();
  const emailInput = screen.getByLabelText("Email");
  expect(button.compareDocumentPosition(emailInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelectorAll("form")).toHaveLength(1);
  expect(screen.getByText("or continue with email")).toBeVisible();
});

test("the email submit button waits while Google is signing in", async () => {
  const original = apiFetch.getMockImplementation()!;
  apiFetch.mockImplementation((path: string, options?: RequestInit) => path === "/auth/google" ? new Promise(() => {}) : original(path, options));
  render(<I18nProvider><LoginPage /></I18nProvider>);
  fireEvent.click(await googleButton());
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
});

test("reauthentication errors are visible and allow a fresh Google challenge", async () => {
  const onCredential = vi.fn().mockRejectedValue(new Error("The Google account must match your Chef World account"));
  renderButton({ onCredential });
  fireEvent.click(await googleButton());
  expect(await screen.findByRole("alert")).toHaveTextContent("The Google account must match your Chef World account");
  fireEvent.click(screen.getByRole("button", { name: "Retry Google sign in" }));
  await googleButton();
  expect(apiFetch.mock.calls.filter(([path]) => path === "/auth/google/nonce")).toHaveLength(2);
  expect(push).not.toHaveBeenCalled();
});


test("reauthentication prepares a fresh challenge when its caller remains open", async () => {
  const onCredential = vi.fn().mockResolvedValue(undefined);
  renderButton({ onCredential });
  fireEvent.click(await googleButton());
  await waitFor(() => expect(apiFetch.mock.calls.filter(([path]) => path === "/auth/google/nonce")).toHaveLength(2));
  fireEvent.click(await googleButton());
  await waitFor(() => expect(onCredential).toHaveBeenCalledTimes(2));
});

test("the linking password is cleared immediately after submission", async () => {
  const original = apiFetch.getMockImplementation()!;
  let loginAttempts = 0;
  apiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path !== "/auth/google") return original(path, options);
    if (++loginAttempts === 1) return Promise.resolve(response({ detail: { code: "google_password_required", message: "Confirm password" } }, 409));
    return new Promise(() => {});
  });
  renderButton();
  fireEvent.click(await googleButton());
  const passwordInput = await screen.findByLabelText("Your Chef World password");
  fireEvent.change(passwordInput, { target: { value: "secret-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Google and sign in" }));
  expect(passwordInput).toHaveValue("");
});

test("reauthentication refreshes its challenge after the caller temporarily disables verification", async () => {
  let finish!: () => void;
  const onCredential = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const view = renderButton({ onCredential });
  fireEvent.click(await googleButton());
  view.rerender(<I18nProvider><GoogleSignInButton onCredential={onCredential} disabled /></I18nProvider>);
  await act(async () => finish());
  await waitFor(() => expect(apiFetch.mock.calls.filter(([path]) => path === "/auth/google/nonce")).toHaveLength(2));
  view.rerender(<I18nProvider><GoogleSignInButton onCredential={onCredential} /></I18nProvider>);
  fireEvent.click(await googleButton());
  expect(onCredential).toHaveBeenCalledTimes(2);
});

test("switching language during account linking clears the old password and prepares a usable fresh challenge", async () => {
  const original = apiFetch.getMockImplementation()!;
  let loginAttempts = 0;
  apiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path !== "/auth/google") return original(path, options);
    loginAttempts += 1;
    if (loginAttempts <= 2) return Promise.resolve(response({ detail: { code: "google_password_required", message: "Confirm password" } }, 409));
    return Promise.resolve(response({ access_token: "session", token_type: "bearer" }));
  });
  render(<I18nProvider><LoginPage /></I18nProvider>);
  fireEvent.click(await googleButton());
  fireEvent.change(await screen.findByLabelText("Your Chef World password"), { target: { value: "private-password" } });
  fireEvent.click(screen.getByRole("button", { name: "中文" }));
  await waitFor(() => expect(apiFetch.mock.calls.filter(([path]) => path === "/auth/google/nonce")).toHaveLength(2));
  expect(screen.queryByLabelText("你的 Chef World 密码")).not.toBeInTheDocument();
  expect(renderOptions).toMatchObject({ locale: "zh-CN" });
  fireEvent.click(await googleButton());
  const password = await screen.findByLabelText("你的 Chef World 密码");
  expect(password).toHaveValue("");
  fireEvent.change(password, { target: { value: "current-password" } });
  fireEvent.click(screen.getByRole("button", { name: "关联 Google 并登录" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/library"));
});

test("a Google-linked account that still requires email verification keeps its destination through check-email", async () => {
  const original = apiFetch.getMockImplementation()!;
  apiFetch.mockImplementation((path: string, options?: RequestInit) => path === "/auth/google"
    ? Promise.resolve(response({ access_token: "session", token_type: "bearer", email_verification_required: true, email_verified: false }))
    : original(path, options));
  window.history.replaceState({}, "", "/login?redirect=%2Fplanner");
  renderButton();
  fireEvent.click(await googleButton());
  await waitFor(() => expect(push).toHaveBeenCalledWith("/check-email?redirect=%2Fplanner"));
});
