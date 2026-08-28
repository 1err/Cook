import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthShell } from "./AuthShell";

vi.mock("./LanguageControl", () => ({ LanguageControl: () => null }));

afterEach(cleanup);

test("keeps the Chef World identity in the auth form when the desktop hero is hidden", () => {
  render(
    <AuthShell eyebrow="" footer={<a href="/register">Create an account</a>} subtitle="" title="Welcome back">
      <form aria-label="Sign in form" />
    </AuthShell>,
  );

  expect(screen.getByLabelText("Chef World")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
