import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { CookingSession, Recipe } from "@cooking/shared";
import { RecipeCookAction } from "./RecipeCookAction";

const mockActive = jest.fn();
const mockCreate = jest.fn();
const mockAddDishes = jest.fn();
const mockApiClient = { cooking: { active: mockActive, create: mockCreate, addDishes: mockAddDishes } };
jest.mock("../../lib/api", () => ({ useApiClient: () => mockApiClient }));
jest.mock("../../lib/i18n", () => ({
  useT: () => (key: string) => ({
    "common.loading": "Loading...",
    "cook.recipe.start": "Start cooking",
    "cook.recipe.add": "Add to current session",
    "cook.recipe.open": "Open in Cook",
    "cook.recipe.editTutorial": "Edit tutorial",
  }[key] ?? key),
}));

const recipe: Recipe = {
  id: "recipe-1",
  title: "Tomato noodles",
  ingredients: [],
  steps: [{ id: "step-1", text: "Boil", duration_seconds: 300 }],
};
const emptySession: CookingSession = {
  id: "session-1",
  version: 1,
  created_at: "2026-08-27T11:00:00.000Z",
  updated_at: "2026-08-27T11:00:00.000Z",
  dishes: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockActive.mockResolvedValue(null);
  mockCreate.mockResolvedValue(emptySession);
  mockAddDishes.mockResolvedValue(emptySession);
});

test("edits the tutorial when the recipe has no usable steps", async () => {
  const onEditTutorial = jest.fn();
  await render(<RecipeCookAction onEditTutorial={onEditTutorial} onOpenCook={jest.fn()} recipe={{ ...recipe, steps: [] }} />);
  await fireEvent.press(screen.getByRole("button", { name: "Edit tutorial" }));
  expect(onEditTutorial).toHaveBeenCalledTimes(1);
});

test("starts a session then opens the Cook tab", async () => {
  const onOpenCook = jest.fn();
  await render(<RecipeCookAction onEditTutorial={jest.fn()} onOpenCook={onOpenCook} recipe={recipe} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Start cooking" }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(["recipe-1"]));
  expect(onOpenCook).toHaveBeenCalledWith(undefined);
});

test("adds a dish to an active session", async () => {
  mockActive.mockResolvedValue(emptySession);
  const onOpenCook = jest.fn();
  await render(<RecipeCookAction onEditTutorial={jest.fn()} onOpenCook={onOpenCook} recipe={recipe} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Add to current session" }));
  expect(mockAddDishes).toHaveBeenCalledWith("session-1", ["recipe-1"]);
});

test("opens the matching active dish without mutating it", async () => {
  mockActive.mockResolvedValue({
    ...emptySession,
    dishes: [{
      id: "dish-1",
      recipe_id: "recipe-1",
      position: 0,
      title: recipe.title,
      thumbnail_url: null,
      ingredients: [],
      equipment: [],
      tips: [],
      created_at: emptySession.created_at,
      steps: [],
    }],
  });
  const onOpenCook = jest.fn();
  await render(<RecipeCookAction onEditTutorial={jest.fn()} onOpenCook={onOpenCook} recipe={recipe} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Open in Cook" }));
  expect(onOpenCook).toHaveBeenCalledWith("dish-1");
});
