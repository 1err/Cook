import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CookingSession } from "@cooking/shared";
import { CookScreen } from "./CookScreen";

const { mockUseCookingSession, mockUseT } = vi.hoisted(() => ({
  mockUseCookingSession: vi.fn(),
  mockUseT: vi.fn(),
}));

vi.mock("./useCookingSession", () => ({ useCookingSession: mockUseCookingSession }));
vi.mock("./CookSetup", () => ({
  CookSetup: () => (
    <section>
      <h1>Start cooking</h1>
      <p>Choose a planned meal or recipes from your library.</p>
    </section>
  ),
}));
vi.mock("../lib/i18n", () => ({ useT: mockUseT }));

const messages: Record<string, string> = {
  "common.loading": "Loading...",
  "common.refresh": "Refresh",
  "cook.active.eyebrow": "Cooking now",
  "cook.active.title": "Your cooking session",
  "cook.empty.description": "Choose a planned meal or recipes from your library.",
  "cook.empty.title": "Start cooking",
  "cook.error.title": "Couldn't load your cooking session",
};

const session: CookingSession = {
  id: "session-1",
  version: 1,
  created_at: "2026-08-27T11:00:00.000Z",
  updated_at: "2026-08-27T11:00:00.000Z",
  dishes: [],
};

beforeEach(() => {
  mockUseT.mockReturnValue((key: string) => messages[key] ?? key);
  mockUseCookingSession.mockReturnValue({
    status: "ready",
    session: null,
    error: null,
    refresh: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("shows the session setup entry when the account has no active cook", () => {
  render(<CookScreen />);

  expect(screen.getByRole("heading", { name: "Start cooking" })).toBeVisible();
  expect(screen.getByText("Choose a planned meal or recipes from your library.")).toBeVisible();
});

test("shows a stable loading state while the active session is fetched", () => {
  mockUseCookingSession.mockReturnValue({ status: "loading", session: null, error: null });

  render(<CookScreen />);

  expect(screen.getByText("Loading...")).toHaveAttribute("role", "status");
});

test("shows a retryable local error without removing the Cook shell", () => {
  const refresh = vi.fn();
  mockUseCookingSession.mockReturnValue({
    status: "error",
    session: null,
    error: "Network unavailable",
    refresh,
  });

  render(<CookScreen />);

  expect(screen.getByRole("heading", { name: "Couldn't load your cooking session" })).toBeVisible();
  expect(screen.getByText("Network unavailable")).toBeVisible();
  expect(screen.getByRole("button", { name: "Refresh" })).toBeVisible();
});

test("renders the active workspace boundary for a canonical session", () => {
  mockUseCookingSession.mockReturnValue({ status: "ready", session, error: null });

  render(<CookScreen />);

  expect(screen.getByText("Cooking now")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Your cooking session" })).toBeVisible();
});
