import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CookingSession, Recipe } from "@cooking/shared";
import { RecipeCookAction } from "./RecipeCookAction";

const { mockActive, mockAddDishes, mockCreate, mockPush, mockUseT } = vi.hoisted(() => ({
  mockActive: vi.fn(),
  mockAddDishes: vi.fn(),
  mockCreate: vi.fn(),
  mockPush: vi.fn(),
  mockUseT: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("../../lib/api", () => ({
  webApiClient: { cooking: { active: mockActive, addDishes: mockAddDishes, create: mockCreate } },
}));
vi.mock("../../lib/i18n", () => ({ useT: mockUseT }));

const messages: Record<string, string> = {
  "cook.recipe.add": "Add to current session",
  "cook.recipe.editTutorial": "Edit tutorial",
  "cook.recipe.open": "Open in Cook",
  "cook.recipe.start": "Start cooking",
};
const recipe: Recipe = {
  id: "recipe-1",
  title: "Tomato noodles",
  ingredients: [],
  steps: [{ id: "recipe-step-1", text: "Boil noodles", duration_seconds: 300 }],
};
const emptySession: CookingSession = {
  id: "session-1",
  version: 1,
  created_at: "2026-08-27T11:00:00.000Z",
  updated_at: "2026-08-27T11:00:00.000Z",
  dishes: [],
};

beforeEach(() => {
  mockUseT.mockReturnValue((key: string) => messages[key] ?? key);
  mockActive.mockResolvedValue(null);
  mockCreate.mockResolvedValue(emptySession);
  mockAddDishes.mockResolvedValue(emptySession);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("links recipes without tutorial steps to the tutorial editor", () => {
  render(<RecipeCookAction recipe={{ ...recipe, steps: [] }} />);
  expect(screen.getByRole("link", { name: "Edit tutorial" })).toHaveAttribute(
    "href",
    "/recipe/recipe-1/tutorial/edit",
  );
});

test("starts a one-dish session when no session exists", async () => {
  const user = userEvent.setup();
  render(<RecipeCookAction recipe={recipe} />);
  await user.click(await screen.findByRole("button", { name: "Start cooking" }));

  await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(["recipe-1"]));
  expect(mockPush).toHaveBeenCalledWith("/cook");
});

test("adds a recipe to the current multi-dish session", async () => {
  mockActive.mockResolvedValue(emptySession);
  const user = userEvent.setup();
  render(<RecipeCookAction recipe={recipe} />);
  await user.click(await screen.findByRole("button", { name: "Add to current session" }));

  await waitFor(() => expect(mockAddDishes).toHaveBeenCalledWith("session-1", ["recipe-1"]));
  expect(mockPush).toHaveBeenCalledWith("/cook");
});

test("opens the existing dish in Cook when the recipe is already included", async () => {
  mockActive.mockResolvedValue({
    ...emptySession,
    dishes: [{
      id: "dish-1",
      recipe_id: "recipe-1",
      position: 0,
      title: "Tomato noodles",
      thumbnail_url: null,
      ingredients: [],
      equipment: [],
      tips: [],
      created_at: "2026-08-27T11:00:00.000Z",
      steps: [],
    }],
  });
  render(<RecipeCookAction recipe={recipe} />);

  expect(await screen.findByRole("link", { name: "Open in Cook" })).toHaveAttribute(
    "href",
    "/cook?dish=dish-1",
  );
});
