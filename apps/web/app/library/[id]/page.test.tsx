import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
