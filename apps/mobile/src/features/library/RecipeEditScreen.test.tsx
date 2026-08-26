import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { Recipe, RecipeStep } from "@cooking/shared";
import { RecipeEditScreen } from "./RecipeEditScreen";

const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockEstimateTutorial = jest.fn();
let mockLanguage: "en" | "zh" = "en";
let mockPreventRemove = false;
let mockPreventRemoveCallback: ((options: { data: { action: { type: string } } }) => void) | undefined;
const mockCreateTranslate = () => (
  key: string,
  variables?: Record<string, string | number>,
) => {
    const { MESSAGE_MAP } = require("@cooking/shared") as typeof import("@cooking/shared");
    const template = MESSAGE_MAP[mockLanguage][key] ?? MESSAGE_MAP.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(variables?.[name] ?? ""));
  };
let mockTranslate = mockCreateTranslate();
const mockApiClient = {
  recipes: {
    get: mockGet,
    update: mockUpdate,
    estimateTutorial: mockEstimateTutorial,
    uploadImage: jest.fn(),
  },
};

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("@react-navigation/native", () => ({
  UNSTABLE_usePreventRemove: (
    preventRemove: boolean,
    callback: (options: { data: { action: { type: string } } }) => void,
  ) => {
    mockPreventRemove = preventRemove;
    mockPreventRemoveCallback = callback;
  },
}));

jest.mock("../../lib/i18n", () => ({
  useT: () => mockTranslate,
}));

const fallbackStep: RecipeStep = {
  id: "aa786c6e-e55c-4905-ad02-b167925cb96d",
  text: "Simmer until glossy.",
  duration_seconds: 300,
  duration_source: "fallback",
  attention_type: "hands_on",
  action_type: "other",
  image_url: "https://example.com/preserved.jpg",
};

const recipe: Recipe = {
  id: "recipe-1",
  title: "Braised tofu",
  thumbnail_url: null,
  description: "Weeknight dinner",
  total_time_minutes: 25,
  ingredients: [{ name: "Tofu", quantity: "1 block" }],
  library_tags: ["weeknight"],
  steps: [fallbackStep],
  tips: ["Taste first"],
  equipment: ["Pot"],
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function navigation() {
  return { setOptions: jest.fn(), goBack: jest.fn() };
}

function route(
  focus: "recipe" | "tutorial" = "tutorial",
  recipeId: string = recipe.id,
) {
  return {
    key: "edit",
    name: "RecipeEdit",
    params: { recipeId, focus },
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockTranslate = mockCreateTranslate();
  mockPreventRemove = false;
  mockPreventRemoveCallback = undefined;
  mockGet.mockResolvedValue(recipe);
  mockUpdate.mockResolvedValue(recipe);
  mockEstimateTutorial.mockImplementation(async (_id: string, steps: RecipeStep[]) => ({
    steps: steps.map((step) => ({
      ...step,
      duration_seconds: 480,
      duration_source: "estimated" as const,
      attention_type: "passive" as const,
      action_type: "simmer" as const,
    })),
  }));
});

test("keeps Estimate preview-only and applies it to an independent local tutorial draft", async () => {
  const nav = navigation();
  await render(<RecipeEditScreen navigation={nav as never} route={route()} />);

  const instructions = await screen.findByLabelText("Step 1");
  await fireEvent.changeText(instructions, "Simmer the edited sauce.");
  await fireEvent.press(screen.getByRole("button", { name: "Estimate missing tutorial details" }));

  await waitFor(() => expect(screen.getByText("About 8 min · AI estimated · Passive")).toBeOnTheScreen());
  expect(instructions).toHaveProp("value", "Simmer the edited sauce.");
  expect(mockEstimateTutorial).toHaveBeenCalledWith(recipe.id, [{
    ...fallbackStep,
    text: "Simmer the edited sauce.",
  }]);
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(recipe.steps?.[0]).toEqual(fallbackStep);
});

test("cancels tutorial editing without PATCH", async () => {
  const nav = navigation();
  await render(<RecipeEditScreen navigation={nav as never} route={route()} />);

  await screen.findByLabelText("Step 1");
  expect(mockPreventRemove).toBe(false);
  expect(nav.setOptions).toHaveBeenCalledWith(expect.objectContaining({
    headerBackButtonMenuEnabled: false,
  }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));

  expect(mockUpdate).not.toHaveBeenCalled();
  expect(nav.goBack).toHaveBeenCalledTimes(1);
});

test("saves only tutorial steps and returns only after a successful PATCH", async () => {
  const nav = navigation();
  nav.goBack.mockImplementation(() => {
    expect(mockPreventRemove).toBe(false);
  });
  await render(<RecipeEditScreen navigation={nav as never} route={route()} />);

  const instructions = await screen.findByLabelText("Step 1");
  await fireEvent.changeText(instructions, "Simmer gently.");
  await fireEvent.press(screen.getByRole("button", { name: "Save tutorial" }));

  await waitFor(() => expect(nav.goBack).toHaveBeenCalledTimes(1));
  expect(mockUpdate).toHaveBeenCalledWith(recipe.id, {
    steps: [{ ...fallbackStep, text: "Simmer gently." }],
  });
});

test("keeps the tutorial draft after Estimate and Save failures", async () => {
  const nav = navigation();
  mockEstimateTutorial.mockRejectedValueOnce(new Error("estimate failed"));
  mockUpdate.mockRejectedValueOnce(new Error("save failed"));
  await render(<RecipeEditScreen navigation={nav as never} route={route()} />);

  const instructions = await screen.findByLabelText("Step 1");
  await fireEvent.changeText(instructions, "Keep this local draft.");
  await fireEvent.press(screen.getByRole("button", { name: "Estimate missing tutorial details" }));
  expect(await screen.findByText("Couldn't estimate tutorial details. Try again.")).toBeOnTheScreen();
  expect(instructions).toHaveProp("value", "Keep this local draft.");

  await fireEvent.press(screen.getByRole("button", { name: "Save tutorial" }));
  expect(await screen.findByText("Couldn't save the tutorial. Try again.")).toBeOnTheScreen();
  expect(instructions).toHaveProp("value", "Keep this local draft.");
  expect(nav.goBack).not.toHaveBeenCalled();
});

test.each([
  ["en", "Couldn't load the tutorial."],
  ["zh", "无法加载教程。"],
] as const)("uses the localized %s tutorial load error", async (language, expected) => {
  mockLanguage = language;
  mockGet.mockRejectedValueOnce(new Error('{"detail":"raw transport failure"}'));

  await render(<RecipeEditScreen navigation={navigation() as never} route={route()} />);

  expect(await screen.findByText(expected)).toBeOnTheScreen();
  expect(screen.queryByText(/raw transport failure/)).toBeNull();
});

test("uses the localized Chinese tutorial save error", async () => {
  mockLanguage = "zh";
  mockUpdate.mockRejectedValueOnce(new Error('{"detail":"raw save failure"}'));
  const nav = navigation();
  await render(<RecipeEditScreen navigation={nav as never} route={route()} />);

  await screen.findByLabelText("步骤 1");
  await fireEvent.press(screen.getByRole("button", { name: "保存教程" }));

  expect(await screen.findByText("无法保存教程，请重试。")).toBeOnTheScreen();
  expect(screen.queryByText(/raw save failure/)).toBeNull();
  expect(nav.goBack).not.toHaveBeenCalled();
});

test("preserves unsaved tutorial edits when the translator identity changes", async () => {
  const nav = navigation();
  const editRoute = route();
  const view = await render(<RecipeEditScreen navigation={nav as never} route={editRoute} />);

  const instructions = await screen.findByLabelText("Step 1");
  await fireEvent.changeText(instructions, "Keep this unsaved translation-safe edit.");
  expect(mockGet).toHaveBeenCalledTimes(1);

  mockLanguage = "zh";
  mockTranslate = mockCreateTranslate();
  await act(async () => {
    view.rerender(<RecipeEditScreen navigation={nav as never} route={editRoute} />);
  });

  expect(await screen.findByLabelText("步骤 1")).toHaveProp(
    "value",
    "Keep this unsaved translation-safe edit.",
  );
  expect(mockGet).toHaveBeenCalledTimes(1);
});

test("loads the new resource when recipeId changes", async () => {
  const secondRecipe: Recipe = {
    ...recipe,
    id: "recipe-2",
    title: "Second recipe",
    steps: [{ ...fallbackStep, id: "bb786c6e-e55c-4905-ad02-b167925cb96d", text: "Cook the second recipe." }],
  };
  mockGet.mockImplementation((recipeId: string) => Promise.resolve(
    recipeId === secondRecipe.id ? secondRecipe : recipe,
  ));
  const nav = navigation();
  const view = await render(<RecipeEditScreen navigation={nav as never} route={route()} />);

  await screen.findByLabelText("Step 1");
  await act(async () => {
    view.rerender(
      <RecipeEditScreen navigation={nav as never} route={route("tutorial", secondRecipe.id)} />,
    );
  });

  await waitFor(() => expect(screen.getByLabelText("Step 1")).toHaveProp(
    "value",
    "Cook the second recipe.",
  ));
  expect(mockGet).toHaveBeenNthCalledWith(1, recipe.id);
  expect(mockGet).toHaveBeenNthCalledWith(2, secondRecipe.id);
});

test("locks tutorial mutations until a pending Estimate resolves", async () => {
  const nav = navigation();
  const pending = deferred<{ steps: RecipeStep[] }>();
  mockEstimateTutorial.mockReturnValueOnce(pending.promise);
  await render(<RecipeEditScreen navigation={nav as never} route={route()} />);

  const instructions = await screen.findByLabelText("Step 1");
  await fireEvent.changeText(instructions, "Snapshot sent for estimation.");
  const estimatePress = fireEvent.press(
    screen.getByRole("button", { name: "Estimate missing tutorial details" }),
  );

  await waitFor(() => expect(instructions).toHaveProp("editable", false));
  expect(mockPreventRemove).toBe(true);
  expect(mockPreventRemoveCallback).toBeDefined();
  mockPreventRemoveCallback?.({ data: { action: { type: "GO_BACK" } } });
  expect(nav.goBack).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Add step" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save tutorial" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await fireEvent.changeText(instructions, "Unsent mutation");
  expect(instructions).toHaveProp("value", "Snapshot sent for estimation.");

  await act(async () => {
    pending.resolve({ steps: [{
      ...fallbackStep,
      text: "Snapshot sent for estimation.",
      duration_seconds: 420,
      duration_source: "estimated",
      attention_type: "passive",
      action_type: "simmer",
    }] });
    await estimatePress;
  });
  await waitFor(() => expect(instructions).toHaveProp("editable", true));
  expect(mockPreventRemove).toBe(false);
  expect(instructions).toHaveProp("value", "Snapshot sent for estimation.");
});

test("locks tutorial mutations and navigation until a pending Save settles", async () => {
  const nav = navigation();
  const pending = deferred<Recipe>();
  mockUpdate.mockReturnValueOnce(pending.promise);
  await render(<RecipeEditScreen navigation={nav as never} route={route()} />);

  const instructions = await screen.findByLabelText("Step 1");
  await fireEvent.changeText(instructions, "Snapshot sent for saving.");
  const savePress = fireEvent.press(screen.getByRole("button", { name: "Save tutorial" }));

  await waitFor(() => expect(instructions).toHaveProp("editable", false));
  expect(mockPreventRemove).toBe(true);
  expect(mockPreventRemoveCallback).toBeDefined();
  mockPreventRemoveCallback?.({ data: { action: { type: "GO_BACK" } } });
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(nav.goBack).not.toHaveBeenCalled();
  await fireEvent.changeText(instructions, "Unsent mutation");
  expect(instructions).toHaveProp("value", "Snapshot sent for saving.");

  await act(async () => {
    pending.resolve(recipe);
    await savePress;
  });
  await waitFor(() => expect(nav.goBack).toHaveBeenCalledTimes(1));
  expect(mockPreventRemove).toBe(false);
  expect(mockUpdate).toHaveBeenCalledWith(recipe.id, {
    steps: [{ ...fallbackStep, text: "Snapshot sent for saving." }],
  });
});

test("retains the existing full recipe PATCH payload outside tutorial focus", async () => {
  const nav = navigation();
  await render(<RecipeEditScreen navigation={nav as never} route={route("recipe")} />);

  await screen.findByLabelText("Title");
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(recipe.id, {
    title: recipe.title,
    thumbnail_url: recipe.thumbnail_url,
    ingredients: recipe.ingredients,
    library_tags: recipe.library_tags,
    description: recipe.description,
    total_time_minutes: recipe.total_time_minutes,
    steps: recipe.steps,
    tips: recipe.tips,
    equipment: recipe.equipment,
  }));
});

test("preserves a useful transport error when full recipe saving fails", async () => {
  mockUpdate.mockRejectedValueOnce(new Error("The title is already in use"));
  const nav = navigation();
  await render(<RecipeEditScreen navigation={nav as never} route={route("recipe")} />);

  await screen.findByLabelText("Title");
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByText("The title is already in use")).toBeOnTheScreen();
  expect(nav.goBack).not.toHaveBeenCalled();
});
