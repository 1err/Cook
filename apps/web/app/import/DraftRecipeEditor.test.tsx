import { useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recipe } from "../types";
import { DraftRecipeEditor } from "./DraftRecipeEditor";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../lib/api", () => ({ apiFetch: mockApiFetch }));

vi.mock("../lib/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      "common.add": "Add",
      "common.ingredients": "Ingredients",
      "common.save": "Save",
      "common.saving": "Saving…",
      "common.tags": "Tags",
      "import.saveRecipe": "Save recipe",
      "import.untitledRecipe": "Untitled recipe",
      "recipe.coverImage": "Cover image",
      "recipe.description": "Description",
      "recipe.equipment": "Equipment",
      "recipe.equipment.addRow": "Add equipment",
      "recipe.equipment.placeholder": "Equipment item",
      "recipe.ingredient": "Ingredient",
      "recipe.qty": "Amount",
      "recipe.removeIngredient": "Remove ingredient",
      "recipe.recipeTitle": "Recipe title",
      "recipe.step.addRow": "Add step",
      "recipe.step.duration": "Duration",
      "recipe.step.moveDown": "Move down",
      "recipe.step.moveUp": "Move up",
      "recipe.step.remove": "Remove step",
      "recipe.step.textPlaceholder": "Step instructions",
      "recipe.steps": "Steps",
      "recipe.steps.empty": "No steps",
      "recipe.tutorial.editor.duration": "Duration",
      "recipe.tutorial.editor.attention": "Attention",
      "recipe.tutorial.editor.illustration": "Illustration",
      "recipe.tutorial.editor.stepLabel": "Step {step}",
      "recipe.tutorial.editor.durationLabel": "Step {step} duration",
      "recipe.tutorial.editor.durationMinutes": "Step {step} minutes",
      "recipe.tutorial.editor.durationSeconds": "Step {step} seconds",
      "recipe.tutorial.editor.durationInvalid": "Enter a duration from 1 second to 24 hours.",
      "recipe.tutorial.editor.illustrationLabel": "Step {step} illustration",
      "recipe.tutorial.source.estimated": "AI estimated",
      "recipe.tutorial.attention.handsOn": "Hands-on",
      "recipe.tutorial.attention.passive": "Passive",
      "recipe.tutorial.action.simmer": "Simmer",
      "recipe.tips": "Tips",
      "recipe.tips.addRow": "Add tip",
      "recipe.tips.placeholder": "Tip",
      "recipe.totalTime": "Total time",
      "recipe.totalTime.minutesSuffix": "minutes",
    };
    return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
  },
}));

const draft: Recipe = {
  id: "draft-1",
  title: "Braised tofu",
  thumbnail_url: null,
  description: "A weeknight braise.",
  total_time_minutes: 40,
  ingredients: [
    { name: "Tofu", quantity: "1 block", metric_quantity: "400 g", notes: "firm" },
  ],
  steps: [{
    id: "d042d265-8ac1-46cf-9d26-0c459538b8bb",
    text: "Braise until glossy.",
    duration_seconds: 480,
    duration_source: "estimated",
    attention_type: "hands_on",
    action_type: "simmer",
    image_url: "https://example.com/step.jpg",
  }],
  tips: ["Drain the tofu."],
  equipment: ["Skillet"],
  library_tags: ["weeknight"],
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockApiFetch.mockReset();
});

afterEach(cleanup);

describe("DraftRecipeEditor", () => {
  it("keeps the review hierarchy focused on editable recipe content", () => {
    render(
      <DraftRecipeEditor
        draft={draft}
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSaveSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Back to source" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Review recipe" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Add image|Upload image/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Image URL")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Notes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Errors stay local/i)).not.toBeInTheDocument();
  });

  it("disables Save while a tutorial duration is locally invalid", async () => {
    const user = userEvent.setup();

    function ControlledDraft() {
      const [value, setValue] = useState(draft);
      return (
        <DraftRecipeEditor
          draft={value}
          onChange={setValue}
          onBack={vi.fn()}
          onSaveSuccess={vi.fn()}
        />
      );
    }

    render(<ControlledDraft />);
    const save = screen.getByRole("button", { name: "Save recipe" });
    expect(save).toBeEnabled();

    await user.clear(screen.getByLabelText("Step 1 minutes"));
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Step 1 minutes"), "8");
    expect(save).toBeEnabled();
  });

  it("freezes the captured draft and all review controls while Save is pending", async () => {
    const user = userEvent.setup();
    const pending = deferred<Response>();
    const onSaveSuccess = vi.fn();
    let observedDraft = draft;
    mockApiFetch.mockReturnValueOnce(pending.promise);

    function ControlledDraft() {
      const [value, setValue] = useState(draft);
      return (
        <DraftRecipeEditor
          draft={value}
          onChange={(next) => {
            observedDraft = next;
            setValue(next);
          }}
          onBack={vi.fn()}
          onSaveSuccess={onSaveSuccess}
        />
      );
    }

    render(<ControlledDraft />);
    const title = screen.getByLabelText("Recipe title");
    const ingredient = screen.getByLabelText("Ingredient 1");
    const instructions = screen.getByLabelText("Step 1");
    await user.clear(title);
    await user.type(title, "Captured braise");
    await user.clear(ingredient);
    await user.type(ingredient, "Captured tofu");
    await user.clear(instructions);
    await user.type(instructions, "Captured tutorial step.");

    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to source" })).toBeDisabled();
    expect(title).toBeDisabled();
    expect(ingredient).toBeDisabled();
    expect(instructions).toBeDisabled();

    await user.click(ingredient);
    await user.keyboard("{Control>}a{/Control}Unsent ingredient mutation");
    await user.click(instructions);
    await user.keyboard("{Control>}a{/Control}Unsent tutorial mutation");

    const [, request] = mockApiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      ...draft,
      title: "Captured braise",
      ingredients: [{
        ...draft.ingredients[0],
        name: "Captured tofu",
      }],
      steps: [{
        ...draft.steps?.[0],
        text: "Captured tutorial step.",
      }],
    });

    await act(async () => {
      pending.resolve(new Response("", { status: 500 }));
      await pending.promise;
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save recipe" })).toBeEnabled());
    expect(observedDraft.ingredients[0].name).toBe("Captured tofu");
    expect(observedDraft.steps?.[0].text).toBe("Captured tutorial step.");
    expect(onSaveSuccess).not.toHaveBeenCalled();
  });
});
