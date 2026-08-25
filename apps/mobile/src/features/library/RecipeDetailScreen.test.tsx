import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Recipe } from "@cooking/shared";
import { RecipeDetailScreen } from "./RecipeDetailScreen";

const mockGet = jest.fn();
const mockEditorStatus = jest.fn().mockResolvedValue({ can_manage: false });

jest.mock("../../lib/api", () => ({
  useApiClient: () => ({
    recipes: {
      get: mockGet,
      editorStatus: mockEditorStatus,
      setCatalogVisibility: jest.fn(),
      remove: jest.fn(),
    },
  }),
}));

jest.mock("../../lib/i18n", () => ({
  useT: () => (key: string, variables?: Record<string, string | number>) => {
    const { MESSAGE_MAP } = require("@cooking/shared") as typeof import("@cooking/shared");
    const template = MESSAGE_MAP.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(variables?.[name] ?? ""));
  },
}));

const recipe: Recipe = {
  id: "recipe-1",
  title: "Braised tofu",
  total_time_minutes: 30,
  thumbnail_url: null,
  ingredients: [],
  steps: [{
    id: "78dc04ac-a838-41f5-b3eb-74835098aff9",
    text: "Simmer gently.",
    duration_seconds: 480,
    duration_source: "estimated",
    attention_type: "passive",
    action_type: "simmer",
    image_url: null,
  }],
};

function navigation() {
  return {
    setOptions: jest.fn(),
    navigate: jest.fn(),
    goBack: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEditorStatus.mockResolvedValue({ can_manage: false });
  mockGet.mockResolvedValue(recipe);
});

test("shows transparent tutorial metadata and opens focused tutorial editing", async () => {
  const nav = navigation();
  await render(
    <RecipeDetailScreen
      navigation={nav as never}
      route={{ key: "detail", name: "RecipeDetail", params: { recipeId: recipe.id } } as never}
    />,
  );

  expect(await screen.findByText("About 8 min · AI estimated · Passive")).toBeOnTheScreen();
  expect(screen.queryByText(/⏱/)).not.toBeOnTheScreen();
  expect(screen.getByRole("image", { name: "Simmer illustration" })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Edit tutorial" }));
  expect(nav.navigate).toHaveBeenCalledWith("RecipeEdit", {
    recipeId: recipe.id,
    focus: "tutorial",
  });
});

test("keeps an empty tutorial visible with an Edit tutorial action", async () => {
  const nav = navigation();
  mockGet.mockResolvedValue({ ...recipe, steps: [] });
  await render(
    <RecipeDetailScreen
      navigation={nav as never}
      route={{ key: "detail", name: "RecipeDetail", params: { recipeId: recipe.id } } as never}
    />,
  );

  expect(await screen.findByText("No tutorial steps yet. Add a step to get started.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Edit tutorial" })).toBeOnTheScreen();
});
