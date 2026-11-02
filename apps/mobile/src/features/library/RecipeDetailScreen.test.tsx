import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { Recipe } from "@cooking/shared";
import { RecipeDetailScreen } from "./RecipeDetailScreen";

const mockGet = jest.fn();
const mockEditorStatus = jest.fn().mockResolvedValue({ can_manage: false });
const mockCookingActive = jest.fn().mockResolvedValue(null);
let mockFocusEffect: (() => void | (() => void)) | undefined;
const mockApiClient = {
  cooking: {
    active: mockCookingActive,
    create: jest.fn(),
    addDishes: jest.fn(),
  },
  recipes: {
    authors: jest.fn(),
    update: jest.fn(),
    get: mockGet,
    editorStatus: mockEditorStatus,
    setCatalogVisibility: jest.fn(),
    remove: jest.fn(),
  },
};

jest.mock("@react-navigation/native", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactModule = require("react") as typeof import("react");
    mockFocusEffect = effect;
    ReactModule.useEffect(effect, [effect]);
  },
}));

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
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
  equipment: ["Legacy simmering pot"],
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
  mockFocusEffect = undefined;
  mockEditorStatus.mockResolvedValue({ can_manage: false });
  mockGet.mockResolvedValue(recipe);
  mockApiClient.recipes.authors.mockResolvedValue([{ id: "creator-1", name: "Chef Lin", aliases: [] }]);
  mockApiClient.recipes.update.mockImplementation(async (_id, payload) => ({ ...recipe, ...payload, author: payload.author_id ? { id: "creator-1", name: "Chef Lin", aliases: [] } : null }));
});

test("adds and clears an author directly on detail with an author-only patch", async () => {
  await render(<RecipeDetailScreen navigation={navigation() as never}
    route={{ key: "detail", name: "RecipeDetail", params: { recipeId: recipe.id } } as never} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Add author" }));
  await fireEvent.press(await screen.findByRole("button", { name: "By Chef Lin" }));
  await waitFor(() => expect(mockApiClient.recipes.update).toHaveBeenLastCalledWith(recipe.id, { author_id: "creator-1" }));
  await screen.findByText("By Chef Lin");
  await fireEvent.press(screen.getByRole("button", { name: "Edit author" }));
  await fireEvent.press(screen.getByRole("button", { name: "Clear author" }));
  await waitFor(() => expect(mockApiClient.recipes.update).toHaveBeenLastCalledWith(recipe.id, { author_id: null }));
});

test("a failed detail credit save preserves the existing credit and exposes a retryable picker", async () => {
  mockApiClient.recipes.update.mockRejectedValueOnce(new Error("Offline"));
  await render(<RecipeDetailScreen navigation={navigation() as never}
    route={{ key: "detail", name: "RecipeDetail", params: { recipeId: recipe.id } } as never} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Add author" }));
  await fireEvent.press(await screen.findByRole("button", { name: "By Chef Lin" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save author. Try again.");
  expect(screen.queryByText("By Chef Lin")).toBeNull();
  expect(screen.getByRole("button", { name: "Add author" })).toBeEnabled();
});

test.each(["success", "failure"])("a focus refresh started before an author save cannot restore the old credit (%s)", async (outcome) => {
  let finish!: (value: Recipe) => void;
  let fail!: (error: Error) => void;
  mockGet.mockResolvedValueOnce(recipe).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  await render(<RecipeDetailScreen navigation={navigation() as never}
    route={{ key: "detail", name: "RecipeDetail", params: { recipeId: recipe.id } } as never} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Add author" }));
  await act(async () => { mockFocusEffect?.(); });
  await fireEvent.press(await screen.findByRole("button", { name: "By Chef Lin" }));
  await screen.findByText("By Chef Lin");
  await act(async () => { if (outcome === "success") finish(recipe); else fail(new Error("Refresh offline")); });
  expect(screen.getByText("By Chef Lin")).toBeOnTheScreen();
});

test("refetches tutorial steps when the mounted detail screen regains focus", async () => {
  mockGet
    .mockResolvedValueOnce(recipe)
    .mockResolvedValueOnce({
      ...recipe,
      steps: [{ ...recipe.steps![0], text: "Freshly saved tutorial step." }],
    });

  await render(
    <RecipeDetailScreen
      navigation={navigation() as never}
      route={{ key: "detail", name: "RecipeDetail", params: { recipeId: recipe.id } } as never}
    />,
  );

  expect(await screen.findByText("Simmer gently.")).toBeOnTheScreen();
  expect(mockFocusEffect).toBeDefined();

  await act(async () => {
    mockFocusEffect?.();
  });

  await waitFor(() => expect(screen.getByText("Freshly saved tutorial step.")).toBeOnTheScreen());
  expect(screen.queryByText("Simmer gently.")).not.toBeOnTheScreen();
  expect(mockGet).toHaveBeenCalledTimes(2);
});

test("shows transparent tutorial metadata and opens focused tutorial editing", async () => {
  const nav = navigation();
  await render(
    <RecipeDetailScreen
      navigation={nav as never}
      route={{ key: "detail", name: "RecipeDetail", params: { recipeId: recipe.id } } as never}
    />,
  );

  expect(await screen.findByText("About 8 min · Estimated · Passive")).toBeOnTheScreen();
  expect(screen.queryByText(/⏱/)).not.toBeOnTheScreen();
  expect(screen.getByRole("image", { name: "Simmer illustration" })).toBeOnTheScreen();
  expect(screen.queryByText("Equipment")).not.toBeOnTheScreen();
  expect(screen.queryByText("Legacy simmering pot")).not.toBeOnTheScreen();
  const badgeStyle = StyleSheet.flatten(screen.getByText("1").props.style);
  expect(badgeStyle.height).toBeUndefined();
  expect(badgeStyle.minHeight).toBeGreaterThanOrEqual(26);
  expect(badgeStyle.paddingVertical).toBeGreaterThan(0);

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
