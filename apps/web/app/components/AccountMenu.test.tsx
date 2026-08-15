import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AccountMenu } from "./AccountMenu";

const { mockUseI18n } = vi.hoisted(() => ({ mockUseI18n: vi.fn() }));

vi.mock("../lib/i18n", () => ({ useI18n: mockUseI18n }));

const messages: Record<string, string> = {
  "language.english": "English",
  "language.chinese": "中文",
  "nav.accountFor": "Account for {email}",
  "nav.adminTools": "Admin tools",
  "nav.cachePreview": "Store cache",
  "nav.logOut": "Log out",
  "nav.settings": "Settings",
  "account.language": "Language",
};

function t(key: string, vars?: Record<string, string | number>) {
  const message = messages[key] ?? key;
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
}

beforeEach(() => {
  mockUseI18n.mockReturnValue({ language: "en", setLanguage: vi.fn(), t });
});

afterEach(cleanup);

test("exposes Store cache and Design system only to admin users", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <AccountMenu email="admin@example.com" isAdmin onLogout={vi.fn()} />,
  );

  await user.click(screen.getByRole("button", { name: "Account for admin@example.com" }));

  expect(screen.getByRole("link", { name: "Store cache" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Design system" })).toBeVisible();

  rerender(<AccountMenu email="cook@example.com" isAdmin={false} onLogout={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Account for cook@example.com" }));

  expect(screen.queryByRole("link", { name: "Store cache" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Design system" })).not.toBeInTheDocument();
});

test("Escape closes the menu and restores focus to its trigger", async () => {
  const user = userEvent.setup();
  render(<AccountMenu email="cook@example.com" isAdmin={false} onLogout={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Account for cook@example.com" });

  await user.click(trigger);
  expect(screen.getByRole("link", { name: "Settings" })).toBeVisible();

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("clicking outside or following a route link closes the menu", async () => {
  const user = userEvent.setup();
  render(
    <div>
      <AccountMenu email="cook@example.com" isAdmin={false} onLogout={vi.fn()} />
      <button type="button">Outside</button>
    </div>,
  );
  const trigger = screen.getByRole("button", { name: "Account for cook@example.com" });

  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();

  await user.click(trigger);
  const settingsLink = screen.getByRole("link", { name: "Settings" });
  settingsLink.addEventListener("click", (event) => event.preventDefault());
  await user.click(settingsLink);
  expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
});
