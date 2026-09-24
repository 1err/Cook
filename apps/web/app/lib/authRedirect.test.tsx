import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
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
