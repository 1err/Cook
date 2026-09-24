import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LoginPage from "../login/page";
import RegisterPage from "../register/page";

const { push, response } = vi.hoisted(() => ({ push: vi.fn(), response: { required: false } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => window.location.pathname }));
vi.mock("./api", () => ({ apiFetch: async () => new Response(JSON.stringify({ email_verification_required: response.required, email_verified: false })) }));
vi.mock("./auth", () => ({ useAuth: () => ({ refreshUser: async () => {} }) }));
vi.mock("./i18n", () => ({ useT: () => (key: string) => key, useI18n: () => ({ language: "en", setLanguage: vi.fn(), t: (key: string) => key }) }));

beforeEach(() => { push.mockClear(); response.required = false; });

test.each([
  ["login", LoginPage, "/library"],
  ["register", RegisterPage, "/check-email?redirect=%2Flibrary"],
] as const)("%s rejects a protocol-relative post-auth redirect", async (_name, Page, destination) => {
  window.history.replaceState({}, "", "/login?redirect=%2F%2Fevil.example%2Fphishing");
  const { container } = render(<Page />);
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(push).toHaveBeenCalledWith(destination));
});

test("signing back in to a pending new account resumes verification with its app destination", async () => {
  response.required = true;
  window.history.replaceState({}, "", "/login?redirect=%2Fplanner");
  const { container } = render(<LoginPage />);
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(push).toHaveBeenCalledWith("/check-email?redirect=%2Fplanner"));
});


afterEach(() => { cleanup(); window.history.replaceState({}, "", "/login"); });
test.each([
  [LoginPage, "auth.createAccount", "/register"],
  [RegisterPage, "nav.signIn", "/login"],
] as const)("keeps pending share when switching auth forms", async (Page, label, target) => {
  const redirect = "/import?share=33888241-5c9f-4c61-a797-1c4e7a970e05";
  window.history.replaceState({}, "", `/login?redirect=${encodeURIComponent(redirect)}`);
  render(<Page />);
  await waitFor(() => expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", `${target}?redirect=${encodeURIComponent(redirect)}`));
});
