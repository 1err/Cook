import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecipeEditPage from "./page";

const { mockApiFetch, mockPush, mockUploadRecipeImage } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockPush: vi.fn(),
  mockUploadRecipeImage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "recipe-1" }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("../../lib/uploadRecipeImage", () => ({ uploadRecipeImage: mockUploadRecipeImage }));
vi.mock("../../lib/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      "common.add": "Add",
      "common.cancel": "Cancel",
      "common.ingredients": "Ingredients",
      "common.loading": "Loading",
      "common.save": "Save",
      "common.saving": "Saving",
      "common.tags": "Tags",
      "recipe.coverImage": "Cover image",
      "recipe.sourceLinkLabel": "Source link",
      "recipe.addSourceLink": "Add link",
      "recipe.editSourceLink": "Edit link",
      "recipe.saveSourceLink": "Save link",
      "recipe.openSourceLink": "Open source link",
      "recipe.sourceLinkInvalid": "Invalid source link",
      "recipe.sourceLinkSaveError": "Could not save source link",
      "recipe.sourceLinkSaved": "Source link saved",

      "recipe.deleteRecipe": "Delete recipe",
      "recipe.description": "Description",
      "recipe.editRecipeTitle": "Edit recipe",
      "recipe.equipment": "Equipment",
      "recipe.equipment.addRow": "Add equipment",
      "recipe.equipment.placeholder": "Equipment item",
      "recipe.ingredient": "Ingredient",
      "recipe.qty": "Amount",
      "recipe.metricQty": "Metric amount",
      "recipe.recipeTitle": "Recipe title",
      "recipe.removeIngredient": "Remove ingredient",
      "recipe.step.addRow": "Add step",
      "recipe.step.textPlaceholder": "Step instructions",
      "recipe.steps": "Steps",
      "recipe.steps.empty": "No steps",
      "recipe.tips": "Tips",
      "recipe.tips.addRow": "Add tip",
      "recipe.tips.placeholder": "Tip",
      "recipe.totalTime": "Total time",
      "recipe.totalTime.minutesSuffix": "minutes",
      "recipe.tutorial.action.simmer": "Simmer",
      "recipe.tutorial.attention.handsOn": "Hands-on",
      "recipe.tutorial.attention.passive": "Passive",
      "recipe.tutorial.editor.attention": "Attention",
      "recipe.tutorial.editor.duration": "Duration",
      "recipe.tutorial.editor.durationInvalid": "Enter a valid duration.",
      "recipe.tutorial.editor.durationLabel": "Step {step} duration",
      "recipe.tutorial.editor.durationMinutes": "Step {step} minutes",
      "recipe.tutorial.editor.durationSeconds": "Step {step} seconds",
      "recipe.tutorial.editor.illustration": "Illustration",
      "recipe.tutorial.editor.illustrationLabel": "Step {step} illustration",
      "recipe.tutorial.editor.moveDown": "Move step {step} down",
      "recipe.tutorial.editor.moveUp": "Move step {step} up",
      "recipe.tutorial.editor.remove": "Remove step {step}",
      "recipe.tutorial.editor.stepLabel": "Step {step}",
      "recipe.tutorial.source.estimated": "AI estimated",
      "recipe.updateRecipeSub": "Update recipe",
    };
    return (messages[key] ?? key).replace(
      /\{(\w+)\}/g,
      (_, name: string) => String(vars?.[name] ?? ""),
    );
  },
}));

const recipe = {
  id: "recipe-1",
  title: "Braised tofu",
  thumbnail_url: null,
  description: "A weeknight braise.",
  total_time_minutes: 40,
  ingredients: [{ name: "Tofu", quantity: "1 block", metric_quantity: "400 g", notes: null }],
  steps: [{
    id: "d042d265-8ac1-46cf-9d26-0c459538b8bb",
    text: "Braise until glossy.",
    duration_seconds: 480,
    duration_source: "estimated",
    attention_type: "hands_on",
    action_type: "simmer",
    image_url: null,
  }],
  tips: [],
  equipment: ["Legacy stockpot"],
  library_tags: [],
};

beforeEach(() => {
  mockUploadRecipeImage.mockReset();
  mockPush.mockReset();
  mockApiFetch.mockReset().mockImplementation((path: string, options?: RequestInit) => {
    if (options?.method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify(recipe), { status: 200 }));
    }
    if (path === "/recipes/catalog/editor-status") {
      return Promise.resolve(new Response(JSON.stringify({ can_manage: false }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(recipe), { status: 200 }));
  });
});

afterEach(cleanup);

it("blocks Save while uploading a cover and keeps newer text edits when it finishes", async () => {
  let finishUpload!: (url: string) => void;
  mockUploadRecipeImage.mockReturnValue(new Promise<string>(resolve => { finishUpload = resolve; }));
  const user = userEvent.setup();
  render(<RecipeEditPage />);
  const title = await screen.findByLabelText("Recipe title");
  expect(screen.queryByText(/^Equipment/)).not.toBeInTheDocument();
  await user.upload(screen.getByLabelText("Cover image"), new File(["photo"], "dish.jpg", { type: "image/jpeg" }));
  const save = screen.getByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  await user.clear(title);
  await user.type(title, "My braised tofu");
  await user.click(save);
  expect(mockApiFetch.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
  await act(async () => { finishUpload("https://images.example/new.jpg"); });
  expect(save).toBeEnabled();
  expect(title).toHaveValue("My braised tofu");
  await user.click(save);
  const saveOptions = mockApiFetch.mock.calls.find(([, options]) => options?.method === "PATCH")![1];
  expect(JSON.parse(saveOptions.body)).not.toHaveProperty("equipment");
  expect(JSON.parse(saveOptions.body)).toMatchObject({ title: "My braised tofu", thumbnail_url: "https://images.example/new.jpg" });
});

describe("full recipe editor tutorial validity", () => {
  it("keeps a cleared duration visible and blocks PATCH until corrected", async () => {
    const user = userEvent.setup();
    render(<RecipeEditPage />);

    const minutes = await screen.findByLabelText("Step 1 minutes");
    const save = screen.getByRole("button", { name: "Save" });
    await user.clear(minutes);

    expect(minutes).toHaveValue(null);
    expect(save).toBeDisabled();
    await user.click(save);
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      "/recipes/recipe-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(mockPush).not.toHaveBeenCalled();

    await user.type(minutes, "5");
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith(
      "/recipes/recipe-1",
      expect.objectContaining({ method: "PATCH" }),
    ));
    expect(mockPush).toHaveBeenCalledWith("/library");
  });
});


describe("source link editing for ordinary recipe owners", () => {
  function storedRecipe(source_url: string | null = null, fail = false) {
    let stored = { ...recipe, source_url };
    mockApiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/recipes/catalog/editor-status") return new Response(JSON.stringify({ can_manage: false }));
      if (options?.method === "PATCH") {
        if (fail) return new Response("Failed", { status: 500 });
        stored = { ...stored, ...JSON.parse(options.body as string) };
      }
      return new Response(JSON.stringify(stored));
    });
  }

  it("adds and reloads a source without saving unrelated draft edits", async () => {
    storedRecipe();
    const user = userEvent.setup();
    const view = render(<RecipeEditPage />);
    const title = await screen.findByLabelText("Recipe title");
    await user.clear(title);
    await user.type(title, "Unsaved recipe title");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await user.type(screen.getByLabelText("Source link"), "  https://example.com/original  ");
    await user.click(screen.getByRole("button", { name: "Save link" }));
    expect(await screen.findByRole("link", { name: "Open source link ↗" })).toHaveAttribute("href", "https://example.com/original");
    expect(title).toHaveValue("Unsaved recipe title");
    expect(mockPush).not.toHaveBeenCalled();
    const updates = mockApiFetch.mock.calls.filter(([, options]) => options?.method === "PATCH");
    expect(updates).toHaveLength(1);
    expect(JSON.parse(updates[0][1].body)).toEqual({ source_url: "https://example.com/original" });
    view.unmount();
    render(<RecipeEditPage />);
    expect(await screen.findByRole("link", { name: "Open source link ↗" })).toHaveAttribute("href", "https://example.com/original");
  });

  it("cancels without writing and can replace an existing source", async () => {
    storedRecipe("https://example.com/old");
    const user = userEvent.setup();
    render(<RecipeEditPage />);
    await user.click(await screen.findByRole("button", { name: "Edit link" }));
    const input = screen.getByLabelText("Source link");
    expect(input).toHaveValue("https://example.com/old");
    await user.clear(input);
    await user.type(input, "https://example.com/new");
    const formCancel = screen.getAllByRole("button", { name: "Cancel" }).at(-1)!;
    await user.click(formCancel);
    expect(mockApiFetch.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Edit link" }));
    expect(screen.getByLabelText("Source link")).toHaveValue("https://example.com/old");
    await user.clear(screen.getByLabelText("Source link"));
    await user.type(screen.getByLabelText("Source link"), "https://example.com/new");
    await user.click(screen.getByRole("button", { name: "Save link" }));
    expect(await screen.findByRole("link", { name: "Open source link ↗" })).toHaveAttribute("href", "https://example.com/new");
  });

  it.each(["javascript:alert(1)", "https://user:password@example.com/a", "https://example.com/with space"])("rejects unsafe source %s", async (url) => {
    storedRecipe();
    const user = userEvent.setup();
    render(<RecipeEditPage />);
    await user.click(await screen.findByRole("button", { name: "Add link" }));
    await user.type(screen.getByLabelText("Source link"), url);
    await user.click(screen.getByRole("button", { name: "Save link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid source link");
    expect(mockApiFetch.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });

  it("keeps the entered source available after a failed save", async () => {
    storedRecipe(null, true);
    const user = userEvent.setup();
    render(<RecipeEditPage />);
    await user.click(await screen.findByRole("button", { name: "Add link" }));
    await user.type(screen.getByLabelText("Source link"), "https://example.com/original");
    await user.click(screen.getByRole("button", { name: "Save link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save source link");
    expect(screen.getByLabelText("Source link")).toHaveValue("https://example.com/original");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
