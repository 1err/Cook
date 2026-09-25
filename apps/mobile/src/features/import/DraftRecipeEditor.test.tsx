import React from "react";
import { Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@cooking/api-client";
import * as ImagePicker from "expo-image-picker";
import { MESSAGE_MAP, type Recipe } from "@cooking/shared";
import { DraftRecipeEditor } from "./DraftRecipeEditor";

const mockApiClient = { recipes: {
  uploadImage: jest.fn(),
  imageGenerationAccess: jest.fn(),
  generateImage: jest.fn(),
  imageGenerationStatus: jest.fn(),
} };

const access = {
  enabled: true,
  allowed: true,
  reason: null,
  daily_limit: 3,
  remaining: 3,
  resets_at: "2026-09-26T00:00:00Z",
};

beforeEach(() => {
  jest.resetAllMocks();
  mockApiClient.recipes.imageGenerationAccess.mockResolvedValue(access);
  mockApiClient.recipes.generateImage.mockImplementation(async ({ request_id }) => ({
    request_id,
    status: "completed",
    file_url: "/media/ai-cover.jpg",
    error_code: null,
  }));
});

const imageMessage = (key: string) => MESSAGE_MAP.en[`imageGeneration.${key}`] ?? `imageGeneration.${key}`;

function RecipeHarness({ allowImageEditing = true, saving = false }: { allowImageEditing?: boolean; saving?: boolean }) {
  const [recipe, setRecipe] = React.useState<Recipe>({ ...draft, thumbnail_url: "https://example.com/original.jpg" });
  return <>
    <DraftRecipeEditor draft={recipe} onChange={setRecipe} saving={saving} error={null} onSave={jest.fn()} allowImageEditing={allowImageEditing} />
    <Text testID="saved-draft">{JSON.stringify(recipe)}</Text>
  </>;
}

function currentDraft(): Recipe {
  return JSON.parse(screen.getByTestId("saved-draft").props.children);
}

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("../../config", () => ({ getApiBase: () => "https://api.example.com" }));

jest.mock("../../lib/i18n", () => ({
  useT: () => (key: string, variables?: Record<string, string | number>) => {
    const { MESSAGE_MAP } = require("@cooking/shared") as typeof import("@cooking/shared");
    const template = MESSAGE_MAP.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(variables?.[name] ?? ""));
  },
}));

const draft: Recipe = {
  id: "draft",
  title: "Tomato egg stir-fry",
  thumbnail_url: null,
  ingredients: [{ name: "Tomato", quantity: "2", notes: "ripe" }],
  steps: [{
    id: "7c34a783-71dd-4741-8a68-6a3fdd077521",
    text: "Cook until glossy.",
    duration_seconds: 180,
    duration_source: "fallback",
    attention_type: "hands_on",
    action_type: "mix",
    image_url: "https://example.com/hidden.jpg",
  }],
};

test("keeps import review focused on editable recipe content without step image authoring", async () => {
  await render(
    <DraftRecipeEditor
      draft={draft}
      onChange={jest.fn()}
      saving={false}
      error={null}
      onSave={jest.fn()}
      allowImageEditing={false}
    />,
  );

  expect(screen.getByText("Title")).toBeOnTheScreen();
  expect(screen.getByText("Ingredients")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Add cover image" })).not.toBeOnTheScreen();
  expect(screen.queryByText("Or paste an image URL")).not.toBeOnTheScreen();
  expect(screen.queryByText("Add image")).not.toBeOnTheScreen();
  expect(screen.queryByText("Remove image")).not.toBeOnTheScreen();
  expect(screen.queryByLabelText("Ingredient notes")).not.toBeOnTheScreen();
});

test("keeps invalid duration input visible and disables import Save", async () => {
  await render(
    <DraftRecipeEditor
      draft={draft}
      onChange={jest.fn()}
      saving={false}
      error={null}
      onSave={jest.fn()}
      allowImageEditing={false}
    />,
  );

  await fireEvent.changeText(screen.getByLabelText("Step 1 minutes"), "");

  expect(screen.getByLabelText("Step 1 minutes")).toHaveProp("value", "");
  expect(screen.getByRole("button", { name: "Save recipe" })).toBeDisabled();
});

test("tutorial focus shows only tutorial controls and supports Estimate, Save, and Cancel", async () => {
  const onEstimate = jest.fn();
  const onCancel = jest.fn();
  await render(
    <DraftRecipeEditor
      draft={draft}
      focus="tutorial"
      onChange={jest.fn()}
      saving={false}
      estimating={false}
      canEstimate
      error={null}
      onEstimate={onEstimate}
      onSave={jest.fn()}
      onCancel={onCancel}
    />,
  );

  expect(screen.getByText("Edit tutorial")).toBeOnTheScreen();
  expect(screen.getByText(draft.title)).toBeOnTheScreen();
  expect(screen.queryByText("Title")).not.toBeOnTheScreen();
  expect(screen.queryByText("Ingredients")).not.toBeOnTheScreen();
  expect(screen.queryByText(imageMessage("title"))).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Estimate missing tutorial details" }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(onEstimate).toHaveBeenCalledTimes(1);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("tutorial focus rejects draft mutations while Estimate is pending", async () => {
  const onChange = jest.fn();
  await render(
    <DraftRecipeEditor
      draft={draft}
      focus="tutorial"
      onChange={onChange}
      saving={false}
      estimating
      canEstimate
      error={null}
      onEstimate={jest.fn()}
      onSave={jest.fn()}
      onCancel={jest.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "Estimating tutorial details..." })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save tutorial" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add step" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Hands-on" })).toBeDisabled();

  await fireEvent.changeText(screen.getByLabelText("Step 1"), "Mutation that must be ignored");
  await fireEvent.press(screen.getByRole("button", { name: "Add step" }));
  expect(onChange).not.toHaveBeenCalled();
});

test.each([true, false])("AI cover is available in edit/import (manual upload allowed: %s), and changes the cover only on acceptance", async (allowImageEditing) => {
  await render(<RecipeHarness allowImageEditing={allowImageEditing} />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));

  expect(await screen.findByText(imageMessage("aiGenerated"))).toBeOnTheScreen();
  expect(currentDraft().thumbnail_url).toBe("https://example.com/original.jpg");
  await fireEvent.press(screen.getByRole("button", { name: imageMessage("useImage") }));
  expect(currentDraft().thumbnail_url).toBe("/media/ai-cover.jpg");
  expect(screen.queryByRole("button", { name: imageMessage("useImage") })).not.toBeOnTheScreen();
  if (allowImageEditing) expect(screen.getByDisplayValue("/media/ai-cover.jpg")).toBeOnTheScreen();
});

test("accepting a generated cover retains recipe edits made while the request was pending", async () => {
  let complete!: (value: unknown) => void;
  mockApiClient.recipes.generateImage.mockImplementation(({ request_id }) => new Promise((resolve) => {
    complete = (value) => resolve({ request_id, status: "completed", file_url: value, error_code: null });
  }));
  await render(<RecipeHarness />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));
  await fireEvent.changeText(screen.getByDisplayValue(draft.title), "New title while generating");
  await fireEvent.changeText(screen.getByPlaceholderText("Optional short description"), "Keep this description");
  await act(async () => complete("/media/ai-cover.jpg"));
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("useImage") }));

  expect(currentDraft()).toMatchObject({ title: "New title while generating", description: "Keep this description", thumbnail_url: "/media/ai-cover.jpg", steps: draft.steps });
});

test("discarding a candidate preserves the existing cover and the draft", async () => {
  await render(<RecipeHarness />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("discard") }));

  expect(currentDraft()).toEqual({ ...draft, thumbnail_url: "https://example.com/original.jpg" });
  expect(screen.queryByRole("button", { name: imageMessage("useImage") })).not.toBeOnTheScreen();
});

test("a failed generation preserves the cover and shows a safe error", async () => {
  mockApiClient.recipes.generateImage.mockImplementation(async ({ request_id }) => ({ request_id, status: "failed", file_url: null, error_code: "provider_failed" }));
  await render(<RecipeHarness />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));

  expect(await screen.findByText(imageMessage("failed"))).toBeOnTheScreen();
  expect(currentDraft().thumbnail_url).toBe("https://example.com/original.jpg");
  expect(screen.queryByRole("button", { name: imageMessage("useImage") })).not.toBeOnTheScreen();
});

test("an ambiguous connection failure recovers the same request without generating twice", async () => {
  mockApiClient.recipes.generateImage.mockRejectedValue(new TypeError("Network request failed"));
  mockApiClient.recipes.imageGenerationStatus.mockImplementation(async (request_id) => ({ request_id, status: "completed", file_url: "/media/recovered.jpg", error_code: null }));
  await render(<RecipeHarness />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("useImage") }));

  expect(currentDraft().thumbnail_url).toBe("/media/recovered.jpg");
  expect(mockApiClient.recipes.generateImage).toHaveBeenCalledTimes(1);
  expect(mockApiClient.recipes.imageGenerationStatus).toHaveBeenCalledWith(mockApiClient.recipes.generateImage.mock.calls[0][0].request_id, expect.anything());
});

test("recovery after a second connection failure checks the original request instead of spending another attempt", async () => {
  mockApiClient.recipes.generateImage.mockRejectedValue(new TypeError("Network request failed"));
  mockApiClient.recipes.imageGenerationStatus.mockRejectedValueOnce(new TypeError("Offline"))
    .mockImplementation(async (request_id) => ({ request_id, status: "completed", file_url: "/media/recovered.jpg", error_code: null }));
  await render(<RecipeHarness />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("checkAgain") }));
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("useImage") }));

  expect(currentDraft().thumbnail_url).toBe("/media/recovered.jpg");
  expect(mockApiClient.recipes.generateImage).toHaveBeenCalledTimes(1);
  expect(new Set(mockApiClient.recipes.imageGenerationStatus.mock.calls.map(([requestId]) => requestId)).size).toBe(1);
});

test("daily limits and missing titles prevent generation", async () => {
  mockApiClient.recipes.imageGenerationAccess.mockResolvedValue({ ...access, allowed: false, remaining: 0, reason: "daily_limit" });
  const view = await render(<RecipeHarness />);
  expect(await screen.findByText(imageMessage("limitReached"))).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: imageMessage("generate") })).toBeDisabled();

  await view.unmount();
  mockApiClient.recipes.imageGenerationAccess.mockResolvedValue(access);
  await render(<DraftRecipeEditor draft={{ ...draft, title: " " }} onChange={jest.fn()} saving={false} error={null} onSave={jest.fn()} />);
  expect(await screen.findByText(imageMessage("needTitle"))).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: imageMessage("generate") })).toBeDisabled();
  expect(mockApiClient.recipes.generateImage).not.toHaveBeenCalled();
});

test("a provider access failure cannot expose raw messages or change the cover", async () => {
  mockApiClient.recipes.imageGenerationAccess.mockRejectedValue(new ApiError("Sensitive provider diagnostic", 503));
  await render(<RecipeHarness />);
  expect(await screen.findByText(imageMessage("unavailable"))).toBeOnTheScreen();
  expect(screen.queryByText("Sensitive provider diagnostic")).not.toBeOnTheScreen();
  expect(screen.getByRole("button", { name: imageMessage("generate") })).toBeDisabled();
  expect(currentDraft().thumbnail_url).toBe("https://example.com/original.jpg");
});

test("access loading can be retried after the connection returns", async () => {
  mockApiClient.recipes.imageGenerationAccess.mockRejectedValueOnce(new TypeError("Offline"));
  await render(<RecipeHarness />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("checkAgain") }));
  expect(screen.getByRole("button", { name: imageMessage("generate") })).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: imageMessage("generate") }));
  expect(await screen.findByRole("button", { name: imageMessage("useImage") })).toBeEnabled();
});

test("manual recovery of a never-admitted request replays its original payload and ID while retaining newer edits", async () => {
  mockApiClient.recipes.generateImage.mockRejectedValueOnce(new TypeError("Connection lost before admission"));
  mockApiClient.recipes.imageGenerationStatus.mockRejectedValue(new ApiError("Image request not found.", 404, "not_found"));
  await render(<RecipeHarness />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));
  const original = mockApiClient.recipes.generateImage.mock.calls[0][0];
  expect(mockApiClient.recipes.generateImage).toHaveBeenCalledTimes(1);
  await fireEvent.changeText(screen.getByDisplayValue(draft.title), "New recipe title");
  await fireEvent.changeText(screen.getByPlaceholderText("Optional short description"), "New draft description");
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("checkAgain") }));
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("useImage") }));
  expect(mockApiClient.recipes.generateImage).toHaveBeenCalledTimes(2);
  expect(mockApiClient.recipes.generateImage.mock.calls[1][0]).toEqual(original);
  expect(currentDraft()).toMatchObject({ title: "New recipe title", description: "New draft description", thumbnail_url: "/media/ai-cover.jpg" });
});

test("short rate limits explain when to retry and do not recover an unadmitted request", async () => {
  mockApiClient.recipes.generateImage.mockRejectedValue(new ApiError("Slow down", 429, "rate_limited"));
  await render(<RecipeHarness />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));
  expect(await screen.findByText(imageMessage("rateLimited"))).toBeOnTheScreen();
  expect(mockApiClient.recipes.imageGenerationStatus).not.toHaveBeenCalled();
  expect(currentDraft().thumbnail_url).toBe("https://example.com/original.jpg");
});

test("saving the recipe disables candidate acceptance", async () => {
  const view = await render(<RecipeHarness />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));
  await screen.findByRole("button", { name: imageMessage("useImage") });
  await view.rerender(<RecipeHarness saving />);
  expect(screen.getByRole("button", { name: imageMessage("useImage") })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: imageMessage("useImage") }));
  expect(currentDraft().thumbnail_url).toBe("https://example.com/original.jpg");
});

test("repeated Generate taps issue only one attempt while a request is pending", async () => {
  let complete!: () => void;
  mockApiClient.recipes.generateImage.mockImplementation(({ request_id }) => new Promise((resolve) => {
    complete = () => resolve({ request_id, status: "completed", file_url: "/media/ai-cover.jpg", error_code: null });
  }));
  await render(<RecipeHarness />);
  const generate = await screen.findByRole("button", { name: imageMessage("generate") });
  await fireEvent.press(generate);
  await fireEvent.press(generate);
  expect(screen.getByRole("button", { name: imageMessage("generating") })).toBeDisabled();
  expect(mockApiClient.recipes.generateImage).toHaveBeenCalledTimes(1);
  await act(async () => complete());
  expect(await screen.findByRole("button", { name: imageMessage("useImage") })).toBeEnabled();
});

test("uploading a manual cover disables AI acceptance until the upload completes", async () => {
  jest.spyOn(ImagePicker, "requestMediaLibraryPermissionsAsync").mockResolvedValue({ granted: true } as ImagePicker.MediaLibraryPermissionResponse);
  jest.spyOn(ImagePicker, "launchImageLibraryAsync").mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cover.jpg", width: 500, height: 500, fileName: "cover.jpg" }] });
  let finishUpload!: () => void;
  mockApiClient.recipes.uploadImage.mockImplementation(() => new Promise((resolve) => {
    finishUpload = () => resolve({ upload_url: "", file_url: "/media/manual-cover.jpg" });
  }));
  await render(<RecipeHarness />);
  await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));
  await screen.findByRole("button", { name: imageMessage("useImage") });
  await fireEvent.press(screen.getByRole("button", { name: "Replace cover image" }));
  expect(screen.getByRole("button", { name: imageMessage("useImage") })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: imageMessage("useImage") }));
  expect(currentDraft().thumbnail_url).toBe("https://example.com/original.jpg");
  await act(async () => finishUpload());
  expect(currentDraft().thumbnail_url).toBe("/media/manual-cover.jpg");
  expect(screen.getByRole("button", { name: imageMessage("useImage") })).toBeEnabled();
});

test("pending generations stop polling after 90 seconds and can resume the same request", async () => {
  jest.useFakeTimers();
  try {
    mockApiClient.recipes.generateImage.mockImplementation(async ({ request_id }) => ({ request_id, status: "pending", file_url: null, error_code: null }));
    mockApiClient.recipes.imageGenerationStatus.mockImplementation(async (request_id) => ({ request_id, status: "pending", file_url: null, error_code: null }));
    await render(<RecipeHarness />);
    await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));
    await act(async () => { await jest.advanceTimersByTimeAsync(90_000); });
    expect(screen.getByRole("button", { name: imageMessage("checkAgain") })).toBeEnabled();
    const calls = mockApiClient.recipes.imageGenerationStatus.mock.calls.length;
    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(mockApiClient.recipes.imageGenerationStatus).toHaveBeenCalledTimes(calls);
    mockApiClient.recipes.imageGenerationStatus.mockImplementation(async (request_id) => ({ request_id, status: "completed", file_url: "/media/late-cover.jpg", error_code: null }));
    await fireEvent.press(screen.getByRole("button", { name: imageMessage("checkAgain") }));
    await fireEvent.press(await screen.findByRole("button", { name: imageMessage("useImage") }));
    expect(currentDraft().thumbnail_url).toBe("/media/late-cover.jpg");
    expect(mockApiClient.recipes.generateImage).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test("leaving the editor aborts the pending request and stops status polling", async () => {
  jest.useFakeTimers();
  try {
    mockApiClient.recipes.generateImage.mockImplementation(async ({ request_id }) => ({ request_id, status: "pending", file_url: null, error_code: null }));
    const view = await render(<RecipeHarness />);
    await fireEvent.press(await screen.findByRole("button", { name: imageMessage("generate") }));
    const signal = mockApiClient.recipes.generateImage.mock.calls[0][1].signal;
    await view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { await jest.advanceTimersByTimeAsync(100_000); });
    expect(mockApiClient.recipes.imageGenerationStatus).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
