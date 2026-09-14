import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import LoginPage from "../login/page";
import RegisterPage from "../register/page";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./api", () => ({ apiFetch: async () => new Response("{}") }));
vi.mock("./auth", () => ({ useAuth: () => ({ refreshUser: async () => {} }) }));
vi.mock("./i18n", () => ({ useT: () => (key: string) => key, useI18n: () => ({ language: "en", setLanguage: vi.fn(), t: (key: string) => key }) }));

beforeEach(() => push.mockClear());

test.each([
  ["login", LoginPage],
  ["register", RegisterPage],
] as const)("%s rejects a protocol-relative post-auth redirect", async (_name, Page) => {
  window.history.replaceState({}, "", "/login?redirect=%2F%2Fevil.example%2Fphishing");
  const { container } = render(<Page />);
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(push).toHaveBeenCalledWith("/library"));
});
