import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SettingsPage from "./page";
import { I18nProvider } from "../lib/i18n";

const { mockSetLibraryVisibility, mockUseAuth, router } = vi.hoisted(() => ({
  mockSetLibraryVisibility: vi.fn(),
  mockUseAuth: vi.fn(),
  router: { replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings",
}));

vi.mock("../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../lib/auth", () => ({ useAuth: mockUseAuth }));
vi.mock("../lib/api", () => ({ webApiClient: { auth: { capabilities: async () => ({ email_verification: false }) } } }));
vi.mock("../lib/editorialCopy", () => ({
  useEditorialCopy: () => ({ "settings.tagline": "Settings" }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

beforeEach(() => {
  mockSetLibraryVisibility.mockReset().mockResolvedValue(undefined);
  mockUseAuth.mockReturnValue({
    user: { id: "user-1", email: "cook@example.com", is_library_public: false },
    setLibraryVisibility: mockSetLibraryVisibility,
  });
});

it("keeps the sharing consequence beside a clearly labeled control", async () => {
  const user = userEvent.setup();
  render(<I18nProvider><SettingsPage /></I18nProvider>);

  expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
  const control = screen.getByRole("checkbox", { name: /Share my library/i });
  await user.click(control);

  expect(mockSetLibraryVisibility).toHaveBeenCalledWith(true);
});

it("translates library visibility and its consequences in Chinese", async () => {
  vi.stubGlobal("localStorage", {getItem: () => "zh", setItem: vi.fn()});
  render(<I18nProvider><SettingsPage /></I18nProvider>);
  expect(await screen.findByRole("heading", {name: "设置", exact:true})).toBeVisible();
  expect(screen.getByRole("checkbox", {name: "分享我的菜谱库"})).toBeEnabled();
  expect(screen.getByText("知道你邮箱地址的人可以浏览并复制你的菜谱。")).toBeVisible();
  expect(screen.getByText("关闭", {exact:true})).toBeVisible();
});
