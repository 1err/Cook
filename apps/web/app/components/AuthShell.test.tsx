import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthShell } from "./AuthShell";
import { I18nProvider } from "../lib/i18n";

vi.mock("./LanguageControl", () => ({ LanguageControl: () => null }));

afterEach(cleanup);

test("keeps the Chef World identity in the auth form when the desktop hero is hidden", () => {
  render(
    <I18nProvider>
      <AuthShell eyebrow="" footer={<a href="/register">Create an account</a>} subtitle="" title="Welcome back">
        <form aria-label="Sign in form" />
      </AuthShell>
    </I18nProvider>,
  );

  expect(screen.getByLabelText("Chef World")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
});
