import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { CookingSession, Recipe } from "@cooking/shared";
import { CookSetup } from "./CookSetup";

const mockCreate = jest.fn();
const mockActive = jest.fn();
const mockDiscard = jest.fn();
const mockRecipesList = jest.fn();
const mockMealPlanList = jest.fn();
const mockApiClient = {
  cooking: { create: mockCreate, active: mockActive, discard: mockDiscard },
  recipes: { list: mockRecipesList },
  mealPlan: { list: mockMealPlanList },
};

jest.mock("../../lib/api", () => ({ useApiClient: () => mockApiClient }));
const translate = (key: string, vars?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      "common.loading": "Loading...",
      "common.search": "Search",
      "cook.empty.title": "Start cooking",
      "cook.empty.description": "Choose a planned meal or recipes from your library.",
      "cook.setup.plannedMeal": "Planned meal",
      "cook.setup.chooseRecipes": "Choose recipes",
      "cook.setup.breakfast": "Breakfast",
      "cook.setup.lunch": "Lunch",
      "cook.setup.dinner": "Dinner",
      "cook.setup.noPlannedRecipes": "No recipes are saved in this meal.",
      "cook.setup.editTutorial": "Edit tutorial",
      "cook.setup.startCount": "Start {count} dishes",
    };
    return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ""));
};
jest.mock("../../lib/i18n", () => ({ useT: () => translate }));

const recipes: Recipe[] = [
  { id: "tofu", title: "Mapo tofu", ingredients: [], steps: [{ id: "tofu-step", text: "Cook tofu", duration_seconds: 300 }] },
  { id: "rice", title: "Steamed rice", ingredients: [], steps: [{ id: "rice-step", text: "Steam rice", duration_seconds: 900 }] },
  { id: "draft", title: "Unfinished soup", ingredients: [], steps: [] },
];
const created: CookingSession = {
  id: "session-1",
  version: 1,
  created_at: "2026-08-27T12:00:00.000Z",
  updated_at: "2026-08-27T12:00:00.000Z",
  dishes: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRecipesList.mockResolvedValue(recipes);
  mockMealPlanList.mockResolvedValue([{
    date: new Date().toISOString().slice(0, 10),
    breakfast: [],
    lunch: [],
    dinner: ["tofu", "rice"],
  }]);
  mockCreate.mockResolvedValue(created);
});

test("starts every recipe in the selected planned meal", async () => {
  const onSessionCreated = jest.fn();
  await render(<CookSetup onSessionCreated={onSessionCreated} />);

  await fireEvent.press(await screen.findByRole("button", { name: "Dinner" }));
  await fireEvent.press(screen.getByRole("button", { name: "Start 2 dishes" }));

  await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(["tofu", "rice"]));
  expect(onSessionCreated).toHaveBeenCalledWith(created);
});

test("supports manual selection and excludes recipes without tutorial steps", async () => {
  const onSessionCreated = jest.fn();
  await render(<CookSetup onSessionCreated={onSessionCreated} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Choose recipes" }));

  expect(screen.queryByRole("checkbox", { name: "Unfinished soup" })).not.toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Edit tutorial Unfinished soup" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("checkbox", { name: "Mapo tofu" }));
  await fireEvent.press(screen.getByRole("button", { name: "Start 1 dishes" }));

  await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(["tofu"]));
});
