import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecipeEditPage from "./page";

const { mockApiFetch, mockPush } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "recipe-1" }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("../../lib/uploadRecipeImage", () => ({ uploadRecipeImage: vi.fn() }));
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
  equipment: [],
  library_tags: [],
};

beforeEach(() => {
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

describe("saved recipe total time", () => {
  function loadRecipe(total_time_minutes: number | null) {
    mockApiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/recipes/catalog/editor-status") {
        return new Response(JSON.stringify({ can_manage: false }));
      }
      return new Response(JSON.stringify({ ...recipe, total_time_minutes }));
    });
  }

  it("updates the total immediately and saves the rounded sum after duration edits", async () => {
    loadRecipe(8);
    const user = userEvent.setup();
    render(<RecipeEditPage />);
    const minutes = await screen.findByLabelText("Step 1 minutes");
    const total = screen.getByRole("spinbutton", { name: /Total time/ });
    fireEvent.change(minutes, { target: { value: "3" } });
    expect(total).toHaveValue(3);
    fireEvent.change(screen.getByLabelText("Step 1 seconds"), { target: { value: "15" } });
    expect(total).toHaveValue(4);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const [, options] = mockApiFetch.mock.calls.find(([, request]) => request?.method === "PATCH")!;
    expect(JSON.parse(options.body)).toMatchObject({
      total_time_minutes: 4,
      steps: [{ duration_seconds: 195, duration_source: "user" }],
    });
  });

  it("derives a missing total before any edits and saves it", async () => {
    loadRecipe(null);
    const user = userEvent.setup();
    render(<RecipeEditPage />);
    await screen.findByLabelText("Step 1 minutes");
    expect(screen.getByRole("spinbutton", { name: /Total time/ })).toHaveValue(8);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const [, options] = mockApiFetch.mock.calls.find(([, request]) => request?.method === "PATCH")!;
    expect(JSON.parse(options.body).total_time_minutes).toBe(8);
  });

  it("updates automatic totals when timed steps are added or removed", async () => {
    loadRecipe(8);
    const user = userEvent.setup();
    render(<RecipeEditPage />);
    await screen.findByLabelText("Step 1 minutes");
    await user.click(screen.getByRole("button", { name: "Add step" }));
    const total = screen.getByRole("spinbutton", { name: /Total time/ });
    expect(total).toHaveValue(8);
    fireEvent.change(screen.getByLabelText("Step 2"), { target: { value: "Serve the tofu." } });
    expect(total).toHaveValue(13);
    fireEvent.change(screen.getByLabelText("Step 2 minutes"), { target: { value: "2" } });
    expect(total).toHaveValue(10);
    await user.click(screen.getByRole("button", { name: "Remove step 1" }));
    expect(total).toHaveValue(2);
  });

  it("preserves a separate source total even if intermediate steps match it", async () => {
    loadRecipe(40);
    render(<RecipeEditPage />);
    const minutes = await screen.findByLabelText("Step 1 minutes");
    fireEvent.change(minutes, { target: { value: "40" } });
    fireEvent.change(minutes, { target: { value: "3" } });
    expect(screen.getByRole("spinbutton", { name: /Total time/ })).toHaveValue(40);
  });

  it("preserves an explicitly edited total even when it matches the step sum", async () => {
    loadRecipe(8);
    render(<RecipeEditPage />);
    const minutes = await screen.findByLabelText("Step 1 minutes");
    const total = screen.getByRole("spinbutton", { name: /Total time/ });
    fireEvent.change(total, { target: { value: "12" } });
    fireEvent.change(total, { target: { value: "8" } });
    fireEvent.change(minutes, { target: { value: "3" } });
    expect(total).toHaveValue(8);
  });
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
