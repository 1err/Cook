import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Header } from "./Header";

const { mockUseAuth, mockUseI18n, mockUsePathname } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseI18n: vi.fn(),
  mockUsePathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: mockUsePathname }));
vi.mock("../lib/auth", () => ({ useAuth: mockUseAuth }));
vi.mock("../lib/i18n", () => ({ useI18n: mockUseI18n }));

const messages: Record<string, string> = {
  "language.english": "English",
  "language.chinese": "中文",
  "nav.accountFor": "Account for {email}",
  "nav.addRecipe": "Add Recipe",
  "nav.adminTools": "Admin tools",
  "nav.appName": "Chef World",
  "nav.cachePreview": "Store cache",
  "nav.closeMenu": "Close navigation menu",
  "nav.library": "Library",
  "nav.logOut": "Log out",
  "nav.openMenu": "Open navigation menu",
  "nav.planner": "Planner",
  "nav.register": "Register",
  "nav.settings": "Settings",
  "nav.shopping": "Shopping",
  "nav.signIn": "Sign in",
  "account.language": "Language",
};

function t(key: string, vars?: Record<string, string | number>) {
  const message = messages[key] ?? key;
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
}

beforeEach(() => {
  mockUsePathname.mockReturnValue("/planner");
  mockUseAuth.mockReturnValue({
    user: { id: "admin", email: "jerryxiang24@gmail.com", is_library_public: false },
    loading: false,
    logout: vi.fn().mockResolvedValue(undefined),
  });
  mockUseI18n.mockReturnValue({ language: "en", setLanguage: vi.fn(), t });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
});

test("keeps only core destinations in primary navigation and preserves the Add Recipe origin", () => {
  render(<Header />);

  expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library");
  expect(screen.getByRole("link", { name: "Planner" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Shopping" })).toHaveAttribute("href", "/shopping-list");
  expect(screen.getByRole("link", { name: "Add Recipe" })).toHaveAttribute(
    "href",
    "/import?from=%2Fplanner",
  );
  expect(screen.queryByRole("link", { name: "Import" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Store cache" })).not.toBeInTheDocument();
});

test("moves settings, language, admin tools, and logout into the account menu", async () => {
  const user = userEvent.setup();
  render(<Header />);

  await user.click(screen.getByRole("button", { name: "Account for jerryxiang24@gmail.com" }));

  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("link", { name: "Store cache" })).toHaveAttribute("href", "/preview");
  expect(screen.getByRole("button", { name: "Log out" })).toBeVisible();
});

test("preserves sign-in and registration actions for unauthenticated routes", () => {
  mockUsePathname.mockReturnValue("/");
  mockUseAuth.mockReturnValue({ user: null, loading: false, logout: vi.fn() });

  render(<Header />);

  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register");
  expect(screen.queryByRole("link", { name: "Add Recipe" })).not.toBeInTheDocument();
});

test("the navigation disclosure owns and precedes the links it reveals in tab order", async () => {
  const user = userEvent.setup();
  render(<Header />);
  const trigger = screen.getByLabelText("Open navigation menu");
  trigger.style.display = "inline-flex";
  const navigation = screen.getByRole("navigation", { name: "Main" });
  const libraryLink = screen.getByRole("link", { name: "Library" });

  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveAttribute("aria-controls", navigation.id);
  expect(trigger).not.toHaveAttribute("aria-pressed");
  expect(trigger.compareDocumentPosition(libraryLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");

  await user.tab();
  expect(libraryLink).toHaveFocus();
});

test("the account anchor is the final narrow action so its panel remains inside 320px", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
  const user = userEvent.setup();
  render(<Header />);
  const accountTrigger = screen.getByRole("button", {
    name: "Account for jerryxiang24@gmail.com",
  });
  const accountRoot = accountTrigger.parentElement;
  const actionGroup = accountRoot?.parentElement;

  expect(actionGroup?.lastElementChild).toBe(accountRoot);

  await user.click(accountTrigger);
  expect(document.getElementById(accountTrigger.getAttribute("aria-controls") ?? "")).toBeVisible();
});
